import { EmbedBuilder, AuditLogEvent, PermissionsBitField, ChannelType } from 'discord.js';
import { getConfig } from './config-manager.js';

// ─── Utilidades ────────────────────────────────────────────────────

/**
 * Obtiene el canal de logs de forma asíncrona.
 * Consulta la DB y luego busca el canal en la caché o mediante la API.
 */
async function getLogChannel(guild) {
  try {
    const cfg = await getConfig(guild.id);
    if (!cfg || !cfg.logs_channel_id) return null;

    // Intentamos obtenerlo de la caché del servidor
    let channel = guild.channels.cache.get(cfg.logs_channel_id);
    
    // Si no está en caché, lo forzamos con fetch
    if (!channel) {
      channel = await guild.channels.fetch(cfg.logs_channel_id).catch(() => null);
    }

    // Verificamos que sea un canal de texto
    if (channel && channel.isTextBased()) {
      return channel;
    }
    
    return null;
  } catch (error) {
    console.error(`[LOGS ERROR] Error obtaining channel in ${guild.name}:`, error.message);
    return null;
  }
}

/**
 * Envía el embed al canal configurado.
 */
async function send(guild, embed) {
  try {
    const ch = await getLogChannel(guild);
    if (ch) {
      await ch.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error(`[LOG SEND ERROR] Failure to send in ${guild.name}:`, err.message);
  }
}

/**
 * Crea la base estética de los embeds de logs.
 */
function base(title, guild) {
  return new EmbedBuilder()
    .setColor('#3498db')
    .setTitle(`${title}`)
    .setFooter({ 
      text: `Logs • ${guild.name}`, 
      iconURL: guild.iconURL({ extension: 'png' }) ?? undefined 
    })
    .setTimestamp();
}

/**
 * Busca al responsable del evento en el Audit Log.
 */
async function getAuditUser(guild, action, targetId = null) {
  try {
    const entry = await guild.fetchAuditLogs({ type: action, limit: 1 });
    const log = entry.entries.first();
    if (!log) return null;
    
    if (targetId && log.target?.id !== targetId) return null;
    if (Date.now() - log.createdTimestamp > 5000) return null;
    
    return log.executor;
  } catch {
    return null;
  }
}

function permDiff(oldPerms, newPerms) {
  const allPerms = Object.keys(PermissionsBitField.Flags);
  const added = [];
  const removed = [];
  for (const perm of allPerms) {
    const had = oldPerms.has(perm);
    const has = newPerms.has(perm);
    if (!had && has) added.push(perm);
    if (had && !has) removed.push(perm);
  }
  return { added, removed };
}

function formatPerms(list) {
  if (!list.length) return '-';
  return list.map(p => `\`${p}\``).join(', ');
}

function channelTypeName(type) {
  const names = {
    [ChannelType.GuildText]: 'Text',
    [ChannelType.GuildVoice]: 'Voice',
    [ChannelType.GuildCategory]: 'Category',
    [ChannelType.GuildAnnouncement]: 'Advertisements',
    [ChannelType.GuildForum]: 'Forum',
    [ChannelType.GuildStageVoice]: 'Scenery',
    [ChannelType.GuildThread]: 'Thread',
  };
  return names[type] ?? 'A stranger';
}

// ─── Eventos de Canales ───────────────────────────────────────────

export async function onChannelCreate(channel) {
  if (!channel.guild) return;
  const executor = await getAuditUser(channel.guild, AuditLogEvent.ChannelCreate, channel.id);

  const embed = base('Canal Creado', channel.guild)
    .addFields(
      { name: 'Channel', value: `<#${channel.id}> (\`${channel.name}\`)`, inline: true },
      { name: 'Guy', value: channelTypeName(channel.type), inline: true },
      { name: 'Created by', value: executor ? `<@${executor.id}>` : 'A stranger', inline: true }
    );

  if (channel.parent) embed.addFields({ name: 'Category', value: channel.parent.name, inline: true });
  await send(channel.guild, embed);
}

export async function onChannelDelete(channel) {
  if (!channel.guild) return;
  const executor = await getAuditUser(channel.guild, AuditLogEvent.ChannelDelete, channel.id);

  const embed = base('Canal Eliminado', channel.guild)
    .addFields(
      { name: 'Channel', value: `\`#${channel.name}\``, inline: true },
      { name: 'Guy', value: channelTypeName(channel.type), inline: true },
      { name: 'removed by', value: executor ? `<@${executor.id}>` : 'A stranger', inline: true }
    );

  await send(channel.guild, embed);
}

export async function onChannelUpdate(oldCh, newCh) {
  if (!newCh.guild) return;
  const changes = [];

  if (oldCh.name !== newCh.name)
    changes.push({ name: 'Name', value: `\`${oldCh.name}\` -> \`${newCh.name}\``, inline: false });

  if (oldCh.topic !== newCh.topic)
    changes.push({ name: 'Description', value: `\`${oldCh.topic || '-'}\` -> \`${newCh.topic || '-'}\``, inline: false });

  if (oldCh.rateLimitPerUser !== newCh.rateLimitPerUser)
    changes.push({ name: 'Slowmode', value: `${oldCh.rateLimitPerUser}s -> ${newCh.rateLimitPerUser}s`, inline: true });

  if (oldCh.nsfw !== newCh.nsfw)
    changes.push({ name: 'NSFW', value: `${oldCh.nsfw ? 'Yes' : 'No'} -> ${newCh.nsfw ? 'Yes' : 'No'}`, inline: true });

  if (!changes.length) return;

  const executor = await getAuditUser(newCh.guild, AuditLogEvent.ChannelUpdate, newCh.id);
  const embed = base('Modified Channel', newCh.guild)
    .setDescription(`**Channel:** <#${newCh.id}> (\`${newCh.name}\`)`)
    .addFields(...changes);

  if (executor) embed.addFields({ name: 'Modified by', value: `<@${executor.id}>`, inline: true });
  await send(newCh.guild, embed);
}

// ─── Eventos de Roles ─────────────────────────────────────────────

export async function onRoleCreate(role) {
  const executor = await getAuditUser(role.guild, AuditLogEvent.RoleCreate, role.id);
  const embed = base('Rol Creado', role.guild)
    .addFields(
      { name: 'Rol', value: `<@&${role.id}> (\`${role.name}\`)`, inline: true },
      { name: 'Color', value: role.hexColor || 'Por defecto', inline: true },
      { name: 'Created by', value: executor ? `<@${executor.id}>` : 'A stranger', inline: true }
    );
  await send(role.guild, embed);
}

export async function onRoleDelete(role) {
  const executor = await getAuditUser(role.guild, AuditLogEvent.RoleDelete, role.id);
  const embed = base('Rol Eliminado', role.guild)
    .addFields(
      { name: 'Rol', value: `\`${role.name}\``, inline: true },
      { name: 'removed by', value: executor ? `<@${executor.id}>` : 'A stranger', inline: true }
    );
  await send(role.guild, embed);
}

export async function onRoleUpdate(oldRole, newRole) {
  const changes = [];

  if (oldRole.name !== newRole.name)
    changes.push({ name: 'Name', value: `\`${oldRole.name}\` -> \`${newRole.name}\``, inline: true });

  if (oldRole.hexColor !== newRole.hexColor)
    changes.push({ name: 'Color', value: `\`${oldRole.hexColor}\` -> \`${newRole.hexColor}\``, inline: true });

  const { added, removed } = permDiff(oldRole.permissions, newRole.permissions);
  if (added.length) changes.push({ name: 'Permissions Added', value: formatPerms(added), inline: false });
  if (removed.length) changes.push({ name: 'Permissions Removed', value: formatPerms(removed), inline: false });

  if (!changes.length) return;

  const executor = await getAuditUser(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
  const embed = base('Rol Modificado', newRole.guild)
    .setDescription(`**Rol:** <@&${newRole.id}> (\`${newRole.name}\`)`)
    .addFields(...changes);

  if (executor) embed.addFields({ name: 'Modified by', value: `<@${executor.id}>`, inline: true });
  await send(newRole.guild, embed);
}

// ─── Eventos de Mensajes ───────────────────────────────────────────

export async function onMessageDelete(message) {
  if (!message.guild || message.partial || message.author?.bot) return;

  const executor = await getAuditUser(message.guild, AuditLogEvent.MessageDelete, message.id);
  const content = message.content ? `\`\`\`\n${message.content.slice(0, 1000)}\n\`\`\`` : '(sin texto o solo adjuntos)';

  const embed = base('Mensaje Eliminado', message.guild)
    .addFields(
      { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
      { name: 'Author', value: message.author ? `<@${message.author.id}>` : 'Desconocido', inline: true },
      { name: 'Content', value: content, inline: false }
    );

  if (executor) embed.addFields({ name: 'Eliminado por', value: `<@${executor.id}>`, inline: true });
  await send(message.guild, embed);
}

// ─── Otros Eventos ───────────────────────────────────────────────

export async function onGuildBanAdd(ban) {
  const executor = await getAuditUser(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
  const embed = base('Miembro Baneado', ban.guild)
    .addFields(
      { name: 'User', value: `<@${ban.user.id}> (\`${ban.user.username}\`)`, inline: true },
      { name: 'Banned by', value: executor ? `<@${executor.id}>` : 'Desconocido', inline: true },
      { name: 'Reason', value: ban.reason || 'Unspecified', inline: false }
    );
  await send(ban.guild, embed);
}

export async function onNewBot(member) {
  const executor = await getAuditUser(member.guild, AuditLogEvent.BotAdd, member.id);
  const embed = base('Nuevo Bot Añadido', member.guild)
    .addFields(
      { name: 'Bot', value: `<@${member.id}> (\`${member.user.username}\`)`, inline: true },
      { name: 'Added by', value: executor ? `<@${executor.id}>` : 'A stranger', inline: true }
    );
  await send(member.guild, embed);
}

// ─── Eventos del Servidor y Miembros ─────────────────────────────

export async function onGuildUpdate(oldGuild, newGuild) {
  const changes = [];

  if (oldGuild.name !== newGuild.name) {
    changes.push({ name: 'Name', value: `\`${oldGuild.name}\` -> \`${newGuild.name}\``, inline: false });
  }

  if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
    changes.push({ name: 'Verification Level', value: `Modified`, inline: true });
  }

  if (!changes.length) return;

  const executor = await getAuditUser(newGuild, AuditLogEvent.GuildUpdate);
  const embed = base('Updated Server', newGuild)
    .addFields(...changes);

  if (executor) {
    embed.addFields({ name: 'Modified by', value: `<@${executor.id}>`, inline: true });
  }

  await send(newGuild, embed);
}

export async function onGuildMemberUpdate(oldMember, newMember) {
  if (!newMember.guild) return;
  const changes = [];
  let auditType = AuditLogEvent.MemberUpdate;

  // Cambio de apodo
  if (oldMember.nickname !== newMember.nickname) {
    const oldNick = oldMember.nickname || oldMember.user.username;
    const newNick = newMember.nickname || newMember.user.username;
    changes.push({ name: 'Nickname', value: `\`${oldNick}\` -> \`${newNick}\``, inline: false });
  }

  // Cambio de roles
  if (oldMember.roles.cache.size !== newMember.roles.cache.size) {
    auditType = AuditLogEvent.MemberRoleUpdate;
    
    const oldRoles = oldMember.roles.cache.filter(r => r.id !== newMember.guild.id);
    const newRoles = newMember.roles.cache.filter(r => r.id !== newMember.guild.id);

    const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
    const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));

    if (addedRoles.size > 0) {
      changes.push({ name: 'Added Roles', value: addedRoles.map(r => `<@&${r.id}>`).join(', '), inline: false });
    }
    if (removedRoles.size > 0) {
      changes.push({ name: 'Added Roles', value: removedRoles.map(r => `<@&${r.id}>`).join(', '), inline: false });
    }
  }

  // Aislamiento (Timeout)
  if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
    if (newMember.isCommunicationDisabled()) {
      const time = `<t:${Math.floor(newMember.communicationDisabledUntilTimestamp / 1000)}:R>`;
      changes.push({ name: 'Isolation (Timeout)', value: `Isolated up ${time}`, inline: false });
    } else {
      changes.push({ name: 'Isolation (Timeout)', value: `Insulation removed`, inline: false });
    }
  }

  if (!changes.length) return;

  const executor = await getAuditUser(newMember.guild, auditType, newMember.id);

  const embed = base('Updated Member', newMember.guild)
    .setDescription(`**User:** <@${newMember.id}> (\`${newMember.user.username}\`)`)
    .setThumbnail(newMember.user.displayAvatarURL())
    .addFields(...changes);

  if (executor && executor.id !== newMember.id) {
    embed.addFields({ name: 'Modified by', value: `<@${executor.id}>`, inline: true });
  }

  await send(newMember.guild, embed);
}
