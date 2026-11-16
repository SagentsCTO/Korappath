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

-- Form submissions that used to go to Formspree: photo/story, write.html, tree photos, access requests.
-- Private: only visible on the admin page. Uploaded photos live in the UPLOADS KV namespace under upload/<id>.
CREATE TABLE IF NOT EXISTS submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT    NOT NULL,                    -- story | write | tree-photo | access
  fields      TEXT    NOT NULL,                    -- JSON object of the form fields
  file_name   TEXT,
  file_type   TEXT,
  file_size   INTEGER,
  status      TEXT    NOT NULL DEFAULT 'new',      -- new | done
  created_at  TEXT    NOT NULL,
  handled_at  TEXT,
  ip_hash     TEXT
);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions (status, created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_ip ON submissions (ip_hash, created_at);
