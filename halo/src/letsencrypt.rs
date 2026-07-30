// TODO Finish and test
use crate::config::TlsConfig;
use acme_micro::{create_p256_key, Directory, DirectoryUrl};
use anyhow::Context;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tracing::{error, info, warn};

pub type ChallengeTokens = Arc<Mutex<HashMap<String, String>>>;

#[derive(Clone, Debug)]
pub struct AcmeCert {
    pub cert_path: PathBuf,
    #[allow(dead_code)]
    pub key_path: PathBuf,
}

#[allow(dead_code)]
pub fn lookup_challenge(challenges: &ChallengeTokens, path: &str) -> Option<String> {
    let token = path.strip_prefix("/.well-known/acme-challenge/")?;
    challenges.lock().unwrap().get(token).cloned()
}

pub async fn order_certificate(
    tls: &TlsConfig,
    challenges: &ChallengeTokens,
) -> anyhow::Result<AcmeCert> {
    let email = tls.acme_email.clone().context("acme_email required")?;
    let domains = tls.acme_domains.clone().context("acme_domains required")?;
    anyhow::ensure!(!domains.is_empty(), "acme_domains must not be empty");

    let cache_dir = acme_cache_dir(tls);
    fs::create_dir_all(&cache_dir)?;

    let cert_path = cache_dir.join("cert.pem");
    let key_path = cache_dir.join("key.pem");

    let staging = tls.acme_staging;
    let ch = challenges.clone();
    let cp = cert_path.clone();
    let kp = key_path.clone();

    tokio::task::spawn_blocking(move || {
        order_blocking(&email, &domains, staging, &cache_dir, &ch, &cp, &kp)
    })
    .await
    .context("ACME task panicked")??;

    Ok(AcmeCert { cert_path, key_path })
}

fn order_blocking(
    email: &str,
    domains: &[String],
    staging: bool,
    cache_dir: &Path,
    challenges: &ChallengeTokens,
    cert_path: &Path,
    key_path: &Path,
) -> anyhow::Result<()> {
    let contact = vec![format!("mailto:{email}")];
    let dir_url = if staging {
        DirectoryUrl::LetsEncryptStaging
    } else {
        DirectoryUrl::LetsEncrypt
    };
    let dir = Directory::from_url(dir_url)?;

    let acc_key_path = cache_dir.join("account.pem");
    let account = if acc_key_path.exists() {
        let pem = fs::read_to_string(&acc_key_path).context("failed to read account key")?;
        dir.load_account(&pem, contact)?
    } else {
        let acc = dir.register_account(contact)?;
        fs::write(&acc_key_path, acc.acme_private_key_pem()?)?;
        acc
    };
    info!(%email, "ACME account ready");

    let primary = &domains[0];
    let alts: Vec<&str> = domains[1..].iter().map(String::as_str).collect();
    let mut order = account.new_order(primary, &alts)?;
    info!("ACME order created for {:?}", domains);

    for auth in order.authorizations()? {
        let challenge = auth.http_challenge()
            .context("no http challenge available")?;
        let token = challenge.http_token().to_string();
        let proof = challenge.http_proof()?;

        challenges.lock().unwrap().insert(token.clone(), proof);
        info!(%token, "serving ACME challenge");

        challenge.validate(Duration::from_millis(5_000))?;
        info!(%token, "ACME challenge validated");

        challenges.lock().unwrap().remove(&token);
    }

    order.refresh()?;
    let csr_order = order
        .confirm_validations()
        .context("order not ready, validations may have failed")?;

    let pkey = create_p256_key()?;
    let pkey_pem = pkey
        .private_key_to_pem_pkcs8()
        .map_err(|e| anyhow::anyhow!("private key export: {e}"))?;
    let pkey_str = String::from_utf8_lossy(&pkey_pem).into_owned();

    let cert_order = csr_order.finalize(&pkey_str, Duration::from_millis(5_000))?;
    let cert = cert_order.download_cert()?;

    fs::write(cert_path, cert.certificate())?;
    fs::write(key_path, cert.private_key())?;
    info!("certificate issued: {}", cert_path.display());
    Ok(())
}

pub fn spawn_renewal_task(tls: TlsConfig, challenges: ChallengeTokens) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3_600));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        interval.tick().await;

        loop {
            interval.tick().await;
            let cert_path = acme_cache_dir(&tls).join("cert.pem");

            let needs_renewal = tokio::task::spawn_blocking({
                let cp = cert_path.clone();
                move || should_renew(&cp, 30)
            })
            .await
            .unwrap_or(false);

            if needs_renewal {
                info!("certificate expires within 30 days, renewing");
                match order_certificate(&tls, &challenges).await {
                    Ok(c) => info!("renewed: {}", c.cert_path.display()),
                    Err(e) => error!("ACME renewal failed: {e:#}"),
                }
            }
        }
    });
}

fn acme_cache_dir(tls: &TlsConfig) -> PathBuf {
    tls.acme_cache_dir
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/var/lib/eclihalo/acme"))
}

fn should_renew(cert_path: &Path, days_before: u32) -> bool {
    match days_remaining(cert_path) {
        Some(d) => {
            if d <= days_before {
                warn!(days = d, "certificate expiring soon");
                true
            } else {
                info!(days = d, "certificate OK");
                false
            }
        }
        None => {
            warn!("could not determine certificate expiry");
            false
        }
    }
}

fn days_remaining(cert_path: &Path) -> Option<u32> {
    let pem = fs::read(cert_path).ok()?;

    let der: Vec<u8> = rustls_pemfile::certs(&mut pem.as_slice())
        .filter_map(|r| r.ok())
        .next()
        .map(|c| c.to_vec())?;

    let (_, cert) = x509_parser::parse_x509_certificate(&der).ok()?;
    let not_after = cert.validity().not_after.timestamp();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs() as i64;

    let remaining_secs = not_after.saturating_sub(now);
    Some((remaining_secs / 86_400).max(0) as u32)
}