import { PermissionsBitField } from 'discord.js';
import { getDB } from '../database/db.js';

// 🔒 Anti-spam
const cooldowns = new Map();

/**
 * Calcula el nivel basado en XP total
 * Fórmula: nivel = floor(totalXp / 100)
 */
function getLevelFromXp(totalXp) {
  return Math.floor(totalXp / 100);
}

/**
 * Calcula el XP necesario para alcanzar el siguiente nivel
 */
function getXpForNextLevel(currentLevel) {
  return (currentLevel + 1) * 100;
}

/**
 * Actualiza los roles de nivel del usuario
 * Quita el rol anterior y asigna el nuevo
 */
async function updateLevelRole(member, guildId, oldLevel, newLevel) {
  try {
    const db = getDB();
    
    // Obtener todos los roles de nivel configurados
    const levelRoles = await db.any(
      'SELECT * FROM level_roles WHERE guild_id = $1 ORDER BY level ASC',
      [guildId]
    ).catch(() => []);

    if (!levelRoles.length) return;

    // Encontrar el rol del nivel anterior
    const oldLevelRole = levelRoles.find(lr => lr.level === oldLevel);
    if (oldLevelRole && member.roles.cache.has(oldLevelRole.role_id)) {
      await member.roles.remove(oldLevelRole.role_id).catch(err => {
        console.warn(`[LEVELS] No se pudo quitar rol ${oldLevelRole.role_id}:`, err.message);
      });
    }

    // Encontrar y asignar el rol del nuevo nivel
    const newLevelRole = levelRoles.find(lr => lr.level === newLevel);
    if (newLevelRole && !member.roles.cache.has(newLevelRole.role_id)) {
      await member.roles.add(newLevelRole.role_id).catch(err => {
        console.warn(`[LEVELS] No se pudo asignar rol ${newLevelRole.role_id}:`, err.message);
      });
    }
  } catch (err) {
    console.error('[LEVELS] Error en updateLevelRole:', err);
  }
}

/**
 * Envía un mensaje profesional de subida de nivel
 */
async function sendLevelUpMessage(channel, member, oldLevel, newLevel, totalXp) {
  try {
    const nextLevelXp = getXpForNextLevel(newLevel);
    const xpProgress = totalXp - (newLevel * 100);
    const xpNeeded = nextLevelXp - (newLevel * 100);

    const message = `
**Felicidades ${member.user.username}!**

Has alcanzado el **Nivel ${newLevel}** (desde Nivel ${oldLevel})

**Progreso:**
XP Actual: ${xpProgress} / ${xpNeeded}
XP Total: ${totalXp}

¡Sigue escribiendo para alcanzar el siguiente nivel!
    `.trim();

    await channel.send(message).catch(err => {
      console.warn('[LEVELS] No se pudo enviar mensaje de nivel:', err.message);
    });
  } catch (err) {
    console.error('[LEVELS] Error en sendLevelUpMessage:', err);
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
    const guildId = message.guild.id;
    const userId = message.author.id;

    // 1 XP por mensaje
    const xpGain = 1;

    // Obtener usuario actual
    let user = await db.oneOrNone(
      'SELECT * FROM users WHERE user_id = $1 AND guild_id = $2',
      [userId, guildId]
    ).catch(() => null);

    // Si no existe, crear nuevo usuario
    if (!user) {
      await db.none(
        'INSERT INTO users (user_id, guild_id, username, level, xp, total_xp) VALUES ($1, $2, $3, 0, $4, $5)',
        [userId, guildId, message.author.username, xpGain, xpGain]
      ).catch(err => console.error('[LEVELS] Error creando usuario:', err));
      return;
    }

    // Calcular XP actual
    const oldTotalXp = user.total_xp || 0;
    const newTotalXp = oldTotalXp + xpGain;
    const oldLevel = getLevelFromXp(oldTotalXp);
    const newLevel = getLevelFromXp(newTotalXp);

    // Actualizar XP en BD
    await db.none(
      'UPDATE users SET xp = $1, total_xp = $2 WHERE user_id = $3 AND guild_id = $4',
      [newTotalXp % 100, newTotalXp, userId, guildId]
    ).catch(err => console.error('[LEVELS] Error actualizando XP:', err));

    // Si hay cambio de nivel
    if (newLevel > oldLevel) {
      console.log(`[LEVELS] ${message.author.username} subió de Nivel ${oldLevel} a ${newLevel}`);

      // Actualizar roles
      await updateLevelRole(message.member, guildId, oldLevel, newLevel);

      // Enviar mensaje de subida de nivel
      let levelChannel = message.channel;
      if (config?.levels_channel_id) {
        const ch = message.guild.channels.cache.get(config.levels_channel_id);
        if (ch && ch.isTextBased()) {
          levelChannel = ch;
        }
      }

      await sendLevelUpMessage(levelChannel, message.member, oldLevel, newLevel, newTotalXp);
    }
  } catch (error) {
    console.error('[LEVELS] Error en handleLevelup:', error);
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
    console.error('[LEVELS] Error en moderacion:', error);
  }
}
