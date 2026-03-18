import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';

// Usa una ruta persistente en el volumen
const DB_DIR = process.env.DB_PATH || '/app/data';
const DB_PATH = path.join(DB_DIR, 'cipher.sqlite');

// Crea el directorio si no existe
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

let db = null;

export async function initDB() {
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      username TEXT,
      level INTEGER DEFAULT 0,
      xp INTEGER DEFAULT 0,
      warnings INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS guild_config (
      guild_id TEXT PRIMARY KEY,
      welcome_enabled INTEGER DEFAULT 1,
      autorole_id TEXT,
      moderation_level TEXT DEFAULT 'medium',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      guild_id TEXT,
      channel_id TEXT,
      reason TEXT,
      status TEXT DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      closed_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT,
      action TEXT,
      user_id TEXT,
      target_id TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  console.log('✅ Base de datos inicializada en:', DB_PATH);
  return db;
}

export function getDB() {
  return db;
}
