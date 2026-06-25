-- Scheduled Notifications Database Schema
-- SQLite Database Schema for storing and tracking scheduled notifications

-- Main table for scheduled notifications
CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Notification content and metadata
  payload TEXT NOT NULL,                    -- JSON payload of the notification
  notification_type VARCHAR(50) NOT NULL,   -- Type: 'discord', 'email', 'webhook', etc.
  target_recipient TEXT NOT NULL,           -- User ID, webhook URL, or recipient identifier
  
  -- Scheduling information
  execute_at DATETIME NOT NULL,             -- When the notification should be sent
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Status tracking
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, PROCESSING, COMPLETED, FAILED, CANCELLED
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  
  -- Processing metadata
  processing_started_at DATETIME,
  processing_completed_at DATETIME,
  processor_id VARCHAR(100),                -- Identifier of the worker processing this job
  lock_expires_at DATETIME,                 -- Distributed lock expiration for race condition prevention
  
  -- Error tracking
  last_error TEXT,
  error_details TEXT,                       -- JSON with full error context
  
  -- Additional metadata
  event_id TEXT,                            -- Reference to the original event (if applicable)
  contract_address TEXT,                    -- Stellar contract address (if applicable)
  priority INTEGER NOT NULL DEFAULT 5,      -- 1-10, lower = higher priority
  metadata TEXT                             -- Additional JSON metadata
);

-- Indexes for performance optimization
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_status 
  ON scheduled_notifications(status);

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_status_execute_at 
  ON scheduled_notifications(status, execute_at) 
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_lock_expires 
  ON scheduled_notifications(lock_expires_at, status) 
  WHERE status = 'PROCESSING';

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_next_retry_at
  ON scheduled_notifications(next_retry_at, status)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_created_at 
  ON scheduled_notifications(created_at);

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_event_id 
  ON scheduled_notifications(event_id) 
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_target 
  ON scheduled_notifications(target_recipient, status);

-- Notification execution history for auditing
CREATE TABLE IF NOT EXISTS notification_execution_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scheduled_notification_id INTEGER NOT NULL,
  execution_attempt INTEGER NOT NULL,
  execution_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) NOT NULL,              -- SUCCESS, FAILED, RETRY
  error_message TEXT,
  response_data TEXT,                       -- JSON response from notification service
  duration_ms INTEGER,
  
  FOREIGN KEY (scheduled_notification_id) REFERENCES scheduled_notifications(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_execution_log_notification_id 
  ON notification_execution_log(scheduled_notification_id);

CREATE INDEX IF NOT EXISTS idx_execution_log_execution_time 
  ON notification_execution_log(execution_time);

CREATE INDEX IF NOT EXISTS idx_execution_log_status_execution_time 
  ON notification_execution_log(status, execution_time);

-- Migration: add next_retry_at for explicit retry scheduling
ALTER TABLE scheduled_notifications ADD COLUMN next_retry_at DATETIME;

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_scheduled_notifications_timestamp 
AFTER UPDATE ON scheduled_notifications
FOR EACH ROW
BEGIN
  UPDATE scheduled_notifications 
  SET updated_at = CURRENT_TIMESTAMP 
  WHERE id = NEW.id;
END;

-- Rate limit events table for auditing
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL,                  -- IP address or API key
  client_type VARCHAR(20) NOT NULL,         -- 'IP' or 'API_KEY'
  endpoint TEXT NOT NULL,                   -- Request path/method
  method VARCHAR(10) NOT NULL,              -- Request method
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  limit_threshold INTEGER NOT NULL,
  window_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_timestamp 
  ON rate_limit_events(timestamp);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_client_id 
  ON rate_limit_events(client_id);

-- Notification templates
CREATE TABLE IF NOT EXISTS notification_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  variables TEXT,
  metadata TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notification_templates_type
  ON notification_templates(type);

CREATE TRIGGER IF NOT EXISTS update_notification_templates_timestamp
AFTER UPDATE ON notification_templates
FOR EACH ROW
BEGIN
  UPDATE notification_templates
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.id;
END;

-- Immutable audit trail for template modifications
CREATE TABLE IF NOT EXISTS notification_template_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'UPDATE',
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  previous_snapshot TEXT NOT NULL,
  new_snapshot TEXT NOT NULL,
  FOREIGN KEY (template_id) REFERENCES notification_templates(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_template_audit_template_id
  ON notification_template_audit_log(template_id);

CREATE INDEX IF NOT EXISTS idx_template_audit_changed_at
  ON notification_template_audit_log(changed_at);

CREATE TRIGGER IF NOT EXISTS prevent_template_audit_update
BEFORE UPDATE ON notification_template_audit_log
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Audit records are immutable');
END;

CREATE TRIGGER IF NOT EXISTS prevent_template_audit_delete
BEFORE DELETE ON notification_template_audit_log
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'Audit records are immutable');
END;

-- Event processing deduplication table - tracks processed events to prevent duplicates during reorgs
-- This table ensures idempotent processing of events even after blockchain reorganizations
CREATE TABLE IF NOT EXISTS processed_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Event identification (fingerprint components)
  event_id TEXT NOT NULL,                   -- Unique identifier from blockchain RPC
  contract_address TEXT NOT NULL,           -- Contract that emitted the event
  fingerprint TEXT NOT NULL UNIQUE,         -- Composite key: contract_address:event_id (for faster lookups)
  
  -- Processing metadata
  ledger_number INTEGER NOT NULL,           -- Ledger in which the event occurred
  tx_hash TEXT,                             -- Transaction hash (if available)
  event_type VARCHAR(50) NOT NULL,          -- Type from RPC (contract, system, etc)
  processed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Reorg detection and tracking
  is_reorg_duplicate BOOLEAN NOT NULL DEFAULT 0, -- Flag indicating this is a duplicate from a reorg
  reorg_detection_count INTEGER NOT NULL DEFAULT 0, -- Number of times this event was redetected
  last_redetected_at DATETIME,              -- When the event was last detected again (for reorg monitoring)
  
  -- Status and metadata
  status VARCHAR(20) NOT NULL DEFAULT 'PROCESSED', -- PROCESSED, SKIPPED, ERROR
  notification_sent BOOLEAN NOT NULL DEFAULT 0,     -- Whether a notification was sent for this event
  error_reason TEXT                         -- If status is ERROR, what went wrong
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_processed_events_fingerprint 
  ON processed_events(fingerprint);

CREATE INDEX IF NOT EXISTS idx_processed_events_contract_event 
  ON processed_events(contract_address, event_id);

CREATE INDEX IF NOT EXISTS idx_processed_events_processed_at 
  ON processed_events(processed_at);

CREATE INDEX IF NOT EXISTS idx_processed_events_reorg_duplicates 
  ON processed_events(is_reorg_duplicate, processed_at) 
  WHERE is_reorg_duplicate = 1;

CREATE INDEX IF NOT EXISTS idx_processed_events_ledger_contract 
  ON processed_events(ledger_number, contract_address);

-- Cursor tracking for event polling to detect reorgs
CREATE TABLE IF NOT EXISTS polling_cursors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Contract tracking
  contract_address TEXT NOT NULL UNIQUE,    -- Which contract this cursor is for
  
  -- Cursor information
  cursor TEXT NOT NULL,                     -- Last known cursor from RPC
  ledger_number INTEGER NOT NULL,           -- Ledger number associated with this cursor
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Reorg detection
  reorg_detected BOOLEAN NOT NULL DEFAULT 0, -- Whether a reorg was detected on the last poll
  reorg_detection_count INTEGER NOT NULL DEFAULT 0 -- Total number of reorgs detected for this contract
);

CREATE INDEX IF NOT EXISTS idx_polling_cursors_contract 
  ON polling_cursors(contract_address);

CREATE INDEX IF NOT EXISTS idx_polling_cursors_updated_at 
  ON polling_cursors(updated_at);

