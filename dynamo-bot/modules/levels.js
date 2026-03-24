import { PermissionsBitField } from 'discord.js';
import { getDB } from '../database/db.js';

// 🔒 Anti-spam
const cooldowns = new Map();

async function updateLevelRole(member, guildId, totalXp) {
  try {
    const db = getDB();

    const levelRoles = await db.any(
      'SELECT * FROM level_roles WHERE guild_id = $1 ORDER BY xp_required ASC',
      [guildId]
    ).catch(() => []);

    if (!levelRoles.length) return;

    let newRoleId = null;

    for (const lr of levelRoles) {
      if (totalXp >= lr.xp_required) {
        newRoleId = lr.role_id;
      }
    }

    // 🔥 Limpieza correcta de roles
    const userRoles = levelRoles.filter(lr =>
      member.roles.cache.has(lr.role_id)
    );

    for (const r of userRoles) {
      if (r.role_id !== newRoleId) {
        await member.roles.remove(r.role_id).catch(() => {});
      }
    }

    if (newRoleId && !member.roles.cache.has(newRoleId)) {
      await member.roles.add(newRoleId).catch(() => {});
    }

  } catch (err) {
    console.error('Error en updateLevelRole:', err);
  }
}

export async function handleLevelup(message, config) {
  try {
    if (!message || !message.guild || !message.member || message.author.bot) return;

    // Anti-spam: 1 mensaje por usuario cada 5 segundos
    const now = Date.now();
    const lastMsg = cooldowns.get(message.author.id) || 0;

    if (now - lastMsg < 5000) return;
    cooldowns.set(message.author.id, now);

    const db = getDB();

    // Mensajes = 1 XP por mensaje
    const xpGain = 1;

    const guildId = message.guild.id;

    let user = await db.oneOrNone(
      'SELECT * FROM users WHERE user_id = $1 AND guild_id = $2',
      [message.author.id, guildId]
    ).catch(() => null);

    if (!user) {
      await db.none(
        'INSERT INTO users (user_id, guild_id, username, level, xp, total_xp) VALUES ($1, $2, $3, 1, $4, $5)',
        [message.author.id, guildId, message.author.username, xpGain, xpGain]
      ).catch(() => {});
      return;
    }

    const newXp = (user.xp || 0) + xpGain;
    const newTotalXp = (user.total_xp || 0) + xpGain;
    const nextLvlXp = ((user.level || 1) + 1) * 100;

    if (newXp >= nextLvlXp) {
      const newLevel = (user.level || 1) + 1;

      await db.none(
        'UPDATE users SET level = $1, xp = 0, total_xp = $2 WHERE user_id = $3 AND guild_id = $4',
        [newLevel, newTotalXp, message.author.id, guildId]
      ).catch(() => {});

      // Asignar rol de nivel automáticamente
      await updateLevelRole(message.member, guildId, newTotalXp).catch(() => {});

      // Canal seguro para el mensaje
      let levCh = message.channel;

      if (config?.levels_channel_id) {
        const ch = message.guild.channels.cache.get(config.levels_channel_id);
        if (ch && ch.isTextBased()) levCh = ch;
      }

      // Mensaje profesional sin emojis
      await levCh.send(
        `Felicidades ${message.author.username}, has subido de Nivel ${user.level || 1} a Nivel ${newLevel}. Total de XP: ${newTotalXp}.`
      ).catch(() => {});

    } else {
      await db.none(
        'UPDATE users SET xp = $1, total_xp = $2 WHERE user_id = $3 AND guild_id = $4',
        [newXp, newTotalXp, message.author.id, guildId]
      ).catch(() => {});
    }

  } catch (error) {
    console.error('Error en handleLevelup:', error);
  }
}

export async function handleModeration(message, config) {
  try {
    if (!message.content.startsWith('!warn')) return;

    const target = message.mentions.members.first();
    if (!target) return;

    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      message.reply('No tienes permisos para advertir usuarios.').catch(() => {});
      return;
    }

    const db = getDB();
    const guildId = message.guild.id;

    let user = await db.oneOrNone(
      'SELECT * FROM users WHERE user_id = $1 AND guild_id = $2',
      [target.id, guildId]
    ).catch(() => null);

    const warnings = (user?.warnings || 0) + 1;

    if (!user) {
      await db.none(
        'INSERT INTO users (user_id, guild_id, username, warnings) VALUES ($1, $2, $3, $4)',
        [target.id, guildId, target.user.username, warnings]
      ).catch(() => {});
    } else {
      await db.none(
        'UPDATE users SET warnings = $1 WHERE user_id = $2 AND guild_id = $3',
        [warnings, target.id, guildId]
      ).catch(() => {});
    }

    message.reply(`${target} ha recibido una advertencia (${warnings}/3).`).catch(() => {});

    if (warnings >= 3) {
      await target.ban({ reason: 'Exceso de advertencias' }).catch(() => {});
      message.reply(`${target} ha sido baneado por exceso de advertencias.`).catch(() => {});
    }

  } catch (error) {
    console.error('Error en moderacion:', error);
  }
}
