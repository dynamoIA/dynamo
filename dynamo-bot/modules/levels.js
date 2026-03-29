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

    if (!levelRoles.length) {
      console.log(`[LEVELS] There are no level roles configured in ${guildId}`);
      return;
    }

    // Encontrar el rol del nivel anterior
    const oldLevelRole = levelRoles.find(lr => lr.level === oldLevel);
    if (oldLevelRole && member.roles.cache.has(oldLevelRole.role_id)) {
      await member.roles.remove(oldLevelRole.role_id).catch(err => {
        console.warn(`[LEVELS] Could not remove role ${oldLevelRole.role_id}:`, err.message);
      });
    }

    // Encontrar y asignar el rol del nuevo nivel
    const newLevelRole = levelRoles.find(lr => lr.level === newLevel);
    if (newLevelRole && !member.roles.cache.has(newLevelRole.role_id)) {
      await member.roles.add(newLevelRole.role_id).catch(err => {
        console.warn(`[LEVELS] Could not assign role ${newLevelRole.role_id}:`, err.message);
      });
    }
  } catch (err) {
    console.error('[LEVELS] Error in updateLevelRole:', err);
  }
}

/**
 * Envía un mensaje profesional de subida de nivel
 * SOLO si el canal de niveles está configurado
 */
async function sendLevelUpMessage(guild, member, oldLevel, newLevel, totalXp, levelsChannelId) {
  try {
    // Si no hay canal configurado, no enviar mensaje
    if (!levelsChannelId) {
      console.log(`[LEVELS] Levels channel not configured in ${guild.id}`);
      return;
    }

    // Obtener el canal
    const levelChannel = guild.channels.cache.get(levelsChannelId);
    if (!levelChannel || !levelChannel.isTextBased()) {
      console.warn(`[LEVELS] Levels Channel ${levelsChannelId} does not exist or is not text`);
      return;
    }

    const nextLevelXp = getXpForNextLevel(newLevel);
    const xpProgress = totalXp - (newLevel * 100);
    const xpNeeded = nextLevelXp - (newLevel * 100);

    const message = `
**Congratulations ${member.user.username}!**

You have reached the **Level ${newLevel}** (from Level ${oldLevel})

**Progress:**
Current XP: ${xpProgress} / ${xpNeeded}
Total XP: ${totalXp}

Keep writing to reach the next level!
    `.trim();

    await levelChannel.send(message).catch(err => {
      console.warn('[LEVELS] Level message could not be sent:', err.message);
    });
  } catch (err) {
    console.error('[LEVELS] Error in sendLevelUpMessage:', err);
  }
}

export async function handleLevelup(message, config) {
  try {
    // Validaciones básicas
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
    const xpGain = 100;

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
      ).catch(err => console.error('[LEVELS] Error creating user:', err));
      return;
    }

    // Calcular XP actual
    const oldTotalXp = user.total_xp || 0;
    const newTotalXp = oldTotalXp + xpGain;
    const oldLevel = getLevelFromXp(oldTotalXp);
    const newLevel = getLevelFromXp(newTotalXp);

    // Actualizar XP en BD (siempre, sin importar si hay cambio de nivel)
    await db.none(
      'UPDATE users SET xp = $1, total_xp = $2 WHERE user_id = $3 AND guild_id = $4',
      [newTotalXp % 100, newTotalXp, userId, guildId]
    ).catch(err => console.error('[LEVELS] Error updating XP:', err));

    // Si hay cambio de nivel
    if (newLevel > oldLevel) {
      console.log(`[LEVELS] ${message.author.username} leveled up ${oldLevel} a ${newLevel} en ${message.guild.name}`);

      // Actualizar roles (siempre, aunque no haya canal configurado)
      await updateLevelRole(message.member, guildId, oldLevel, newLevel);

      // Enviar mensaje SOLO si el canal está configurado
      await sendLevelUpMessage(
        message.guild,
        message.member,
        oldLevel,
        newLevel,
        newTotalXp,
        config?.levels_channel_id
      );
    }
  } catch (error) {
    console.error('[LEVELS] Error in handleLevelup:', error);
  }
}

export async function handleModeration(message, config) {
  try {
    if (!message.content.startsWith('!warn')) return;

    const target = message.mentions.members.first();
    if (!target) return;

    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      message.reply('You do not have permission to warn users.').catch(() => {});
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
      await target.ban({ reason: 'Too many warnings' }).catch(() => {});
      message.reply(`${target} has been banned for excessive warnings.`).catch(() => {});
    }
  } catch (error) {
    console.error('[LEVELS] Moderation error:', error);
  }
}
