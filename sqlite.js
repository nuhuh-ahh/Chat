import Database from "better-sqlite3";

export const db = new Database("./data.db");
export async function initDb() {
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      bio TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')*1000)
    );
    CREATE TABLE IF NOT EXISTS friends (
      user_id INTEGER NOT NULL,
      friend_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      UNIQUE(user_id, friend_id)
    );
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_id INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      UNIQUE(group_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL, -- 'direct' | 'group' | 'channel'
      sender_id INTEGER NOT NULL,
      target_id INTEGER,  -- friend user id or group id
      channel_id INTEGER, -- if channel message
      content TEXT,
      attachments_json TEXT,
      created_at INTEGER
    );
  `);
}

export const sql = (strings, ...values) =>
  strings.reduce((acc, s, i) => acc + s + (values[i] ?? ""), "");
