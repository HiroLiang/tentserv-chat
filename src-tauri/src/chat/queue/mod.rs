use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

#[derive(Debug, Clone)]
pub struct RuntimeQueue<T: Clone + Send + 'static> {
    pub business_tx: UnboundedSender<T>,
    pub sync_tx: UnboundedSender<T>,
    sync_keys: Arc<Mutex<HashSet<String>>>,
}

impl<T: Clone + Send + 'static> RuntimeQueue<T> {
    pub fn new() -> (Self, UnboundedReceiver<T>, UnboundedReceiver<T>) {
        let (business_tx, business_rx) = unbounded_channel();
        let (sync_tx, sync_rx) = unbounded_channel();
        (
            Self {
                business_tx,
                sync_tx,
                sync_keys: Arc::new(Mutex::new(HashSet::new())),
            },
            business_rx,
            sync_rx,
        )
    }

    pub fn enqueue_business(&self, job: T) -> Result<(), String> {
        self.business_tx
            .send(job)
            .map_err(|err| format!("enqueue business job failed: {err}"))
    }

    pub fn enqueue_sync(&self, key: impl Into<String>, job: T) -> Result<bool, String> {
        let key = key.into();
        {
            let mut keys = self
                .sync_keys
                .lock()
                .map_err(|_| "lock sync queue keys failed".to_string())?;
            if keys.contains(&key) {
                return Ok(false);
            }
            keys.insert(key.clone());
        }

        if let Err(err) = self.sync_tx.send(job) {
            let mut keys = self
                .sync_keys
                .lock()
                .map_err(|_| "lock sync queue keys rollback failed".to_string())?;
            keys.remove(&key);
            return Err(format!("enqueue sync job failed: {err}"));
        }

        Ok(true)
    }

    pub fn finish_sync(&self, key: &str) {
        if let Ok(mut keys) = self.sync_keys.lock() {
            keys.remove(key);
        }
    }

    pub fn pending_sync_jobs(&self) -> usize {
        self.sync_keys.lock().map(|keys| keys.len()).unwrap_or(0)
    }
}
