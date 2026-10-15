CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, owner TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, subscription TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, state TEXT NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0, sent_at INTEGER, last_error TEXT, created_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS pairing_attempts (id TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meta (id TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS passkeys(id TEXT PRIMARY KEY, owner TEXT NOT NULL, public_key TEXT NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL, version TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, version TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auth_challenges(id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, challenge TEXT NOT NULL, version TEXT NOT NULL, expires INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS chat_messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,owner TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL,pinned INTEGER NOT NULL DEFAULT 0,notified INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS chat_messages_expiry ON chat_messages(pinned,created_at);
CREATE TABLE IF NOT EXISTS chat_photos(message_id TEXT PRIMARY KEY,data TEXT NOT NULL,bytes INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chat_reads(owner TEXT PRIMARY KEY,seq INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS chat_presence(id TEXT PRIMARY KEY,owner TEXT NOT NULL,active_until INTEGER NOT NULL,typing_until INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS chat_presence_owner ON chat_presence(owner,active_until);
CREATE INDEX IF NOT EXISTS chat_messages_owner_time ON chat_messages(owner,created_at);

CREATE TABLE IF NOT EXISTS chat_hearts(message_id TEXT NOT NULL,owner TEXT NOT NULL,PRIMARY KEY(message_id,owner));

CREATE INDEX IF NOT EXISTS chat_messages_notify ON chat_messages(notified,created_at);

-- Per-person inbox. Read state is never keyed only by a shared event/tag.
CREATE TABLE IF NOT EXISTS notification_inbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL CHECK(owner IN ('rabbit','sweet')),
  tag TEXT NOT NULL,
  screen TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  UNIQUE(owner,tag)
);
CREATE INDEX IF NOT EXISTS notification_inbox_owner ON notification_inbox(owner,read_at,seq);
CREATE INDEX IF NOT EXISTS notification_inbox_expiry ON notification_inbox(created_at);
CREATE TABLE IF NOT EXISTS notification_versions (owner TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER IF NOT EXISTS notification_insert AFTER INSERT ON notification_inbox BEGIN
  INSERT INTO notification_versions(owner,version) VALUES(NEW.owner,1) ON CONFLICT(owner) DO UPDATE SET version=version+1;
END;
CREATE TRIGGER IF NOT EXISTS notification_read AFTER UPDATE OF read_at ON notification_inbox BEGIN
  UPDATE notification_versions SET version=version+1 WHERE owner=NEW.owner;
END;
CREATE TRIGGER IF NOT EXISTS notification_delete AFTER DELETE ON notification_inbox BEGIN
  UPDATE notification_versions SET version=version+1 WHERE owner=OLD.owner;
END;
