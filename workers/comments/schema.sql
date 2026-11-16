-- Comment store for korappath.com chapter pages.
-- Every comment starts as 'pending' and is only shown publicly once Raju approves it.
CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id    TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  text        TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_at  TEXT    NOT NULL,                    -- ISO 8601, UTC
  reviewed_at TEXT,
  ip_hash     TEXT                                 -- salted hash, only used for rate limiting
);
CREATE INDEX IF NOT EXISTS idx_comments_story_status ON comments (story_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments (status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_ip ON comments (ip_hash, created_at);
