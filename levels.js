import { PermissionsBitField } from 'discord.js';
import { getDB } from '../database/db.js';

export async function handleLevelup(message, config) {
    const db = getDB();
    const xpGain = Math.floor(Math.random() * 10) + 5;

    let user = await db.get('SELECT * FROM users WHERE user_id = ?', [message.author.id]);
    if (!user) {
        await db.run('INSERT INTO users (user_id, username, level, xp) VALUES (?, ?, 1, ?)', 
            [message.author.id, message.author.username, xpGain]);
        return;
    }

    const newXp = user.xp + xpGain;
    const nextLevelXp = (user.level + 1) * 100;

    if (newXp >= nextLevelXp) {
        const newLevel = user.level + 1;
        const oldRoleId = config[`LEVEL_ID_${user.level}`];
        const newRoleId = config[`LEVEL_ID_${newLevel}`];

        try {
            if (oldRoleId && oldRoleId.trim() !== '') {
                await message.member.roles.remove(oldRoleId).catch(() => {});
            }
            if (newRoleId && newRoleId.trim() !== '') {
                await message.member.roles.add(newRoleId).catch(() => {});
            }

            await db.run('UPDATE users SET level = ?, xp = 0 WHERE user_id = ?', [newLevel, message.author.id]);
            await message.channel.send(`🎉 **${message.author.username}** alcanzó el **Rango ${newLevel}**.`).catch(() => {});
        } catch (error) {
            console.error('Error en levelup:', error);
        }
    } else {
        await db.run('UPDATE users SET xp = ? WHERE user_id = ?', [newXp, message.author.id]);
    }
}

export async function handleModeration(message, config) {
    const db = getDB();

    if (message.content.startsWith('!warn')) {
        const target = message.mentions.members.first();
        if (!target) return;

        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            await message.reply('No tienes permisos para advertir usuarios');
            return;
        }

        try {
            let user = await db.get('SELECT * FROM users WHERE user_id = ?', [target.id]);
            const warnings = (user?.warnings || 0) + 1;

            if (!user) {
                await db.run('INSERT INTO users (user_id, username, warnings) VALUES (?, ?, ?)', 
                    [target.id, target.user.username, warnings]);
            } else {
                await db.run('UPDATE users SET warnings = ? WHERE user_id = ?', [warnings, target.id]);
            }

            await message.reply(`⚠️ ${target} ha recibido una advertencia (${warnings}/3)`);

            if (warnings >= 3) {
                await target.ban({ reason: 'Exceso de advertencias' });
                await message.reply(`🔨 ${target} ha sido baneado por exceso de advertencias`);
            }
        } catch (error) {
            console.error('Error en moderación:', error);
        }
    }
}
