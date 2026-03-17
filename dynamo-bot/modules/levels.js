import { PermissionsBitField } from 'discord.js';
import { getDB } from '../database/db.js';
import { getConfig } from '../config/config-manager.js'; // asegúrate que la ruta sea exacta

// 🔒 Anti-spam
const cooldowns = new Map();

async function updateLevelRole(member, guildId, totalXp) {
    try {
        const db = getDB();

        const levelRoles = await db.all(
            'SELECT * FROM level_roles WHERE guild_id = ? ORDER BY xp_required ASC',
            [guildId]
        ).catch(err => {
            console.error('Error al obtener levelRoles:', err);
            return [];
        });

        if (!levelRoles.length) return;

        let newRoleId = null;

        for (const lr of levelRoles) {
            if (totalXp >= lr.xp_required) newRoleId = lr.role_id;
        }

        // 🔥 Limpieza de roles anteriores
        const userRoles = levelRoles.filter(lr =>
            member.roles.cache.has(lr.role_id)
        );

        for (const r of userRoles) {
            if (r.role_id !== newRoleId) {
                await member.roles.remove(r.role_id).catch(err =>
                    console.error(`Error removiendo rol ${r.role_id}:`, err)
                );
            }
        }

        if (newRoleId && !member.roles.cache.has(newRoleId)) {
            await member.roles.add(newRoleId).catch(err =>
                console.error(`Error agregando rol ${newRoleId}:`, err)
            );
        }

    } catch (err) {
        console.error('Error en updateLevelRole:', err);
    }
}

export async function handleLevelup(message) {
    try {
        if (!message || !message.guild || !message.member || message.author.bot) return;

        // 🔥 Obtener config real desde DB
        let config;
        try {
            config = await getConfig(message.guild.id);
        } catch (err) {
            console.error('Error cargando config:', err);
            return;
        }

        // ⏱️ Anti-spam
        const now = Date.now();
        const lastXp = cooldowns.get(message.author.id) || 0;
        if (now - lastXp < 15000) return;
        cooldowns.set(message.author.id, now);

        const db = getDB();
        const xpGain = 10;
        const guildId = message.guild.id;

        let user = await db.get(
            'SELECT * FROM users WHERE user_id = ? AND guild_id = ?',
            [message.author.id, guildId]
        ).catch(() => null);

        if (!user) {
            await db.run(
                'INSERT OR IGNORE INTO users (user_id, guild_id, username, level, xp, total_xp) VALUES (?, ?, ?, 1, ?, ?)',
                [message.author.id, guildId, message.author.username, xpGain, xpGain]
            ).catch(err => console.error('Error insertando user inicial:', err));
            return;
        }

        const newXp      = (user.xp || 0) + xpGain;
        const newTotalXp = (user.total_xp || 0) + xpGain;
        const nextLvlXp  = ((user.level || 1) + 1) * 100;

        if (newXp >= nextLvlXp) {
            const newLevel = (user.level || 1) + 1;

            await db.run(
                'UPDATE users SET level = ?, xp = 0, total_xp = ? WHERE user_id = ? AND guild_id = ?',
                [newLevel, newTotalXp, message.author.id, guildId]
            ).catch(err => console.error('Error actualizando level:', err));

            // 📢 Canal seguro desde config
            let levCh = message.channel;
            if (config?.levels_channel_id) {
                const ch = message.guild.channels.cache.get(config.levels_channel_id);
                if (ch && ch.isTextBased()) levCh = ch;
            }

            if (levCh && levCh.permissionsFor(message.guild.members.me)?.has(PermissionsBitField.Flags.SendMessages)) {
                await levCh.send(`🎉 **${message.author.username}** alcanzó el **Nivel ${newLevel}**.`)
                    .catch(err => console.error('Error enviando mensaje levelup:', err));
            }

        } else {
            await db.run(
                'UPDATE users SET xp = ?, total_xp = ? WHERE user_id = ? AND guild_id = ?',
                [newXp, newTotalXp, message.author.id, guildId]
            ).catch(err => console.error('Error actualizando XP:', err));
        }

        await updateLevelRole(message.member, guildId, newTotalXp).catch(err =>
            console.error('Error actualizando role en levelup:', err)
        );

    } catch (error) {
        console.error('Error en handleLevelup:', error);
    }
}

export async function handleModeration(message) {
    try {
        if (!message.content.startsWith('!warn')) return;

        const target = message.mentions.members.first();
        if (!target) return;

        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            message.reply('No tienes permisos para advertir usuarios.').catch(console.error);
            return;
        }

        const db = getDB();
        const guildId = message.guild.id;

        let user = await db.get(
            'SELECT * FROM users WHERE user_id = ? AND guild_id = ?',
            [target.id, guildId]
        ).catch(() => null);

        const warnings = (user?.warnings || 0) + 1;

        if (!user) {
            await db.run(
                'INSERT INTO users (user_id, guild_id, username, warnings) VALUES (?, ?, ?, ?)',
                [target.id, guildId, target.user.username, warnings]
            ).catch(err => console.error('Error insertando user en warn:', err));
        } else {
            await db.run(
                'UPDATE users SET warnings = ? WHERE user_id = ? AND guild_id = ?',
                [warnings, target.id, guildId]
            ).catch(err => console.error('Error actualizando warnings:', err));
        }

        message.reply(`${target} ha recibido una advertencia (${warnings}/3).`).catch(console.error);

        if (warnings >= 3) {
            await target.ban({ reason: 'Exceso de advertencias' }).catch(console.error);
            message.reply(`${target} ha sido baneado por exceso de advertencias.`).catch(console.error);
        }

    } catch (error) {
        console.error('Error en handleModeration:', error);
    }
}