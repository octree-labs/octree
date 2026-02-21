CREATE TABLE email_suppressions (
  email TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;
