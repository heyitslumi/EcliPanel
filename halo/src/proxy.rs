use crate::config::EcliHaloConfig;
use crate::health::BalancerRegistry;
use arc_swap::ArcSwap;
use std::sync::Arc;

pub type SharedState = Arc<ArcSwap<EcliHaloConfig>>;
pub type SharedRegistry = Arc<ArcSwap<BalancerRegistry>>;