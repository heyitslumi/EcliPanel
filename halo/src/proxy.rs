use crate::config::EcliHaloConfig;
use crate::health::BalancerRegistry;
use arc_swap::ArcSwap;
use bytes::Bytes;
use moka::future::Cache;
use std::sync::Arc;
use std::time::Duration;

pub type SharedState = Arc<ArcSwap<EcliHaloConfig>>;
pub type SharedRegistry = Arc<ArcSwap<BalancerRegistry>>;
pub type ProxyCache = Arc<Cache<String, CachedResponse>>;

#[derive(Clone)]
pub struct CachedResponse {
    pub headers: Bytes,
    pub body: Bytes,
}

pub fn build_proxy_cache(max_size: u64, ttl: u64) -> ProxyCache {
    Arc::new(
        Cache::builder()
            .max_capacity(max_size / 4096)
            .time_to_live(Duration::from_secs(ttl))
            .build(),
    )
}