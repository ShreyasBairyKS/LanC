const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT DEFAULT 'user',
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS devices (
      id SERIAL PRIMARY KEY,
      ip INET NOT NULL,
      mac TEXT,
      hostname TEXT,
      alias TEXT,
      os_info TEXT,
      last_seen TIMESTAMPTZ,
      rtt INTEGER,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip);

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      from_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      text TEXT NOT NULL,
      attachments JSONB,
      delivered BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_messages_to_created ON messages(to_user_id, created_at);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      meta JSONB,
      ts TIMESTAMPTZ DEFAULT now()
    );
  `);
}

module.exports = { pool, init };
