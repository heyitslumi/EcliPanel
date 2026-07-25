use anyhow::Context;
use arc_swap::ArcSwap;
use clap::{Parser, Subcommand};
use socket2::{Domain, Protocol, Socket, Type};
use std::net::SocketAddr;
use std::os::fd::AsRawFd;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsAcceptor;
use tracing::{error, info, warn};

mod autoupdate;
mod balancer;
mod config;
mod conn;
mod error_page;
mod grpc;
mod h1;
mod h2;
mod h3;
mod health;
mod ktls;
mod letsencrypt;
mod proto;
mod proxy;
mod ratelimit;
mod static_files;
mod upstream;

use config::{EcliHaloConfig, TlsMode};
use conn::ConnHandler;
use health::build_registry;
use letsencrypt::ChallengeTokens;
use proxy::{build_proxy_cache, SharedRegistry, SharedState};
use ratelimit::RateLimiter;
use static_files::{build_resp_cache, spawn_prewarm};
use upstream::UpstreamPool;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const START_TIME: std::sync::LazyLock<std::time::Instant> =
    std::sync::LazyLock::new(std::time::Instant::now);

pub mod metrics {
    use std::sync::atomic::AtomicU64;
    pub static REQUESTS: AtomicU64 = AtomicU64::new(0);
    pub static FAILURES: AtomicU64 = AtomicU64::new(0);
    pub static BYTES_SENT: AtomicU64 = AtomicU64::new(0);
}

#[derive(Parser)]
#[command(name = "eclihalo", version = VERSION)]
struct Args {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Start {
        #[arg(short, long, default_value = "/etc/eclihalo/config.yml")]
        config: PathBuf,
    },
    Reload,
    Version,
    Systemd,
}

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn main() -> anyhow::Result<()> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("rustls ring provider");

    let cpus = num_cpus::get();
    
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(cpus)
        .max_blocking_threads(cpus * 4)
        .thread_stack_size(2 * 1024 * 1024)
        .event_interval(10)
        .global_queue_interval(61)
        .enable_all()
        .build()?
        .block_on(async_main())
}

async fn async_main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    match Args::parse().command {
        Command::Start { config } => run_start(config).await,
        Command::Reload => run_reload().await,
        Command::Version => {
            println!("eclihalo {VERSION}");
            Ok(())
        }
        Command::Systemd => {
            print_systemd_unit();
            Ok(())
        }
    }
}

async fn run_start(config_path: PathBuf) -> anyhow::Result<()> {
    let cfg = EcliHaloConfig::load(&config_path)?;
    let cpus = num_cpus::get();
    let perf = &cfg.performance;
    info!(
        routes = cfg.routes.len(),
        cpus,
        version = VERSION,
        "eclihalo starting"
    );

    let shared: SharedState = Arc::new(ArcSwap::from_pointee(cfg.clone()));
    let registry: SharedRegistry = Arc::new(ArcSwap::from_pointee(build_registry(&cfg.routes)));
    let tls_cfg = build_tls_config(&cfg.tls, &cfg.routes)?;
    let ossl_acceptor = build_openssl_acceptor(&cfg.tls).ok();
    let resp_cache = build_resp_cache();

    for route in &cfg.routes {
        if let Some(ref sf) = route.static_files {
            if sf.cache_enabled {
                spawn_prewarm(sf.clone(), resp_cache.clone());
            }
        }
    }

    let limiter = Arc::new(if cfg.rate_limit.enabled {
        RateLimiter::new(&cfg.rate_limit)
    } else {
        RateLimiter::disabled()
    });

    let challenges: ChallengeTokens =
        Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));

    if cfg.tls.mode == TlsMode::LetsEncrypt {
        let tc = cfg.tls.clone();
        let ch = challenges.clone();
        tokio::spawn(async move {
            if let Err(e) = letsencrypt::order_certificate(&tc, &ch).await {
                warn!("ACME: {e}");
            }
        });
        letsencrypt::spawn_renewal_task(cfg.tls.clone(), challenges.clone());
    }

    use tokio::sync::RwLock;
    let health_reg = Arc::new(RwLock::new(build_registry(&cfg.routes)));
    health::spawn_health_checker(health_reg.clone(), Duration::from_secs(10));

    autoupdate::spawn_update_checker(cfg.auto_update.clone());

    spawn_http_handler(
        cfg.http.port,
        challenges.clone(),
        shared.clone(),
        registry.clone(),
        limiter.clone(),
        resp_cache.clone(),
        perf.accept_backlog,
        perf.accept_batch,
    );

    let https_addr: SocketAddr = ([0, 0, 0, 0], cfg.https.port).into();
    
    let ossl = ossl_acceptor.map(Arc::new);
    for core_id in 0..cpus {
        let listener = build_socket(https_addr, perf.accept_backlog)
            .with_context(|| format!("bind {https_addr} core {core_id}"))?;

        #[cfg(target_os = "linux")]
        pin_to_core(core_id);

        let acceptor = TlsAcceptor::from(tls_cfg.clone());
        let ossl_acpt = ossl.clone();
        let config = shared.clone();
        let registry = registry.clone();
        let limiter = limiter.clone();
        let pool = Arc::new(UpstreamPool::new());
        let p_cache = build_proxy_cache(104857600, 60);
        let resp = resp_cache.clone();

        tokio::spawn(async move {
            info!("core {core_id}: HTTPS accept loop");

            let base_handler = ConnHandler {
                config,
                registry,
                limiter,
                pool,
                resp,
                proxy_cache: p_cache,
                peer: "0.0.0.0:0".parse().unwrap(),
            };

            loop {
                let (stream, peer) = match listener.accept().await {
                    Ok(v) => v,
                    Err(e) => {
                        error!("accept: {e}");
                        tokio::time::sleep(Duration::from_millis(10)).await;
                        continue;
                    }
                };

                let _ = stream.set_nodelay(true);
                #[cfg(target_os = "linux")]
                {
                    let fd = stream.as_raw_fd();
                    unsafe {
                        let val: libc::c_int = 1;
                        libc::setsockopt(
                            fd,
                            libc::IPPROTO_TCP,
                            libc::TCP_QUICKACK,
                            &val as *const _ as *const libc::c_void,
                            std::mem::size_of::<libc::c_int>() as libc::socklen_t,
                        );
                    }
                }

                let acceptor1 = acceptor.clone();
                let ossl1 = ossl_acpt.clone();
                let mut handler = base_handler.clone_fast();
                handler.peer = peer;

                tokio::spawn(async move {
                    tls_accept_and_serve(stream, acceptor1, ossl1, handler, peer).await;
                });

                for _ in 0..128 {
                    match tokio::time::timeout(Duration::ZERO, listener.accept()).await {
                        Ok(Ok((stream, peer))) => {
                            let _ = stream.set_nodelay(true);
                            #[cfg(target_os = "linux")]
                            {
                                let fd = stream.as_raw_fd();
                                unsafe {
                                    let val: libc::c_int = 1;
                                    libc::setsockopt(
                                        fd,
                                        libc::IPPROTO_TCP,
                                        libc::TCP_QUICKACK,
                                        &val as *const _ as *const libc::c_void,
                                        std::mem::size_of::<libc::c_int>() as libc::socklen_t,
                                    );
                                }
                            }
                            let acceptor2 = acceptor.clone();
                            let ossl2 = ossl_acpt.clone();
                            let mut handler = base_handler.clone_fast();
                            handler.peer = peer;
                            tokio::spawn(async move {
                                tls_accept_and_serve(stream, acceptor2, ossl2, handler, peer).await;
                            });
                        }
                        _ => break,
                    }
                }
            }
        });
    }
    info!("HTTPS listening on {https_addr} ({cpus} cores)");

    let h3_addr: SocketAddr = ([0, 0, 0, 0], cfg.https.port).into();
    tokio::spawn(crate::h3::listen(
        h3_addr,
        tls_cfg.clone(),
        shared.clone(),
        registry.clone(),
        limiter.clone(),
        Arc::new(UpstreamPool::new()),
        resp_cache.clone(),
    ));
    info!("HTTP/3 listening on {h3_addr} (QUIC/UDP)");

    let mut sighup = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::hangup())
        .expect("SIGHUP");
    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("SIGTERM");

    loop {
        tokio::select! {
            _ = sighup.recv() => {
                info!("SIGHUP – reloading config");
                match EcliHaloConfig::load(&config_path) {
                    Ok(new) => {
                        let new_reg = build_registry(&new.routes);
                        let count   = new.routes.len();
                        shared.store(Arc::new(new));
                        registry.store(Arc::new(new_reg));
                        info!(routes = count, "reloaded");
                    }
                    Err(e) => error!("reload failed: {e:#}"),
                }
            }
            _ = sigterm.recv() => {
                info!("SIGTERM – draining");
                tokio::time::sleep(Duration::from_secs(5)).await;
                info!("shutdown");
                break;
            }
        }
    }
    Ok(())
}

async fn tls_accept_and_serve(
    stream: TcpStream,
    rustls_acceptor: TlsAcceptor,
    ossl_acceptor: Option<Arc<openssl::ssl::SslAcceptor>>,
    handler: ConnHandler,
    peer: SocketAddr,
) {
    if let Some(ref ossl) = ossl_acceptor {
        match ktls::handshake(stream, ossl).await {
            Ok(k_result) => {
                let sendfile_fd = if k_result.ktls_active {
                    Some(k_result.stream.get_ref().as_raw_fd())
                } else {
                    None
                };
                if let Err(e) = handler.run_tls(k_result.stream, k_result.alpn, sendfile_fd).await {
                    if !is_io_noise(&e) {
                        warn!(%peer, "ossl-conn: {e}");
                    }
                }
                return;
            }
            Err(e) => {
                if !is_tls_noise(&e.to_string()) {
                    warn!(%peer, "kTLS handshake: {e}");
                }
                return;
            }
        }
    }

    let tls = match rustls_acceptor.accept(stream).await {
        Ok(t) => t,
        Err(e) => {
            if !is_tls_noise(&e.to_string()) {
                warn!(%peer, "TLS: {e}");
            }
            return;
        }
    };
    let alpn = tls.get_ref().1.alpn_protocol().map(|b| b.to_vec());
    if let Err(e) = handler.run_tls(tls, alpn, None).await {
        if !is_io_noise(&e) {
            warn!(%peer, "conn: {e}");
        }
    }
}

fn spawn_http_handler(
    http_port: u16,
    challenges: ChallengeTokens,
    config: SharedState,
    registry: SharedRegistry,
    limiter: Arc<RateLimiter>,
    resp: static_files::RespCache,
    backlog: i32,
    _batch: usize,
) {
    let addr: SocketAddr = ([0, 0, 0, 0], http_port).into();
    let cpus = num_cpus::get();
    info!("HTTP → {addr} (h1 plain) x{cpus} cores");

    for core_id in 0..cpus {
        let listener = match build_socket(addr, backlog) {
            Ok(l) => l,
            Err(e) => {
                error!("HTTP bind core {core_id}: {e}");
                continue;
            }
        };

        #[cfg(target_os = "linux")]
        pin_to_core(core_id);

        let config = config.clone();
        let registry = registry.clone();
        let limiter = limiter.clone();
        let pool = Arc::new(UpstreamPool::new());
        let p_cache = build_proxy_cache(104857600, 60);
        let resp = resp.clone();
        let _challenges = challenges.clone();

        tokio::spawn(async move {
            info!("core {core_id}: HTTP accept loop");

            let base_handler = ConnHandler {
                config: config.clone(),
                registry: registry.clone(),
                limiter: limiter.clone(),
                pool: pool.clone(),
                resp: resp.clone(),
                proxy_cache: p_cache,
                peer: "0.0.0.0:0".parse().unwrap(),
            };

            loop {
                let (stream, peer) = match listener.accept().await {
                    Ok(v) => v,
                    Err(e) => {
                        error!("http accept core {core_id}: {e}");
                        tokio::time::sleep(Duration::from_millis(10)).await;
                        continue;
                    }
                };
                let _ = stream.set_nodelay(true);
                #[cfg(target_os = "linux")]
                {
                    let fd = stream.as_raw_fd();
                    unsafe {
                        let val: libc::c_int = 1;
                        libc::setsockopt(
                            fd,
                            libc::IPPROTO_TCP,
                            libc::TCP_QUICKACK,
                            &val as *const _ as *const libc::c_void,
                            std::mem::size_of::<libc::c_int>() as libc::socklen_t,
                        );
                    }
                }

                let mut handler = base_handler.clone_fast();
                handler.peer = peer;

                tokio::spawn(async move {
                    if let Err(e) = handler.run_plain(stream).await {
                        if !is_io_noise(&e) {
                            warn!(%peer, "http conn: {e}");
                        }
                    }
                });

                for _ in 0..128 {
                    match tokio::time::timeout(Duration::ZERO, listener.accept()).await {
                        Ok(Ok((stream, peer))) => {
                            let _ = stream.set_nodelay(true);
                            #[cfg(target_os = "linux")]
                            {
                                let fd = stream.as_raw_fd();
                                unsafe {
                                    let val: libc::c_int = 1;
                                    libc::setsockopt(
                                        fd,
                                        libc::IPPROTO_TCP,
                                        libc::TCP_QUICKACK,
                                        &val as *const _ as *const libc::c_void,
                                        std::mem::size_of::<libc::c_int>()
                                            as libc::socklen_t,
                                    );
                                }
                            }
                            let mut handler = base_handler.clone_fast();
                            handler.peer = peer;
                            tokio::spawn(async move {
                                if let Err(e) = handler.run_plain(stream).await {
                                    if !is_io_noise(&e) {
                                        warn!(%peer, "http conn: {e}");
                                    }
                                }
                            });
                        }
                        _ => break,
                    }
                }
            }
        });
    }
}


fn build_socket(addr: SocketAddr, backlog: i32) -> anyhow::Result<TcpListener> {
    let s = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP))?;
    
    s.set_reuse_address(true)?;
    
    #[cfg(target_os = "linux")]
    {
        s.set_reuse_port(true)?;
        let _ = tcp_fastopen(&s);
        
        let fd = s.as_raw_fd();
        unsafe {
            let val: libc::c_int = 1;
            libc::setsockopt(
                fd,
                libc::IPPROTO_TCP,
                libc::TCP_DEFER_ACCEPT,
                &val as *const _ as *const libc::c_void,
                std::mem::size_of::<libc::c_int>() as libc::socklen_t,
            );
        }
    }
    
    s.set_nodelay(true)?;
    s.set_nonblocking(true)?;
    
    let _ = s.set_recv_buffer_size(2 * 1024 * 1024);
    let _ = s.set_send_buffer_size(2 * 1024 * 1024);
    
    s.bind(&addr.into())?;
    s.listen(backlog)?;
    
    Ok(TcpListener::from_std(s.into())?)
}

#[cfg(target_os = "linux")]
fn tcp_fastopen(s: &Socket) -> std::io::Result<()> {
    let val: libc::c_int = 256;
    let ret = unsafe {
        libc::setsockopt(
            s.as_raw_fd(),
            libc::IPPROTO_TCP,
            libc::TCP_FASTOPEN,
            &val as *const _ as *const libc::c_void,
            std::mem::size_of::<libc::c_int>() as libc::socklen_t,
        )
    };
    if ret == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
fn pin_to_core(core: usize) {
    use libc::{cpu_set_t, CPU_SET, CPU_ZERO, sched_setaffinity};
    use std::mem::{size_of, zeroed};
    
    unsafe {
        let mut set: cpu_set_t = zeroed();
        CPU_ZERO(&mut set);
        CPU_SET(core, &mut set);
        sched_setaffinity(0, size_of::<cpu_set_t>(), &set);
    }
}

fn build_tls_config(tls: &config::TlsConfig, routes: &[config::Route]) -> anyhow::Result<Arc<rustls::ServerConfig>> {
    use rustls::pki_types::CertificateDer;

    let (certs, key) = match tls.mode {
        TlsMode::Provided => {
            let cp = tls.cert_path.as_ref().context("cert_path")?;
            let kp = tls.key_path.as_ref().context("key_path")?;
            let cp = std::fs::read(cp)?;
            let kp = std::fs::read(kp)?;
            let certs: Vec<CertificateDer<'static>> = rustls_pemfile::certs(&mut &cp[..])
                .collect::<Result<_, _>>()
                .context("invalid cert PEM")?;
            let key = rustls_pemfile::private_key(&mut &kp[..])
                .context("invalid key PEM")?
                .context("no private key")?;
            (certs, key)
        }
        TlsMode::SelfSigned => {
            gen_self_signed(tls.hostname.as_deref().unwrap_or("localhost"))?
        }
        TlsMode::LetsEncrypt => load_le(tls)?,
    };

    let sni_certs: Vec<(String, Arc<rustls::sign::CertifiedKey>)> = routes
        .iter()
        .filter_map(|r| {
            let pt = r.tls.as_ref()?;
            let cp = std::fs::read(&pt.cert_path).ok()?;
            let kp = std::fs::read(&pt.key_path).ok()?;
            let certs: Vec<CertificateDer<'static>> =
                rustls_pemfile::certs(&mut &cp[..]).collect::<Result<_, _>>().ok()?;
            let key = rustls_pemfile::private_key(&mut &kp[..]).ok()??;
            let sk = rustls::crypto::ring::sign::any_supported_type(&key).ok()?;
            Some((r.domain.clone(), Arc::new(rustls::sign::CertifiedKey::new(certs, sk))))
        })
        .collect();
    let signing_key = rustls::crypto::ring::sign::any_supported_type(&key)?;
    let default_ck = Arc::new(rustls::sign::CertifiedKey::new(certs, signing_key));

    let mut cfg = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_cert_resolver(Arc::new(SniResolver { default: default_ck, sni: sni_certs }));

    cfg.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    cfg.send_tls13_tickets = 0;
    cfg.session_storage = rustls::server::ServerSessionMemoryCache::new(4096);
    cfg.max_fragment_size = Some(16384);

    Ok(Arc::new(cfg))
}

#[derive(Debug)]
struct SniResolver {
    default: Arc<rustls::sign::CertifiedKey>,
    sni: Vec<(String, Arc<rustls::sign::CertifiedKey>)>,
}

impl rustls::server::ResolvesServerCert for SniResolver {
    fn resolve(&self, client_hello: rustls::server::ClientHello<'_>) -> Option<Arc<rustls::sign::CertifiedKey>> {
        if let Some(name) = client_hello.server_name() {
            for (domain, ck) in &self.sni {
                if domain == name {
                    return Some(ck.clone());
                }
            }
        }
        Some(self.default.clone())
    }
}

fn build_openssl_acceptor(tls: &config::TlsConfig) -> anyhow::Result<openssl::ssl::SslAcceptor> {
    use openssl::ssl::{SslAcceptor, SslMethod, SslFiletype};
    let mut builder = SslAcceptor::mozilla_intermediate_v5(SslMethod::tls_server())
        .context("OpenSSL acceptor")?;
    builder.set_alpn_protos(b"\x02h2\x08http/1.1")?;
    builder.set_alpn_select_callback(|_ssl, client_protos| {
        if client_protos.windows(2).any(|w| w == b"h2") {
            Ok(b"h2")
        } else {
            Ok(b"http/1.1")
        }
    });

    match tls.mode {
        config::TlsMode::Provided => {
            let cert = tls.cert_path.as_ref().context("cert_path")?;
            let key = tls.key_path.as_ref().context("key_path")?;
            builder.set_certificate_file(cert, SslFiletype::PEM)?;
            builder.set_private_key_file(key, SslFiletype::PEM)?;
        }
        config::TlsMode::SelfSigned => {
            let (cert, key) = gen_ossl_self_signed(
                tls.hostname.as_deref().unwrap_or("localhost"),
            )?;
            builder.set_certificate(&cert)?;
            builder.set_private_key(&key)?;
        }
        config::TlsMode::LetsEncrypt => {
            let cache = tls.acme_cache_dir
                .as_deref()
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| std::path::PathBuf::from("/var/lib/eclihalo/acme"));
            builder.set_certificate_file(cache.join("cert.pem"), SslFiletype::PEM)?;
            builder.set_private_key_file(cache.join("key.pem"), SslFiletype::PEM)?;
        }
    }
    Ok(builder.build())
}

fn gen_ossl_self_signed(
    hostname: &str,
) -> anyhow::Result<(openssl::x509::X509, openssl::pkey::PKey<openssl::pkey::Private>)> {
    use openssl::asn1::Asn1Time;
    use openssl::bn::BigNum;
    use openssl::hash::MessageDigest;
    use openssl::pkey::PKey;
    use openssl::rsa::Rsa;
    use openssl::x509::{X509, X509NameBuilder};

    let rsa = Rsa::generate(2048)?;
    let pkey = PKey::from_rsa(rsa)?;

    let mut name_builder = X509NameBuilder::new()?;
    name_builder.append_entry_by_text("CN", hostname)?;
    let name = name_builder.build();

    let mut builder = X509::builder()?;
    builder.set_version(2)?;
    builder.set_subject_name(&name)?;
    builder.set_issuer_name(&name)?;
    builder.set_pubkey(&pkey)?;
    let now = Asn1Time::days_from_now(0)?;
    let year = Asn1Time::days_from_now(365)?;
    builder.set_not_before(&now)?;
    builder.set_not_after(&year)?;
    let serial = BigNum::from_u32(1)?;
    builder.set_serial_number(serial.to_asn1_integer()?.as_ref())?;
    builder.sign(&pkey, MessageDigest::sha256())?;

    Ok((builder.build(), pkey))
}

fn load_le(
    tls: &config::TlsConfig,
) -> anyhow::Result<(
    Vec<rustls::pki_types::CertificateDer<'static>>,
    rustls::pki_types::PrivateKeyDer<'static>,
)> {
    use rustls::pki_types::CertificateDer;
    let cache = tls
        .acme_cache_dir
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/var/lib/eclihalo/acme"));
    let cp = std::fs::read(cache.join("cert.pem"))?;
    let kp = std::fs::read(cache.join("key.pem"))?;
    let certs: Vec<CertificateDer<'static>> = rustls_pemfile::certs(&mut &cp[..])
        .collect::<Result<_, _>>()
        .context("invalid cert PEM")?;
    let key = rustls_pemfile::private_key(&mut &kp[..])
        .context("invalid key PEM")?
        .context("no private key")?;
    Ok((certs, key))
}

fn gen_self_signed(
    hostname: &str,
) -> anyhow::Result<(
    Vec<rustls::pki_types::CertificateDer<'static>>,
    rustls::pki_types::PrivateKeyDer<'static>,
)> {
    use rcgen::{CertificateParams, DistinguishedName, DnType, KeyPair};
    use rustls::pki_types::CertificateDer;
    let kp = KeyPair::generate_for(&rcgen::PKCS_ECDSA_P256_SHA256)?;
    let mut p = CertificateParams::new(vec![hostname.to_string()])?;
    p.distinguished_name = DistinguishedName::new();
    p.distinguished_name.push(DnType::CommonName, hostname);
    let cert = p.self_signed(&kp)?;
    let certs: Vec<CertificateDer<'static>> = rustls_pemfile::certs(&mut cert.pem().as_bytes())
        .collect::<Result<_, _>>()?;
    let key = rustls_pemfile::private_key(&mut kp.serialize_pem().as_bytes())?
        .context("no key in generated PEM")?;
    Ok((certs, key))
}

async fn run_reload() -> anyhow::Result<()> {
    let out = std::process::Command::new("pgrep")
        .args(["-x", "eclihalo"])
        .output()?;
    anyhow::ensure!(out.status.success(), "no eclihalo process");
    let pid: i32 = String::from_utf8(out.stdout)?.trim().parse()?;
    unsafe { libc::kill(pid, libc::SIGHUP) };
    info!(%pid, "SIGHUP sent");
    Ok(())
}

fn print_systemd_unit() { //Scawwy
    let exe = std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "/usr/local/bin/eclihalo".into());
    println!(
        r#"[Unit]
Description=EcliHalo RP
After=network.target

[Service]
Type=simple
ExecStart={exe} start --config /etc/eclihalo/config.yml
ExecReload={exe} reload
Restart=on-failure
RestartSec=5s
AmbientCapabilities=CAP_NET_BIND_SERVICE
LimitNOFILE=1048576
LimitNPROC=65536
CPUSchedulingPolicy=fifo
CPUSchedulingPriority=50
IOSchedulingClass=realtime
IOSchedulingPriority=0

[Install]
WantedBy=multi-user.target
"#
    );
}

#[inline(always)]
fn is_tls_noise(s: &str) -> bool {
    s.contains("alert")
        || s.contains("eof")
        || s.contains("reset")
        || s.contains("unspecific protocol error")
        || s.contains("unexpected")
        || s.contains("peer closed")
}

#[inline(always)]
fn is_io_noise(e: &(dyn std::error::Error + 'static)) -> bool {
    use std::io::ErrorKind::*;
    if let Some(io) = e.downcast_ref::<std::io::Error>() {
        if matches!(
            io.kind(),
            ConnectionReset | ConnectionAborted | BrokenPipe | UnexpectedEof
        ) {
            return true;
        }
    }
    is_tls_noise(&e.to_string())
}