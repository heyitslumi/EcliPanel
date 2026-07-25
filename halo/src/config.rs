use anyhow::Context;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

#[derive(Debug, Clone, Deserialize, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum LbStrategy {
    #[default]
    RoundRobin,
    LeastConnections,
    IpHash,
    Random,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct StaticFiles {
    pub root: String,
    #[serde(default = "default_index")]
    pub index: String,
    #[serde(default)]
    pub precompressed: bool,
    #[serde(default = "default_max_age")]
    pub max_age: u32,
    #[serde(default = "default_true")]
    pub cache_enabled: bool,
    #[serde(default)]
    pub cache_strategy: CacheStrategy,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum CacheStrategy {
    #[default]
    Ttl,
    Mtime,
    None,
    Smart,
}

fn default_index() -> String {
    "index.html".into()
}
fn default_max_age() -> u32 {
    3_600
}

#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
pub struct WebRtcConfig {
    #[serde(default)]
    pub cors: bool,
    #[serde(default)]
    pub signalling_paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
pub struct HeaderRules {
    #[serde(default)]
    pub set_request: HashMap<String, String>,
    #[serde(default)]
    pub remove_request: Vec<String>,
    #[serde(default)]
    pub set_response: HashMap<String, String>,
    #[serde(default)]
    pub remove_response: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Route {
    pub domain: String,
    #[serde(default)]
    pub upstreams: Vec<String>,
    #[serde(default)]
    pub websocket: bool,
    #[serde(default)]
    pub webrtc: Option<WebRtcConfig>,
    #[serde(default)]
    pub strategy: LbStrategy,
    #[serde(default = "default_max_body")]
    pub max_body_bytes: u64,
    #[serde(default = "default_timeout")]
    pub upstream_timeout_secs: u64,
    #[serde(default)]
    pub static_files: Option<StaticFiles>,
    #[serde(default)]
    pub add_headers: HashMap<String, String>,
    #[serde(default)]
    pub header_rules: HeaderRules,
    #[serde(default = "default_true")]
    pub grpc: bool,
    #[serde(default)]
    pub error_pages: HashMap<u16, String>,
    #[serde(default)]
    pub rewrites: HashMap<String, String>,
    #[serde(default)]
    pub tls: Option<PerRouteTls>,
    #[serde(default)]
    pub proxy_cache: Option<ProxyCacheConfig>,
    #[serde(default)]
    pub auth_request: Option<AuthRequestConfig>,
    #[serde(default)]
    pub retry: Option<RetryConfig>,
    #[serde(default)]
    pub access_log: Option<String>,
    #[serde(default)]
    pub upstream_connect_timeout: Option<u64>,
    #[serde(default)]
    pub upstream_read_timeout: Option<u64>,
    #[serde(default)]
    pub proxy_redirect: HashMap<String, String>,
    #[serde(default)]
    pub sub_filter: HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct PerRouteTls { pub cert_path: String, pub key_path: String, }
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ProxyCacheConfig {
    #[serde(default = "default_true")] pub enabled: bool,
    #[serde(default = "default_cache_ttl")] pub ttl_secs: u64,
    #[serde(default = "default_cache_size")] pub max_size_bytes: u64,
}
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct AuthRequestConfig { pub url: String, #[serde(default)] pub timeout_secs: u64, }
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct RetryConfig {
    #[serde(default = "default_retries")] pub tries: u32,
    #[serde(default = "default_retry_timeout")] pub timeout_secs: u64,
}

fn default_max_body() -> u64 { 10 * 1024 * 1024 }
fn default_timeout() -> u64 { 30 }
fn default_cache_ttl() -> u64 { 60 }
fn default_cache_size() -> u64 { 104857600 }
fn default_retries() -> u32 { 2 }
fn default_retry_timeout() -> u64 { 5 }

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TlsMode {
    Provided,
    SelfSigned,
    LetsEncrypt,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct TlsConfig {
    pub mode: TlsMode,
    #[serde(default)]
    pub cert_path: Option<String>,
    #[serde(default)]
    pub key_path: Option<String>,
    #[serde(default)]
    pub hostname: Option<String>,
    #[serde(default)]
    pub acme_email: Option<String>,
    #[serde(default)]
    pub acme_domains: Option<Vec<String>>,
    #[serde(default)]
    pub acme_cache_dir: Option<String>,
    #[serde(default)]
    pub acme_staging: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct RateLimitConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_rate")]
    pub requests_per_sec: u32,
    #[serde(default = "default_burst")]
    pub burst: u32,
    #[serde(default)]
    pub whitelist: Vec<String>,
}

fn default_rate() -> u32 {
    100
}
fn default_burst() -> u32 {
    200
}
fn default_true() -> bool {
    true
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            requests_per_sec: 100,
            burst: 200,
            whitelist: vec![],
        }
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct AutoUpdateConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_update_interval")]
    pub check_interval_hours: u32,
    #[serde(default = "default_update_url")]
    pub download_url: String,
}

fn default_update_interval() -> u32 {
    24
}
fn default_update_url() -> String {
    "https://ecli.app/api/halo/download".into()
}

impl Default for AutoUpdateConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            check_interval_hours: 24,
            download_url: default_update_url(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct HttpConfig {
    #[serde(default = "default_http_port")]
    pub port: u16,
}
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct HttpsConfig {
    #[serde(default = "default_https_port")]
    pub port: u16,
}

fn default_http_port() -> u16 { 80 }
fn default_https_port() -> u16 { 443 }

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct PerformanceConfig {
    #[serde(default = "num_cpus::get")]
    pub worker_threads: usize,
    #[serde(default = "default_backlog")]
    pub accept_backlog: i32,
    #[serde(default = "default_batch")]
    pub accept_batch: usize,
    #[serde(default = "default_true")]
    pub cpu_affinity: bool,
    #[serde(default = "default_event_interval")]
    pub event_interval: u32,
    #[serde(default = "default_queue_interval")]
    pub global_queue_interval: u32,
    #[serde(default = "default_stack_size")]
    pub thread_stack_size: usize,
}
fn default_backlog() -> i32 { 65536 }
fn default_batch() -> usize { 128 }
fn default_event_interval() -> u32 { 31 }
fn default_queue_interval() -> u32 { 61 }
fn default_stack_size() -> usize { 2 * 1024 * 1024 }

impl Default for PerformanceConfig {
    fn default() -> Self {
        Self {
            worker_threads: num_cpus::get(),
            accept_backlog: 65536,
            accept_batch: 128,
            cpu_affinity: true,
            event_interval: 31,
            global_queue_interval: 61,
            thread_stack_size: 2 * 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct EcliHaloConfig {
    pub http: HttpConfig,
    pub https: HttpsConfig,
    pub tls: TlsConfig,
    #[serde(default)]
    pub performance: PerformanceConfig,
    pub routes: Vec<Route>,
    #[serde(default)]
    pub rate_limit: RateLimitConfig,
    #[serde(default)]
    pub auto_update: AutoUpdateConfig,
    #[serde(default)]
    pub metrics: bool,
    #[serde(skip)]
    pub route_map: HashMap<String, Arc<Route>>,
}

impl EcliHaloConfig {
    pub fn load(path: impl AsRef<Path>) -> anyhow::Result<Self> {
        let raw = std::fs::read_to_string(path.as_ref())
            .with_context(|| format!("cannot read {}", path.as_ref().display()))?;
        let mut cfg: Self = serde_yaml::from_str(&raw).context("invalid YAML")?;
        cfg.validate()?;
        for r in &mut cfg.routes {
            if let Some(ref webrtc) = r.webrtc {
                if webrtc.cors {
                    r.header_rules.set_response.entry("access-control-allow-origin".into())
                        .or_insert("*".into());
                    r.header_rules.set_response.entry("access-control-allow-methods".into())
                        .or_insert("GET, POST, OPTIONS".into());
                    r.header_rules.set_response.entry("access-control-allow-headers".into())
                        .or_insert("content-type, authorization".into());
                }
            }
        }
        cfg.route_map = cfg
            .routes
            .iter()
            .map(|r| (r.domain.to_lowercase(), Arc::new(r.clone())))
            .collect();
        Ok(cfg)
    }

    pub fn route_for(&self, host: &str) -> Option<Arc<Route>> {
        self.route_map.get(host).cloned()
    }

    fn validate(&self) -> anyhow::Result<()> {
        anyhow::ensure!(!self.routes.is_empty(), "no routes defined");

        for (i, r) in self.routes.iter().enumerate() {
            anyhow::ensure!(!r.domain.is_empty(), "route {i}: domain is empty");
            if r.static_files.is_none() {
                anyhow::ensure!(
                    !r.upstreams.is_empty(),
                    "route {i} ({}): no upstreams and no static_files",
                    r.domain
                );
            }
            for u in &r.upstreams {
                let (host, port) = u
                    .rsplit_once(':')
                    .with_context(|| format!("route {i}: upstream '{u}' must be host:port"))?;
                anyhow::ensure!(!host.is_empty(), "route {i}: upstream host is empty");
                port.parse::<u16>()
                    .with_context(|| format!("route {i}: invalid port in '{u}'"))?;
            }
            if let Some(sf) = &r.static_files {
                anyhow::ensure!(!sf.root.is_empty(), "route {i}: static_files.root is empty");
            }
        }

        match self.tls.mode {
            TlsMode::Provided => {
                self.tls
                    .cert_path
                    .as_ref()
                    .context("cert_path required for 'provided' mode")?;
                self.tls
                    .key_path
                    .as_ref()
                    .context("key_path required for 'provided' mode")?;
            }
            TlsMode::LetsEncrypt => {
                self.tls
                    .acme_email
                    .as_ref()
                    .context("acme_email required for 'lets_encrypt' mode")?;
            }
            TlsMode::SelfSigned => {}
        }
        Ok(())
    }
}