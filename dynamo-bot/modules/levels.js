import { PermissionsBitField } from 'discord.js';
import { getDB } from '../database/db.js';

async function updateLevelRole(member, guildId, totalXp) {
    const db         = getDB();
    const levelRoles = await db.all(
        'SELECT * FROM level_roles WHERE guild_id = ? ORDER BY xp_required ASC',
        [guildId]
    );
    if (!levelRoles.length) return;

    let newRoleId = null;
    for (const lr of levelRoles) {
        if (totalXp >= lr.xp_required) newRoleId = lr.role_id;
    }

    const currentLevelRole = levelRoles.find(lr => member.roles.cache.has(lr.role_id));
    if (currentLevelRole?.role_id === newRoleId) return;

    if (currentLevelRole) await member.roles.remove(currentLevelRole.role_id).catch(() => {});
    if (newRoleId)        await member.roles.add(newRoleId).catch(() => {});
}

export async function handleLevelup(message, config) {
    const db      = getDB();
    const xpGain  = Math.floor(Math.random() * 10) + 5;
    const guildId = message.guild.id;

    let user = await db.get(
        'SELECT * FROM users WHERE user_id = ? AND guild_id = ?',
        [message.author.id, guildId]
    );

    if (!user) {
        await db.run(
            'INSERT OR IGNORE INTO users (user_id, guild_id, username, level, xp, total_xp) VALUES (?, ?, ?, 1, ?, ?)',
            [message.author.id, guildId, message.author.username, xpGain, xpGain]
        ).catch(() => {});
        return;
    }

    const newXp      = user.xp + xpGain;
    const newTotalXp = (user.total_xp || 0) + xpGain;
    const nextLvlXp  = (user.level + 1) * 100;

    if (newXp >= nextLvlXp) {
        const newLevel = user.level + 1;

        await db.run(
            'UPDATE users SET level = ?, xp = 0, total_xp = ? WHERE user_id = ? AND guild_id = ?',
            [newLevel, newTotalXp, message.author.id, guildId]
        ).catch(() => {});

        const levCh = config.levels_channel_id
            ? (message.guild.channels.cache.get(config.levels_channel_id) ?? message.channel)
            : message.channel;

        levCh.send(`**${message.author.username}** alcanzo el **Nivel ${newLevel}**.`).catch(() => {});

    } else {
        await db.run(
            'UPDATE users SET xp = ?, total_xp = ? WHERE user_id = ? AND guild_id = ?',
            [newXp, newTotalXp, message.author.id, guildId]
        ).catch(() => {});
    }

    updateLevelRole(message.member, guildId, newTotalXp).catch(() => {});
}

export async function handleModeration(message, config) {
    if (!message.content.startsWith('!warn')) return;

    const target = message.mentions.members.first();
    if (!target) return;

    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        message.reply('No tienes permisos para advertir usuarios.').catch(() => {});
        return;
    }

    const db      = getDB();
    const guildId = message.guild.id;

    try {
        let user = await db.get(
            'SELECT * FROM users WHERE user_id = ? AND guild_id = ?',
            [target.id, guildId]
        );
        const warnings = (user?.warnings || 0) + 1;

        if (!user) {
            await db.run(
                'INSERT INTO users (user_id, guild_id, username, warnings) VALUES (?, ?, ?, ?)',
                [target.id, guildId, target.user.username, warnings]
            );
        } else {
            await db.run(
                'UPDATE users SET warnings = ? WHERE user_id = ? AND guild_id = ?',
                [warnings, target.id, guildId]
            );
        }

        message.reply(`${target} ha recibido una advertencia (${warnings}/3).`).catch(() => {});

        if (warnings >= 3) {
            await target.ban({ reason: 'Exceso de advertencias' });
            message.reply(`${target} ha sido baneado por exceso de advertencias.`).catch(() => {});
        }
    } catch (error) {
        console.error('Error en moderacion:', error);
    }
}
