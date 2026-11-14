import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import path from "path";
import fs from "fs";
import * as schema from "./schema.ts";

let dbInstance: any;

if (process.env.DATABASE_URL) {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  });
  dbInstance = drizzlePg(pool, { schema });
} else {
  const dataDir = path.join(process.cwd(), ".data", "pglite");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const client = new PGlite(dataDir);
  
  await client.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'Developer',
      passcode_pin TEXT DEFAULT '1234',
      saas_plan TEXT DEFAULT 'free',
      transcribe_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS transcription_history (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      timestamp TEXT,
      file_name TEXT,
      file_size TEXT,
      duration TEXT,
      raw_text TEXT,
      parsed JSONB,
      instruction TEXT,
      mode TEXT
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      token TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT DEFAULT 'Developer',
      joined_at TEXT
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id SERIAL PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_settings (
      id INTEGER PRIMARY KEY,
      smtp_host TEXT,
      smtp_port TEXT,
      smtp_user TEXT,
      smtp_pass TEXT,
      smtp_from TEXT,
      gemini_api_key TEXT
    );
  `);

  dbInstance = drizzlePglite(client, { schema });
}

export const db = dbInstance;
