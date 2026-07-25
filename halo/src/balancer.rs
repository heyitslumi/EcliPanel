use crate::config::LbStrategy;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering};

#[derive(Debug)]
pub struct UpstreamStats {
    pub active_connections: AtomicI64,
    pub total_requests: AtomicUsize,
    pub failures: AtomicUsize,
    pub healthy: AtomicBool,
}

impl Default for UpstreamStats {
    fn default() -> Self {
        Self {
            active_connections: AtomicI64::new(0),
            total_requests: AtomicUsize::new(0),
            failures: AtomicUsize::new(0),
            healthy: AtomicBool::new(true),
        }
    }
}

impl UpstreamStats {
    pub fn new() -> Self {
        Self::default()
    }

}

pub struct Balancer {
    upstreams: Vec<String>,
    stats: Vec<UpstreamStats>,
    counter: AtomicUsize,
    len: usize,
}

impl Balancer {
    pub fn new(upstreams: Vec<String>) -> Self {
        let len = upstreams.len();
        let stats = (0..len).map(|_| UpstreamStats::new()).collect();
        Self {
            upstreams,
            stats,
            counter: AtomicUsize::new(0),
            len,
        }
    }

    #[inline]
    pub fn pick(
        &self,
        strategy: &LbStrategy,
        client_ip: Option<&str>,
    ) -> Option<(&str, &UpstreamStats)> {
        if self.len == 0 {
            return None;
        }

        if self.len == 1 {
            let s = &self.stats[0];
            if s.healthy.load(Ordering::Relaxed) {
                return Some((&self.upstreams[0], s));
            }
            return None;
        }

        let mut healthy: Vec<usize> = Vec::with_capacity(self.len);
        let mut all_healthy = true;
        for (i, s) in self.stats.iter().enumerate() {
            if s.healthy.load(Ordering::Relaxed) {
                healthy.push(i);
            } else {
                all_healthy = false;
            }
        }

        if healthy.is_empty() {
            return None;
        }

        let idx = match strategy {
            LbStrategy::RoundRobin => {
                if all_healthy {
                    self.counter.fetch_add(1, Ordering::Relaxed) % self.len
                } else {
                    let n = self.counter.fetch_add(1, Ordering::Relaxed);
                    healthy[n % healthy.len()]
                }
            }

            LbStrategy::LeastConnections => *healthy
                .iter()
                .min_by_key(|&&i| self.stats[i].active_connections.load(Ordering::Relaxed))
                .unwrap(),

            LbStrategy::IpHash => {
                let ip = client_ip.unwrap_or("0.0.0.0");
                let mut h = DefaultHasher::new();
                ip.hash(&mut h);
                healthy[(h.finish() as usize) % healthy.len()]
            }

            LbStrategy::Random => {
                let seed = self.counter.fetch_add(1, Ordering::Relaxed);
                let r = seed
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407);
                healthy[r % healthy.len()]
            }
        };

        Some((&self.upstreams[idx], &self.stats[idx]))
    }

    pub fn stats(&self) -> impl Iterator<Item = (&str, &UpstreamStats)> {
        self.upstreams
            .iter()
            .zip(self.stats.iter())
            .map(|(u, s)| (u.as_str(), s))
    }

    pub fn mark_unhealthy(&self, addr: &str) {
        for (i, u) in self.upstreams.iter().enumerate() {
            if u == addr {
                self.stats[i].healthy.store(false, Ordering::Relaxed);
            }
        }
    }

    pub fn mark_healthy(&self, addr: &str) {
        for (i, u) in self.upstreams.iter().enumerate() {
            if u == addr {
                self.stats[i].healthy.store(true, Ordering::Relaxed);
            }
        }
    }
}