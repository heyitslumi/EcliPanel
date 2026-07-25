use crossbeam::queue::SegQueue;
use dashmap::DashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;

const MAX_IDLE: usize = 256;
const CONNECT_TIMEOUT: u64 = 5;

pub struct UpstreamPool {
    slots: DashMap<String, Arc<SegQueue<TcpStream>>>,
}

impl UpstreamPool {
    pub fn new() -> Self {
        Self {
            slots: DashMap::new(),
        }
    }

    pub fn try_get(&self, addr: &str) -> Option<TcpStream> {
        self.queue_for(addr).pop()
    }

    pub async fn get(&self, addr: &str) -> std::io::Result<TcpStream> {
        if let Some(conn) = self.try_get(addr) {
            return Ok(conn);
        }

        let stream = tokio::time::timeout(
            Duration::from_secs(CONNECT_TIMEOUT),
            TcpStream::connect(addr),
        )
        .await
        .map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                format!("connect timeout: {addr}"),
            )
        })??;

        stream.set_nodelay(true)?;
        Ok(stream)
    }

    pub fn release(&self, addr: &str, conn: TcpStream) {
        let queue = self.queue_for(addr);
        if queue.len() < MAX_IDLE {
            queue.push(conn);
        }
    }

    pub fn discard(&self, _addr: &str, conn: TcpStream) {
        drop(conn);
    }

    fn queue_for(&self, addr: &str) -> Arc<SegQueue<TcpStream>> {
        if let Some(q) = self.slots.get(addr) {
            return q.clone();
        }
        self.slots
            .entry(addr.to_owned())
            .or_insert_with(|| Arc::new(SegQueue::new()))
            .clone()
    }
}