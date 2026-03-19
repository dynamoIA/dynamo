import { EmbedBuilder, AuditLogEvent, PermissionsBitField, ChannelType } from 'discord.js';
import { getConfig } from './config-manager.js';

// ─── Utilidades ────────────────────────────────────────────────────

/**
 * Obtiene el canal de logs de forma asíncrona buscando en caché o API.
 */
async function getLogChannel(guild) {
    const cfg = await getConfig(guild.id); // Esperamos a la DB/Cache
    if (!cfg || !cfg.logs_channel_id) return null;
    
    try {
        // Intentamos caché, si no, forzamos búsqueda en la API de Discord
        return guild.channels.cache.get(cfg.logs_channel_id) 
               || await guild.channels.fetch(cfg.logs_channel_id);
    } catch {
        return null;
    }
}

/**
 * Envía el embed al canal configurado.
 */
async function send(guild, embed) {
    try {
        const ch = await getLogChannel(guild);
        if (ch && ch.isTextBased()) {
            await ch.send({ embeds: [embed] });
        }
    } catch (err) {
        console.error(`[LOG ERROR] Error en ${guild.name}:`, err.message);
    }
}

function base(title, guild) {
    return new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle(`🛑 ${title}`)
        .setFooter({ text: `Logs • ${guild.name}`, iconURL: guild.iconURL({ extension: 'png' }) ?? undefined })
        .setTimestamp();
}

async function getAuditUser(guild, action, targetId = null) {
    try {
        const entry = await guild.fetchAuditLogs({ type: action, limit: 1 });
        const log   = entry.entries.first();
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
    const added    = [];
    const removed  = [];
    for (const perm of allPerms) {
        const had = oldPerms.has(perm);
        const has = newPerms.has(perm);
        if (!had && has)  added.push(perm);
        if (had  && !has) removed.push(perm);
    }
    return { added, removed };
}

function formatPerms(list) {
    if (!list.length) return '-';
    return list.map(p => `\`${p}\``).join(', ');
}

function channelTypeName(type) {
    const names = {
        [ChannelType.GuildText]:         'Texto',
        [ChannelType.GuildVoice]:        'Voz',
        [ChannelType.GuildCategory]:     'Categoria',
        [ChannelType.GuildAnnouncement]: 'Anuncio',
        [ChannelType.GuildForum]:        'Foro',
        [ChannelType.GuildStageVoice]:   'Escenario',
        [ChannelType.GuildThread]:       'Hilo',
    };
    return names[type] ?? 'Desconocido';
}

// ─── Eventos de Canales ───────────────────────────────────────────

export async function onChannelCreate(channel) {
    if (!channel.guild) return;
    const executor = await getAuditUser(channel.guild, AuditLogEvent.ChannelCreate, channel.id);

    const embed = base('Canal Creado', channel.guild)
        .addFields(
            { name: 'Canal',      value: `<#${channel.id}> (\`${channel.name}\`)`,      inline: true },
            { name: 'Tipo',       value: channelTypeName(channel.type),                  inline: true },
            { name: 'Creado por', value: executor ? `<@${executor.id}>` : 'Desconocido', inline: true }
        );

    if (channel.parent) embed.addFields({ name: 'Categoria', value: channel.parent.name, inline: true });
    await send(channel.guild, embed);
}

export async function onChannelDelete(channel) {
    if (!channel.guild) return;
    const executor = await getAuditUser(channel.guild, AuditLogEvent.ChannelDelete, channel.id);

    const embed = base('Canal Eliminado', channel.guild)
        .addFields(
            { name: 'Canal',         value: `\`#${channel.name}\``,                           inline: true },
            { name: 'Tipo',          value: channelTypeName(channel.type),                     inline: true },
            { name: 'Eliminado por', value: executor ? `<@${executor.id}>` : 'Desconocido',   inline: true }
        );

    await send(channel.guild, embed);
}

export async function onChannelUpdate(oldCh, newCh) {
    if (!newCh.guild) return;
    const changes = [];

    if (oldCh.name !== newCh.name)
        changes.push({ name: 'Nombre', value: `\`${oldCh.name}\` -> \`${newCh.name}\``, inline: false });

    if (oldCh.topic !== newCh.topic)
        changes.push({ name: 'Descripcion', value: `${oldCh.topic || '-'} -> ${newCh.topic || '-'}`, inline: false });

    if (oldCh.rateLimitPerUser !== newCh.rateLimitPerUser)
        changes.push({ name: 'Slowmode', value: `${oldCh.rateLimitPerUser}s -> ${newCh.rateLimitPerUser}s`, inline: true });

    if (oldCh.nsfw !== newCh.nsfw)
        changes.push({ name: 'NSFW', value: `${oldCh.nsfw} -> ${newCh.nsfw}`, inline: true });

    if (!changes.length) return;

    const executor = await getAuditUser(newCh.guild, AuditLogEvent.ChannelUpdate, newCh.id);
    const embed    = base('Canal Modificado', newCh.guild)
        .setDescription(`**Canal:** <#${newCh.id}> (\`${newCh.name}\`)`)
        .addFields(...changes);

    if (executor) embed.addFields({ name: 'Modificado por', value: `<@${executor.id}>`, inline: true });
    await send(newCh.guild, embed);
}

// ─── Eventos de Roles ─────────────────────────────────────────────

export async function onRoleCreate(role) {
    const executor = await getAuditUser(role.guild, AuditLogEvent.RoleCreate, role.id);
    const embed = base('Rol Creado', role.guild)
        .addFields(
            { name: 'Rol',        value: `<@&${role.id}> (\`${role.name}\`)`,             inline: true },
            { name: 'Color',      value: role.hexColor || 'Por defecto',                   inline: true },
            { name: 'Creado por', value: executor ? `<@${executor.id}>` : 'Desconocido',  inline: true }
        );
    await send(role.guild, embed);
}

export async function onRoleDelete(role) {
    const executor = await getAuditUser(role.guild, AuditLogEvent.RoleDelete, role.id);
    const embed = base('Rol Eliminado', role.guild)
        .addFields(
            { name: 'Rol',           value: `\`${role.name}\``,                               inline: true },
            { name: 'Eliminado por', value: executor ? `<@${executor.id}>` : 'Desconocido',   inline: true }
        );
    await send(role.guild, embed);
}

export async function onRoleUpdate(oldRole, newRole) {
    const changes = [];

    if (oldRole.name !== newRole.name)
        changes.push({ name: 'Nombre', value: `\`${oldRole.name}\` -> \`${newRole.name}\``, inline: true });

    if (oldRole.hexColor !== newRole.hexColor)
        changes.push({ name: 'Color', value: `\`${oldRole.hexColor}\` -> \`${newRole.hexColor}\``, inline: true });

    const { added, removed } = permDiff(oldRole.permissions, newRole.permissions);
    if (added.length)   changes.push({ name: 'Permisos Añadidos',  value: formatPerms(added),   inline: false });
    if (removed.length) changes.push({ name: 'Permisos Removidos', value: formatPerms(removed), inline: false });

    if (!changes.length) return;

    const executor = await getAuditUser(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    const embed    = base('Rol Modificado', newRole.guild)
        .setDescription(`**Rol:** <@&${newRole.id}> (\`${newRole.name}\`)`)
        .addFields(...changes);

    if (executor) embed.addFields({ name: 'Modificado por', value: `<@${executor.id}>`, inline: true });
    await send(newRole.guild, embed);
}

// ─── Eventos de Mensajes ───────────────────────────────────────────

export async function onMessageDelete(message) {
    if (!message.guild || message.partial || message.author?.bot) return;

    const executor = await getAuditUser(message.guild, AuditLogEvent.MessageDelete, message.author?.id);
    const content  = message.content ? `\`\`\`\n${message.content.slice(0, 1000)}\n\`\`\`` : '(sin texto / solo adjuntos)';

    const embed = base('Mensaje Eliminado', message.guild)
        .addFields(
            { name: 'Canal',    value: `<#${message.channelId}>`,                             inline: true },
            { name: 'Autor',    value: message.author ? `<@${message.author.id}>` : 'Desconocido', inline: true },
            { name: 'Contenido', value: content,                                               inline: false }
        );

    if (executor) embed.addFields({ name: 'Eliminado por', value: `<@${executor.id}>`, inline: true });
    await send(message.guild, embed);
}

// ─── Otros Eventos ───────────────────────────────────────────────

export async function onGuildBanAdd(ban) {
    const executor = await getAuditUser(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    const embed = base('Miembro Baneado', ban.guild)
        .addFields(
            { name: 'Usuario',     value: `<@${ban.user.id}> (\`${ban.user.username}\`)`,    inline: true },
            { name: 'Baneado por', value: executor ? `<@${executor.id}>` : 'Desconocido',    inline: true },
            { name: 'Razon',       value: ban.reason || 'Sin especificar',                    inline: false }
        );
    await send(ban.guild, embed);
}

export async function onNewBot(member) {
    const executor = await getAuditUser(member.guild, AuditLogEvent.BotAdd, member.id);
    const embed = base('Nuevo Bot Añadido', member.guild)
        .addFields(
            { name: 'Bot',        value: `<@${member.id}> (\`${member.user.username}\`)`,   inline: true },
            { name: 'Añadido por', value: executor ? `<@${executor.id}>` : 'Desconocido',   inline: true }
        );
    await send(member.guild, embed);
}
