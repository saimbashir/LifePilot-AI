-- Source-level schema migration reference. Applied idempotently at backend startup by monitoring/monitor.mjs.
-- This file is for operational review, NOT a separate auto-run migration tool.
CREATE TABLE IF NOT EXISTS monitor_state (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  history_id TEXT,
  last_checked INTEGER,
  last_success INTEGER,
  last_error TEXT,
  last_message_at INTEGER,
  lock_until INTEGER NOT NULL DEFAULT 0,
  heartbeat_at INTEGER,
  scheduler_heartbeat INTEGER,
  new_count INTEGER NOT NULL DEFAULT 0,
  lost_history INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS monitor_events (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  notified_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id,message_id)
);
CREATE INDEX IF NOT EXISTS idx_monitor_pending ON monitor_events(account_id,notified_at);
