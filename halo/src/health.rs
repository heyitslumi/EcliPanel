use crate::balancer::Balancer;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tracing::{info, warn};

pub type BalancerRegistry = HashMap<String, Arc<Balancer>>;

pub fn build_registry(routes: &[crate::config::Route]) -> BalancerRegistry {
    routes
        .iter()
        .map(|r| {
            (
                r.domain.to_lowercase(),
                Arc::new(Balancer::new(r.upstreams.clone())),
            )
        })
        .collect()
}

pub fn spawn_health_checker(registry: Arc<RwLock<BalancerRegistry>>, interval: Duration) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            ticker.tick().await;
            check_all(&registry).await;
        }
    });
}

async fn check_all(registry: &Arc<RwLock<BalancerRegistry>>) {
    let snapshot: Vec<(String, Arc<Balancer>)> = {
        let reg = registry.read().await;
        reg.iter().map(|(d, b)| (d.clone(), b.clone())).collect()
    };

    for (domain, balancer) in snapshot {
        let checks: Vec<(String, bool)> = balancer
            .stats()
            .map(|(addr, stats)| {
                (
                    addr.to_owned(),
                    stats.healthy.load(std::sync::atomic::Ordering::Relaxed),
                )
            })
            .collect();

        for (addr, was_healthy) in checks {
            let now_healthy = probe(&addr).await;
            if was_healthy != now_healthy {
                if now_healthy {
                    balancer.mark_healthy(&addr);
                    info!(%domain, %addr, "upstream recovered");
                } else {
                    balancer.mark_unhealthy(&addr);
                    warn!(%domain, %addr, "upstream unhealthy, removed from rotation");
                }
            }
        }
    }
}

async fn probe(addr: &str) -> bool {
    tokio::time::timeout(Duration::from_secs(3), tokio::net::TcpStream::connect(addr))
        .await
        .map(|r| r.is_ok())
        .unwrap_or(false)
}