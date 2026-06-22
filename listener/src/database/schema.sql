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

