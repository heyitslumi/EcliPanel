use crate::config::RateLimitConfig;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::Instant;

const SHARD_COUNT: usize = 64;
const CLEANUP_THRESHOLD: usize = 10_000;
const CLEANUP_IDLE_SECS: u64 = 60;

#[derive(Debug)]
struct Bucket {
    tokens: f64,
    last_refill: Instant,
}

pub struct RateLimiter {
    shards: Box<[Mutex<HashMap<IpAddr, Bucket>>]>,
    rate: f64,
    burst: f64,
    enabled: bool,
    whitelist: Vec<String>,
}

impl RateLimiter {
    pub fn new(cfg: &RateLimitConfig) -> Self {
        Self {
            shards: (0..SHARD_COUNT)
                .map(|_| Mutex::new(HashMap::new()))
                .collect::<Vec<_>>()
                .into_boxed_slice(),
            rate: cfg.requests_per_sec as f64,
            burst: cfg.burst as f64,
            enabled: cfg.enabled,
            whitelist: cfg.whitelist.clone(),
        }
    }

    pub fn disabled() -> Self {
        Self {
            shards: (0..SHARD_COUNT)
                .map(|_| Mutex::new(HashMap::new()))
                .collect::<Vec<_>>()
                .into_boxed_slice(),
            rate: 1.0,
            burst: 1.0,
            enabled: false,
            whitelist: vec![],
        }
    }

    pub fn check(&self, ip: IpAddr) -> bool {
        if !self.enabled {
            return true;
        }
        if self.is_whitelisted(&ip) {
            return true;
        }

        let idx = hash_ip(&ip) as usize % SHARD_COUNT;
        let mut map = self.shards[idx].lock().unwrap();
        let now = Instant::now();

        if map.len() > CLEANUP_THRESHOLD {
            let burst = self.burst;
            map.retain(|_, b| {
                b.tokens < burst || now.duration_since(b.last_refill).as_secs() < CLEANUP_IDLE_SECS
            });
        }

        let bucket = map.entry(ip).or_insert_with(|| Bucket {
            tokens: self.burst,
            last_refill: now,
        });

        let elapsed = now.duration_since(bucket.last_refill).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * self.rate).min(self.burst);
        bucket.last_refill = now;

        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    fn is_whitelisted(&self, ip: &IpAddr) -> bool {
        let s = ip.to_string();
        self.whitelist.iter().any(|w| w == &s || s.starts_with(w.as_str()))
    }
}

fn hash_ip(ip: &IpAddr) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    ip.hash(&mut h);
    h.finish()
}