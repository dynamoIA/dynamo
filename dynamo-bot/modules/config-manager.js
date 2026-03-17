import { getDB } from '../database/db.js';

// Cache en memoria: guildId → config
const cache = new Map();

export async function loadAllGuildConfigs(guilds) {
    const promises = [...guilds.values()].map(guild => initGuildConfig(guild.id));
    await Promise.allSettled(promises);
    console.log(`[OK] Configuraciones cargadas para ${guilds.size} servidor(es)`);
}

export async function initGuildConfig(guildId) {
    try {
        if (cache.has(guildId)) return;

        const db = getDB();

        // 🔹 Asegura que exista en DB
        await db.run(
            'INSERT OR IGNORE INTO guild_configs (guild_id) VALUES (?)',
            [guildId]
        );

        const row = await db.get(
            'SELECT * FROM guild_configs WHERE guild_id = ?',
            [guildId]
        );

        const config = row || { guild_id: guildId };

        cache.set(guildId, config);

    } catch (err) {
        console.error('Error en initGuildConfig:', err);
    }
}

// 🔥 AHORA ES ASYNC Y SE AUTORECUPERA
export async function getConfig(guildId) {
    try {
        // ⚡ Si está en cache, lo devuelve rápido
        if (cache.has(guildId)) {
            return cache.get(guildId);
        }

        const db = getDB();

        // 🔹 Asegura existencia en DB (clave para Railway)
        await db.run(
            'INSERT OR IGNORE INTO guild_configs (guild_id) VALUES (?)',
            [guildId]
        );

        // 🔹 Obtiene desde DB
        const row = await db.get(
            'SELECT * FROM guild_configs WHERE guild_id = ?',
            [guildId]
        );

        const config = row || { guild_id: guildId };

        // 🔥 Guarda en cache para próximas llamadas
        cache.set(guildId, config);

        return config;

    } catch (err) {
        console.error('Error en getConfig:', err);
        return { guild_id: guildId };
    }
}

export async function setConfig(guildId, field, value) {
    try {
        const db = getDB();

        const allowed = [
            'welcome_channel_id', 'exit_channel_id', 'autorole_id',
            'ticket_category_id', 'ticket_channel_id', 'ticket_staff_roles',
            'mod_role_id', 'logs_channel_id', 'levels_channel_id',
            'music_channel_id', 'ia_enabled'
        ];

        if (!allowed.includes(field)) {
            throw new Error(`Campo inválido: ${field}`);
        }

        await db.run(
            `UPDATE guild_configs 
             SET ${field} = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE guild_id = ?`,
            [value, guildId]
        );

        // 🔹 Refresca cache
        const row = await db.get(
            'SELECT * FROM guild_configs WHERE guild_id = ?',
            [guildId]
        );

        cache.set(guildId, row);

    } catch (err) {
        console.error('Error en setConfig:', err);
    }
}

export function invalidateCache(guildId) {
    cache.delete(guildId);
}