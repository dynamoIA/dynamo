import { getDB } from '../database/db.js';

// Cache en memoria: guildId → config
const cache = new Map();

/**
 * Carga inicial de configuraciones
 */
export async function loadAllGuildConfigs(guilds) {
    try {
        const promises = Array.from(guilds.values()).map(guild => initGuildConfig(guild.id));
        await Promise.allSettled(promises);
        console.log(`[OK] Configuraciones cargadas para ${guilds.size} servidor(es)`);
    } catch (err) {
        console.error('Error en loadAllGuildConfigs:', err);
    }
}

/**
 * Inicializa la configuración de un servidor
 */
export async function initGuildConfig(guildId) {
    try {
        if (cache.has(guildId)) return cache.get(guildId);

        const db = getDB();

        // Asegura que exista en PostgreSQL
        await db.none(
            'INSERT INTO guild_configs (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING',
            [guildId]
        );

        const row = await db.oneOrNone(
            'SELECT * FROM guild_configs WHERE guild_id = $1',
            [guildId]
        );

        const config = row || { guild_id: guildId };
        cache.set(guildId, config);
        return config;

    } catch (err) {
        console.error(`Error en initGuildConfig para ${guildId}:`, err);
    }
}

/**
 * Obtiene la configuración (con auto-recuperación)
 */
export async function getConfig(guildId) {
    try {
        // ⚡ Retorno rápido desde cache
        if (cache.has(guildId)) {
            return cache.get(guildId);
        }

        // Si no está, lo inicializamos (DB -> Cache)
        return await initGuildConfig(guildId);

    } catch (err) {
        console.error(`Error en getConfig para ${guildId}:`, err);
        return { guild_id: guildId };
    }
}

/**
 * Actualiza un campo y refresca la cache
 */
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

        await db.none(
            `UPDATE guild_configs 
             SET ${field} = $1, updated_at = CURRENT_TIMESTAMP 
             WHERE guild_id = $2`,
            [value, guildId]
        );

        // Refrescar cache con los datos actualizados
        const row = await db.oneOrNone(
            'SELECT * FROM guild_configs WHERE guild_id = $1',
            [guildId]
        );

        if (row) cache.set(guildId, row);

    } catch (err) {
        console.error(`Error en setConfig para ${guildId}:`, err);
    }
}

/**
 * Limpia la cache de un servidor específico
 */
export function invalidateCache(guildId) {
    cache.delete(guildId);
}
