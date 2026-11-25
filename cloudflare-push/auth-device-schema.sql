-- Remember a connected device, while keeping Firebase access sessions short lived.
-- Hashes only; changing the owner's password invalidates the remembered login.
CREATE TABLE IF NOT EXISTS auth_devices (
  token_hash TEXT PRIMARY KEY,
  owner TEXT NOT NULL CHECK(owner IN ('rabbit','sweet')),
  version TEXT NOT NULL,
  source_device TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL
);
