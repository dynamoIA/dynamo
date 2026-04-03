import { PermissionsBitField, EmbedBuilder } from 'discord.js';
import { getDB } from '../database/db.js';

// Anti-spam: userId → timestamp del último mensaje procesado
const cooldowns = new Map();
const COOLDOWN_MS = 5000;
const COOLDOWN_CLEANUP_INTERVAL = 60_000; // Limpiar cooldowns viejos cada minuto

// Limpiar entradas de cooldown expiradas para evitar memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [userId, ts] of cooldowns.entries()) {
    if (now - ts > COOLDOWN_MS * 2) cooldowns.delete(userId);
  }
}, COOLDOWN_CLEANUP_INTERVAL);

// ─── Helpers de XP/Nivel ─────────────────────────────────────────────

/**
 * Calcula el nivel basado en XP total acumulado.
 * Fórmula: cada 100 XP = 1 nivel (nivel 0 = 0–99 XP, nivel 1 = 100–199 XP, etc.)
 */
function getLevelFromXp(totalXp) {
  return Math.floor(Math.max(0, totalXp) / 100);
}

/**
 * Devuelve el XP total necesario para alcanzar el siguiente nivel.
 */
function getXpForNextLevel(currentLevel) {
  return (currentLevel + 1) * 100;
}

/**
 * Genera una barra de progreso visual con bloques Unicode.
 * @param {number} current - XP actual dentro del nivel
 * @param {number} total   - XP total necesario para el siguiente nivel
 * @param {number} length  - Longitud de la barra (bloques)
 */
function buildProgressBar(current, total, length = 10) {
  const filled = Math.round((current / total) * length);
  const empty = length - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}

// ─── Roles de Nivel ──────────────────────────────────────────────────

/**
 * Asigna todos los roles que el usuario ha desbloqueado según su XP total
 * y remueve los que ya no cumple. Valida existencia del rol y permisos del bot.
 *
 * @param {GuildMember} member
 * @param {string}      guildId
 * @param {number}      totalXp
 * @returns {string[]} Lista de nombres de roles recién asignados
 */
async function updateLevelRoles(member, guildId, totalXp) {
  const assignedRoleNames = [];

  try {
    const db = getDB();
    const levelRoles = await db.any(
      'SELECT * FROM level_roles WHERE guild_id = $1 ORDER BY xp_required ASC',
      [guildId]
    ).catch(() => []);

    if (!levelRoles.length) return assignedRoleNames;

    const guild = member.guild;
    const botMember = guild.members.me;

    for (const lr of levelRoles) {
      // Validar que el rol exista en el servidor
      const role = guild.roles.cache.get(lr.role_id);
      if (!role) {
        console.warn(`[LEVELS] Rol ${lr.role_id} no encontrado en el servidor ${guildId}, omitiendo.`);
        continue;
      }

      // Validar que el bot tenga jerarquía suficiente para gestionar el rol
      if (botMember && role.position >= botMember.roles.highest.position) {
        console.warn(`[LEVELS] El bot no tiene jerarquía para gestionar el rol "${role.name}" (${lr.role_id}).`);
        continue;
      }

      const hasUnlocked = totalXp >= lr.xp_required;
      const hasRole = member.roles.cache.has(lr.role_id);

      if (hasUnlocked && !hasRole) {
        // Asignar rol desbloqueado
        await member.roles.add(role).catch(err => {
          console.error(`[LEVELS] Error al asignar rol "${role.name}" a ${member.user.tag}: ${err.message}`);
        });
        assignedRoleNames.push(role.name);
        console.log(`[LEVELS] ✅ Rol "${role.name}" asignado a ${member.user.tag} (${totalXp} XP ≥ ${lr.xp_required} XP requeridos).`);
      } else if (!hasUnlocked && hasRole) {
        // Remover rol que ya no cumple requisitos
        await member.roles.remove(role).catch(err => {
          console.error(`[LEVELS] Error al remover rol "${role.name}" de ${member.user.tag}: ${err.message}`);
        });
        console.log(`[LEVELS] 🔻 Rol "${role.name}" removido de ${member.user.tag} (${totalXp} XP < ${lr.xp_required} XP requeridos).`);
      }
    }
  } catch (err) {
    console.error('[LEVELS] Error en updateLevelRoles:', err);
  }

  return assignedRoleNames;
}

// ─── Mensaje de Nivel ────────────────────────────────────────────────

/**
 * Envía un embed profesional de subida de nivel al canal configurado.
 *
 * @param {Guild}        guild
 * @param {GuildMember}  member
 * @param {number}       oldLevel
 * @param {number}       newLevel
 * @param {number}       totalXp
 * @param {string|null}  levelsChannelId
 * @param {string[]}     newRoles - Nombres de roles recién asignados
 */
async function sendLevelUpMessage(guild, member, oldLevel, newLevel, totalXp, levelsChannelId, newRoles = []) {
  try {
    if (!levelsChannelId) {
      console.warn('[LEVELS] No hay canal de niveles configurado para este servidor.');
      return;
    }

    const levelChannel = guild.channels.cache.get(levelsChannelId);
    if (!levelChannel) {
      console.warn(`[LEVELS] Canal de niveles ${levelsChannelId} no encontrado en ${guild.name}.`);
      return;
    }
    if (!levelChannel.isTextBased()) {
      console.warn(`[LEVELS] Canal ${levelsChannelId} no es un canal de texto.`);
      return;
    }

    // Calcular progreso dentro del nivel actual
    const xpIntoLevel = totalXp - (newLevel * 100);   // XP acumulado en el nivel actual
    const xpPerLevel  = 100;                           // XP necesario para el siguiente nivel
    const xpRemaining = xpPerLevel - xpIntoLevel;
    const progressBar = buildProgressBar(xpIntoLevel, xpPerLevel);

    const embed = new EmbedBuilder()
      .setColor('#1DB954') // Verde vibrante
      .setAuthor({
        name: member.user.tag,
        iconURL: member.user.displayAvatarURL({ dynamic: true })
      })
      .setTitle('🎉 ¡Nivel Subido!')
      .setDescription(
        `¡Felicidades, **${member.user.username}**! Has alcanzado el **Nivel ${newLevel}** en **${guild.name}**.`
      )
      .addFields(
        {
          name: '📈 Progreso de Nivel',
          value: `Nivel **${oldLevel}** → Nivel **${newLevel}**`,
          inline: true
        },
        {
          name: '✨ XP Total Acumulado',
          value: `**${totalXp.toLocaleString()}** XP`,
          inline: true
        },
        {
          name: '⚡ Barra de Progreso',
          value: `\`${progressBar}\` ${xpIntoLevel}/${xpPerLevel} XP`,
          inline: false
        },
        {
          name: '🎯 Siguiente Objetivo',
          value: `Faltan **${xpRemaining} XP** para alcanzar el Nivel ${newLevel + 1}`,
          inline: false
        }
      )
      .setFooter({ text: guild.name })
      .setTimestamp();

    // Añadir campo de roles si se asignaron nuevos
    if (newRoles.length > 0) {
      embed.addFields({
        name: '🏆 Roles Desbloqueados',
        value: newRoles.map(r => `• **${r}**`).join('\n'),
        inline: false
      });
    }

    await levelChannel.send({
      content: `${member}`,
      embeds: [embed]
    }).catch(err => {
      console.error(`[LEVELS] No se pudo enviar el mensaje de nivel en #${levelChannel.name}: ${err.message}`);
    });

  } catch (err) {
    console.error('[LEVELS] Error en sendLevelUpMessage:', err);
  }
}

// ─── Handlers exportados ─────────────────────────────────────────────

/**
 * Procesa XP por mensaje y gestiona subidas de nivel.
 * Se llama en cada messageCreate del servidor.
 */
export async function handleLevelup(message, config) {
  try {
    if (!message || !message.guild || !message.member || message.author.bot) return;

    // Anti-spam: ignorar si el usuario está en cooldown
    const now = Date.now();
    const lastMsg = cooldowns.get(message.author.id) || 0;
    if (now - lastMsg < COOLDOWN_MS) return;
    cooldowns.set(message.author.id, now);

    const db = getDB();
    const guildId = message.guild.id;
    const userId  = message.author.id;
    const xpGain  = 10; // XP ganado por mensaje (ajustable)

    // Obtener o crear registro del usuario
    let user = await db.oneOrNone(
      'SELECT * FROM users WHERE user_id = $1 AND guild_id = $2',
      [userId, guildId]
    ).catch(() => null);

    if (!user) {
      await db.none(
        'INSERT INTO users (user_id, guild_id, username, level, xp, total_xp) VALUES ($1, $2, $3, 0, 0, 0) ON CONFLICT (user_id, guild_id) DO UPDATE SET username = $3',
        [userId, guildId, message.author.username]
      ).catch(err => console.error('[LEVELS] Error al crear/actualizar registro de usuario:', err));

      user = { total_xp: 0, level: 0 };
    }

    const oldTotalXp = parseInt(user.total_xp) || 0;
    const newTotalXp = oldTotalXp + xpGain;
    const oldLevel   = getLevelFromXp(oldTotalXp);
    const newLevel   = getLevelFromXp(newTotalXp);

    // Persistir nuevo XP y nivel
    await db.none(
      'UPDATE users SET xp = $1, total_xp = $2, level = $3 WHERE user_id = $4 AND guild_id = $5',
      [newTotalXp % 100, newTotalXp, newLevel, userId, guildId]
    ).catch(err => console.error('[LEVELS] Error al actualizar XP:', err));

    // Gestionar subida de nivel
    if (newLevel > oldLevel) {
      console.log(`[LEVELS] 🆙 ${message.author.tag} subió al nivel ${newLevel} (${newTotalXp} XP total) en ${message.guild.name}.`);

      // Asignar/remover roles y obtener los recién desbloqueados
      const newRoles = await updateLevelRoles(message.member, guildId, newTotalXp);

      // Enviar mensaje de nivel
      await sendLevelUpMessage(
        message.guild,
        message.member,
        oldLevel,
        newLevel,
        newTotalXp,
        config?.levels_channel_id,
        newRoles
      );
    }
  } catch (error) {
    console.error('[LEVELS] Error en handleLevelup:', error);
  }
}

/**
 * Sistema de advertencias por prefijo (!warn).
 * Banea automáticamente al alcanzar 3 advertencias.
 */
export async function handleModeration(message, config) {
  try {
    if (!message.content.startsWith('!warn')) return;

    const target = message.mentions.members.first();
    if (!target) return;

    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      message.reply('No tienes permisos para ejecutar esta acción.').catch(() => {});
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

    message.reply(`⚠️ Advertencia registrada para ${target}. Total: **${warnings}/3**.`).catch(() => {});

    if (warnings >= 3) {
      await target.ban({ reason: 'Límite de advertencias alcanzado (3/3).' }).catch(() => {});
      message.reply(`🔨 ${target} ha sido baneado por acumular 3 advertencias.`).catch(() => {});
    }
  } catch (error) {
    console.error('[LEVELS] Error en handleModeration:', error);
  }
}
