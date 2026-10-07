CREATE TABLE IF NOT EXISTS chat_messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,owner TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL,pinned INTEGER NOT NULL DEFAULT 0,notified INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS chat_messages_expiry ON chat_messages(pinned,created_at);
CREATE TABLE IF NOT EXISTS chat_photos(message_id TEXT PRIMARY KEY,data TEXT NOT NULL,bytes INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chat_reads(owner TEXT PRIMARY KEY,seq INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS chat_presence(id TEXT PRIMARY KEY,owner TEXT NOT NULL,active_until INTEGER NOT NULL,typing_until INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS chat_presence_owner ON chat_presence(owner,active_until);
CREATE INDEX IF NOT EXISTS chat_messages_owner_time ON chat_messages(owner,created_at);

CREATE TABLE IF NOT EXISTS chat_hearts(message_id TEXT NOT NULL,owner TEXT NOT NULL,PRIMARY KEY(message_id,owner));
INSERT OR IGNORE INTO meta(id,value) VALUES('chatStartedAt',CAST(unixepoch('now')*1000 AS TEXT));

CREATE INDEX IF NOT EXISTS chat_messages_notify ON chat_messages(notified,created_at);
