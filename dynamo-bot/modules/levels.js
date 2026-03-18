import { PermissionsBitField } from 'discord.js';
import { getDB } from '../database/db.js';

/**
 * Actualiza roles de nivel según XP
 */
async function updateLevelRole(member, guildId, totalXp) {
    if (!member) return;
    const db = getDB();

    let levelRoles = [];
    try {
        levelRoles = await db.any(
            'SELECT * FROM level_roles WHERE guild_id = $1 ORDER BY xp_required ASC',
            [guildId]
        );
    } catch (err) {
        console.error('Error obteniendo roles de nivel:', err);
        return;
    }

    if (!levelRoles.length) return;

    let newRoleId = null;
    for (const lr of levelRoles) {
        if (totalXp >= lr.xp_required) newRoleId = lr.role_id;
    }

    const currentLevelRole = levelRoles.find(lr => member.roles.cache.has(lr.role_id));
    if (currentLevelRole?.role_id === newRoleId) return;

    try {
        if (currentLevelRole) await member.roles.remove(currentLevelRole.role_id).catch(() => {});
        if (newRoleId) await member.roles.add(newRoleId).catch(() => {});
    } catch (err) {
        console.error('Error actualizando roles de nivel:', err);
    }
}

/**
 * Maneja subida de nivel
 */
export async function handleLevelup(message, config) {
    if (!message.guild || !message.member) return;

    const db = getDB();
    const xpGain = Math.floor(Math.random() * 10) + 5;
    const guildId = message.guild.id;

    let user;
    try {
        user = await db.oneOrNone(
            'SELECT * FROM users WHERE user_id = $1 AND guild_id = $2',
            [message.author.id, guildId]
        );
    } catch (err) {
        console.error('Error consultando usuario:', err);
        return;
    }

    // Si no existe, se inserta con protección contra conflictos
    if (!user) {
        try {
            await db.none(
                `INSERT INTO users (user_id, guild_id, username, level, xp, total_xp, warnings) 
                 VALUES ($1, $2, $3, 1, $4, $4, 0)
                 ON CONFLICT (user_id) DO NOTHING`,
                [message.author.id, guildId, message.author.username, xpGain]
            );
        } catch (err) {
            console.error('Error creando usuario nuevo:', err);
        }
        return;
    }

    const newXp = user.xp + xpGain;
    const newTotalXp = (user.total_xp || 0) + xpGain;
    const nextLvlXp = (user.level + 1) * 100;

    try {
        if (newXp >= nextLvlXp) {
            const newLevel = user.level + 1;
            await db.none(
                'UPDATE users SET level = $1, xp = 0, total_xp = $2 WHERE user_id = $3 AND guild_id = $4',
                [newLevel, newTotalXp, message.author.id, guildId]
            );

            const levCh = config.levels_channel_id
                ? (message.guild.channels.cache.get(config.levels_channel_id) ?? message.channel)
                : message.channel;

            levCh.send(`**${message.author.username}** alcanzó el **Nivel ${newLevel}**.`).catch(() => {});
        } else {
            await db.none(
                'UPDATE users SET xp = $1, total_xp = $2 WHERE user_id = $3 AND guild_id = $4',
                [newXp, newTotalXp, message.author.id, guildId]
            );
        }
    } catch (err) {
        console.error('Error actualizando XP/Level:', err);
    }

    // Actualiza roles de nivel
    updateLevelRole(message.member, guildId, newTotalXp).catch(() => {});
}

/**
 * Maneja sistema de advertencias
 */
export async function handleModeration(message, config) {
    if (!message.guild || !message.member) return;
    if (!message.content.startsWith('!warn')) return;

    const target = message.mentions.members.first();
    if (!target) return;

    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        message.reply('No tienes permisos para advertir usuarios.').catch(() => {});
        return;
    }

    const db = getDB();
    const guildId = message.guild.id;

    try {
        let user = await db.oneOrNone(
            'SELECT * FROM users WHERE user_id = $1 AND guild_id = $2',
            [target.id, guildId]
        );

        const warnings = (user?.warnings || 0) + 1;

        if (!user) {
            await db.none(
                `INSERT INTO users (user_id, guild_id, username, level, xp, total_xp, warnings)
                 VALUES ($1, $2, $3, 1, 0, 0, $4)
                 ON CONFLICT (user_id) DO NOTHING`,
                [target.id, guildId, target.user.username, warnings]
            ).catch(err => console.error(err));
        } else {
            await db.none(
                'UPDATE users SET warnings = $1 WHERE user_id = $2 AND guild_id = $3',
                [warnings, target.id, guildId]
            ).catch(err => console.error(err));
        }

        message.reply(`${target} ha recibido una advertencia (${warnings}/3).`).catch(() => {});

        if (warnings >= 3) {
            await target.ban({ reason: 'Exceso de advertencias' }).catch(() => {});
            message.reply(`${target} ha sido baneado por exceso de advertencias.`).catch(() => {});
        }
    } catch (error) {
        console.error('Error en moderación:', error);
    }
}