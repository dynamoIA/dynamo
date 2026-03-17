import { getDB } from '../database/db.js';

// Cache en memoria: guildId → config
const cache = new Map();

export async function loadAllGuildConfigs(guilds) {
    const db = getDB();
    const promises = [...guilds.values()].map(guild => initGuildConfig(guild.id));
    await Promise.allSettled(promises);
    console.log(`[OK] Configuraciones cargadas para ${guilds.size} servidor(es)`);
}

export async function initGuildConfig(guildId) {
    if (cache.has(guildId)) return;
    const db = getDB();
    await db.run(
        'INSERT OR IGNORE INTO guild_configs (guild_id) VALUES (?)',
        [guildId]
    );
    const row = await db.get('SELECT * FROM guild_configs WHERE guild_id = ?', [guildId]);
    cache.set(guildId, row || { guild_id: guildId });
}

export function getConfig(guildId) {
    return cache.get(guildId) || {};
}

export async function setConfig(guildId, field, value) {
    const db = getDB();
    const allowed = [
        'welcome_channel_id', 'exit_channel_id', 'autorole_id',
        'ticket_category_id', 'ticket_channel_id', 'ticket_staff_roles',
        'mod_role_id', 'logs_channel_id', 'levels_channel_id',
        'music_channel_id', 'ia_enabled'
    ];
    if (!allowed.includes(field)) throw new Error(`Campo inválido: ${field}`);

    await db.run(
        `UPDATE guild_configs SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`,
        [value, guildId]
    );
    const row = await db.get('SELECT * FROM guild_configs WHERE guild_id = ?', [guildId]);
    cache.set(guildId, row);
}

export function invalidateCache(guildId) {
    cache.delete(guildId);
}
