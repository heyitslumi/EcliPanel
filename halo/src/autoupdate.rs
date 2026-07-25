use crate::config::AutoUpdateConfig;
use anyhow::Context;
use std::path::PathBuf;
use tracing::{error, info, warn};

pub fn spawn_update_checker(cfg: AutoUpdateConfig) {
    if !cfg.enabled {
        info!("auto-update disabled");
        return;
    }

    let interval = std::time::Duration::from_secs((cfg.check_interval_hours * 3600).max(3600) as u64);

    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .unwrap_or_default();

        loop {
            match check_and_update(&cfg, &client).await {
                Ok(true) => info!("update applied, restarting"),
                Ok(false) => {}
                Err(e) => warn!("update check failed: {e}"),
            }
            tokio::time::sleep(interval).await;
        }
    });
}

async fn check_and_update(cfg: &AutoUpdateConfig, client: &reqwest::Client) -> anyhow::Result<bool> {
    let download_url = cfg.download_url.trim_end_matches('/');
    let version_url = format!("{download_url}/version");

    let remote_version = match client.get(&version_url).send().await {
        Ok(resp) if resp.status().is_success() => resp.text().await?.trim().to_string(),
        Ok(resp) => {
            warn!("version check returned HTTP {}", resp.status());
            return Ok(false);
        }
        Err(e) => {
            warn!("version check failed: {e}");
            return Ok(false);
        }
    };

    let local_version = env!("CARGO_PKG_VERSION");
    if remote_version == local_version {
        return Ok(false);
    }

    info!("update available: {local_version} → {remote_version}");

    let bytes = client.get(download_url).send().await?.bytes().await?;
    info!(size = bytes.len(), "binary downloaded");

    let current = std::env::current_exe().context("cannot find current binary")?;

    let backup = current.with_extension("bak");
    if let Err(e) = std::fs::copy(&current, &backup) {
        warn!("backup failed: {e}");
    }

    let tmp = current.with_extension("tmp");
    std::fs::write(&tmp, &bytes)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&tmp)?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&tmp, perms)?;
    }

    std::fs::rename(&tmp, &current)?;
    info!("binary replaced → restarting");

    restart();
    Ok(true)
}

fn restart() {
    if let Ok(s) = std::process::Command::new("systemctl")
        .args(["restart", "eclihalo"])
        .status()
    {
        if s.success() {
            info!("systemctl restart eclihalo, exiting");
            std::process::exit(0);
        }
    }

    warn!("systemctl restart failed, attempting exec");
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let args: Vec<String> = std::env::args().collect();
        let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("eclihalo"));
        let _ = std::process::Command::new(exe).args(&args[1..]).exec();
    }
    error!("exec failed please restart manually");
}