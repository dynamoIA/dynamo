import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

let db;

export async function initDB() {
    db = await open({
        filename: './dynamo.db',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    TEXT NOT NULL,
            guild_id   TEXT NOT NULL,
            username   TEXT,
            level      INTEGER DEFAULT 1,
            xp         INTEGER DEFAULT 0,
            total_xp   INTEGER DEFAULT 0,
            warnings   INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, guild_id)
        );

        CREATE TABLE IF NOT EXISTS tickets (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    TEXT NOT NULL,
            guild_id   TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            reason     TEXT,
            status     TEXT DEFAULT 'open',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            closed_at  DATETIME
        );

        CREATE TABLE IF NOT EXISTS guild_configs (
            guild_id               TEXT PRIMARY KEY,
            welcome_channel_id     TEXT,
            exit_channel_id        TEXT,
            autorole_id            TEXT,
            ticket_category_id     TEXT,
            ticket_channel_id      TEXT,
            ticket_staff_roles     TEXT,
            mod_role_id            TEXT,
            logs_channel_id        TEXT,
            levels_channel_id      TEXT,
            music_channel_id       TEXT,
            ia_enabled             INTEGER DEFAULT 1,
            updated_at             DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS level_roles (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id        TEXT NOT NULL,
            role_id         TEXT NOT NULL,
            xp_required     INTEGER NOT NULL,
            UNIQUE(guild_id, role_id)
        );
    `);

    const migrations = [
        'ALTER TABLE guild_configs ADD COLUMN logs_channel_id TEXT',
        'ALTER TABLE guild_configs ADD COLUMN levels_channel_id TEXT',
        'ALTER TABLE guild_configs ADD COLUMN music_channel_id TEXT',
        'ALTER TABLE guild_configs ADD COLUMN ia_enabled INTEGER DEFAULT 1',
        'ALTER TABLE users ADD COLUMN total_xp INTEGER DEFAULT 0',
    ];
    for (const sql of migrations) {
        try { await db.run(sql); } catch { /* columna ya existe */ }
    }

    console.log('[OK] Base de datos inicializada');
    return db;
}

export function getDB() {
    if (!db) throw new Error('DB no inicializada. Llama initDB() primero.');
    return db;
}
