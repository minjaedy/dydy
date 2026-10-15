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
