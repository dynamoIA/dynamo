import { EmbedBuilder, AuditLogEvent, PermissionsBitField, ChannelType } from 'discord.js';
import { getConfig } from './config-manager.js';

// ─── Utilidades ────────────────────────────────────────────────────

function getLogChannel(guild) {
    const cfg = getConfig(guild.id);
    if (!cfg.logs_channel_id) return null;
    return guild.channels.cache.get(cfg.logs_channel_id) ?? null;
}

function send(guild, embed) {
    const ch = getLogChannel(guild);
    if (ch) ch.send({ embeds: [embed] }).catch(() => {});
}

function base(color, title, guild) {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setFooter({ text: guild.name, iconURL: guild.iconURL({ extension: 'png' }) ?? undefined })
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

// ─── Canales ───────────────────────────────────────────────────────

export async function onChannelCreate(channel) {
    if (!channel.guild) return;
    const executor = await getAuditUser(channel.guild, AuditLogEvent.ChannelCreate, channel.id);

    const embed = base('#57F287', 'Canal Creado', channel.guild)
        .addFields(
            { name: 'Canal',      value: `<#${channel.id}> (\`${channel.name}\`)`,      inline: true },
            { name: 'Tipo',       value: channelTypeName(channel.type),                  inline: true },
            { name: 'Creado por', value: executor ? `<@${executor.id}>` : 'Desconocido', inline: true }
        );

    if (channel.parent) embed.addFields({ name: 'Categoria', value: channel.parent.name, inline: true });
    send(channel.guild, embed);
}

export async function onChannelDelete(channel) {
    if (!channel.guild) return;
    const executor = await getAuditUser(channel.guild, AuditLogEvent.ChannelDelete, channel.id);

    const embed = base('#ED4245', 'Canal Eliminado', channel.guild)
        .addFields(
            { name: 'Canal',         value: `\`#${channel.name}\``,                           inline: true },
            { name: 'Tipo',          value: channelTypeName(channel.type),                     inline: true },
            { name: 'Eliminado por', value: executor ? `<@${executor.id}>` : 'Desconocido',   inline: true }
        );

    send(channel.guild, embed);
}

export async function onChannelUpdate(oldCh, newCh) {
    if (!newCh.guild) return;
    const changes = [];

    if (oldCh.name !== newCh.name)
        changes.push({ name: 'Nombre', value: `\`${oldCh.name}\` -> \`${newCh.name}\``, inline: false });

    if (oldCh.topic !== newCh.topic)
        changes.push({ name: 'Descripcion', value: `${oldCh.topic || '-'} -> ${newCh.topic || '-'}`, inline: false });

    if (oldCh.rateLimitPerUser !== undefined && oldCh.rateLimitPerUser !== newCh.rateLimitPerUser)
        changes.push({ name: 'Slowmode', value: `${oldCh.rateLimitPerUser}s -> ${newCh.rateLimitPerUser}s`, inline: true });

    if (oldCh.nsfw !== undefined && oldCh.nsfw !== newCh.nsfw)
        changes.push({ name: 'NSFW', value: `${oldCh.nsfw} -> ${newCh.nsfw}`, inline: true });

    const oldOW = oldCh.permissionOverwrites?.cache;
    const newOW = newCh.permissionOverwrites?.cache;
    if (oldOW && newOW) {
        const changed = [];
        newOW.forEach((ow, id) => {
            const old = oldOW.get(id);
            if (!old || !old.allow.equals(ow.allow) || !old.deny.equals(ow.deny)) {
                const t = newCh.guild.roles.cache.get(id) ?? newCh.guild.members.cache.get(id);
                changed.push(t ? `\`${t.name ?? t.user?.username}\`` : `\`${id}\``);
            }
        });
        if (changed.length)
            changes.push({ name: 'Permisos modificados para', value: changed.join(', '), inline: false });
    }

    if (!changes.length) return;

    const executor = await getAuditUser(newCh.guild, AuditLogEvent.ChannelUpdate, newCh.id);
    const embed    = base('#FEE75C', 'Canal Modificado', newCh.guild)
        .setDescription(`**Canal:** <#${newCh.id}> (\`${newCh.name}\`)`)
        .addFields(...changes);

    if (executor) embed.addFields({ name: 'Modificado por', value: `<@${executor.id}>`, inline: true });
    send(newCh.guild, embed);
}

// ─── Roles ─────────────────────────────────────────────────────────

export async function onRoleCreate(role) {
    const executor = await getAuditUser(role.guild, AuditLogEvent.RoleCreate, role.id);

    const embed = base('#57F287', 'Rol Creado', role.guild)
        .addFields(
            { name: 'Rol',        value: `<@&${role.id}> (\`${role.name}\`)`,             inline: true },
            { name: 'Color',      value: role.hexColor || 'Por defecto',                   inline: true },
            { name: 'Creado por', value: executor ? `<@${executor.id}>` : 'Desconocido',  inline: true }
        );

    send(role.guild, embed);
}

export async function onRoleDelete(role) {
    const executor = await getAuditUser(role.guild, AuditLogEvent.RoleDelete, role.id);

    const embed = base('#ED4245', 'Rol Eliminado', role.guild)
        .addFields(
            { name: 'Rol',           value: `\`${role.name}\``,                               inline: true },
            { name: 'Color',         value: role.hexColor || 'Por defecto',                    inline: true },
            { name: 'Eliminado por', value: executor ? `<@${executor.id}>` : 'Desconocido',   inline: true }
        );

    send(role.guild, embed);
}

export async function onRoleUpdate(oldRole, newRole) {
    const changes = [];

    if (oldRole.name !== newRole.name)
        changes.push({ name: 'Nombre', value: `\`${oldRole.name}\` -> \`${newRole.name}\``, inline: true });

    if (oldRole.hexColor !== newRole.hexColor)
        changes.push({ name: 'Color', value: `\`${oldRole.hexColor}\` -> \`${newRole.hexColor}\``, inline: true });

    if (oldRole.hoist !== newRole.hoist)
        changes.push({ name: 'Mostrar separado', value: `${oldRole.hoist} -> ${newRole.hoist}`, inline: true });

    if (oldRole.mentionable !== newRole.mentionable)
        changes.push({ name: 'Mencionable', value: `${oldRole.mentionable} -> ${newRole.mentionable}`, inline: true });

    const { added, removed } = permDiff(oldRole.permissions, newRole.permissions);
    if (added.length)   changes.push({ name: 'Permisos Añadidos',  value: formatPerms(added),   inline: false });
    if (removed.length) changes.push({ name: 'Permisos Removidos', value: formatPerms(removed), inline: false });

    if (!changes.length) return;

    const executor = await getAuditUser(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    const embed    = base('#FEE75C', 'Rol Modificado', newRole.guild)
        .setDescription(`**Rol:** <@&${newRole.id}> (\`${newRole.name}\`)`)
        .addFields(...changes);

    if (executor) embed.addFields({ name: 'Modificado por', value: `<@${executor.id}>`, inline: true });
    send(newRole.guild, embed);
}

// ─── Servidor ──────────────────────────────────────────────────────

export async function onGuildUpdate(oldGuild, newGuild) {
    const changes = [];

    if (oldGuild.name !== newGuild.name)
        changes.push({ name: 'Nombre', value: `\`${oldGuild.name}\` -> \`${newGuild.name}\``, inline: false });

    if (oldGuild.icon !== newGuild.icon)
        changes.push({ name: 'Logo', value: 'Se cambio el logo del servidor', inline: false });

    if (oldGuild.description !== newGuild.description)
        changes.push({ name: 'Descripcion', value: `${oldGuild.description || '-'} -> ${newGuild.description || '-'}`, inline: false });

    if (oldGuild.verificationLevel !== newGuild.verificationLevel)
        changes.push({ name: 'Nivel de verificacion', value: `${oldGuild.verificationLevel} -> ${newGuild.verificationLevel}`, inline: true });

    if (oldGuild.explicitContentFilter !== newGuild.explicitContentFilter)
        changes.push({ name: 'Filtro de contenido', value: `${oldGuild.explicitContentFilter} -> ${newGuild.explicitContentFilter}`, inline: true });

    if (!changes.length) return;

    const executor = await getAuditUser(newGuild, AuditLogEvent.GuildUpdate);
    const embed    = base('#FEE75C', 'Servidor Modificado', newGuild)
        .addFields(...changes);

    if (executor) embed.addFields({ name: 'Modificado por', value: `<@${executor.id}>`, inline: true });
    send(newGuild, embed);
}

// ─── Miembros (cambios de rol) ──────────────────────────────────────

export async function onGuildMemberUpdate(oldMember, newMember) {
    const addedRoles   = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));

    if (!addedRoles.size && !removedRoles.size) return;

    const executor = await getAuditUser(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
    const fields   = [];

    if (addedRoles.size)   fields.push({ name: 'Roles Añadidos',  value: addedRoles.map(r => `<@&${r.id}>`).join(', '),   inline: false });
    if (removedRoles.size) fields.push({ name: 'Roles Removidos', value: removedRoles.map(r => `<@&${r.id}>`).join(', '), inline: false });

    const embed = base('#5865F2', 'Roles de Miembro Actualizados', newMember.guild)
        .setDescription(`**Miembro:** <@${newMember.id}> (\`${newMember.user.username}\`)`)
        .addFields(...fields);

    if (executor) embed.addFields({ name: 'Modificado por', value: `<@${executor.id}>`, inline: true });
    send(newMember.guild, embed);
}

// ─── Baneos ────────────────────────────────────────────────────────

export async function onGuildBanAdd(ban) {
    const executor = await getAuditUser(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);

    const embed = base('#ED4245', 'Miembro Baneado', ban.guild)
        .addFields(
            { name: 'Usuario',     value: `<@${ban.user.id}> (\`${ban.user.username}\`)`,    inline: true },
            { name: 'Baneado por', value: executor ? `<@${executor.id}>` : 'Desconocido',    inline: true },
            { name: 'Razon',       value: ban.reason || 'Sin especificar',                    inline: false }
        );

    send(ban.guild, embed);
}

// ─── Nuevos Bots ───────────────────────────────────────────────────

export async function onNewBot(member) {
    const executor = await getAuditUser(member.guild, AuditLogEvent.BotAdd, member.id);

    const embed = base('#5865F2', 'Nuevo Bot Añadido', member.guild)
        .addFields(
            { name: 'Bot',        value: `<@${member.id}> (\`${member.user.username}\`)`,   inline: true },
            { name: 'Añadido por', value: executor ? `<@${executor.id}>` : 'Desconocido',   inline: true }
        );

    send(member.guild, embed);
}

// ─── Mensajes Eliminados ────────────────────────────────────────────

export async function onMessageDelete(message) {
    if (!message.guild) return;
    if (message.partial) return;
    if (message.author?.bot) return;

    const executor = await getAuditUser(message.guild, AuditLogEvent.MessageDelete, message.author?.id);
    const content  = message.content ? message.content.slice(0, 1000) : '(sin texto / solo adjuntos)';

    const embed = base('#ED4245', 'Mensaje Eliminado', message.guild)
        .addFields(
            { name: 'Canal',    value: `<#${message.channelId}>`,                             inline: true },
            { name: 'Autor',    value: message.author ? `<@${message.author.id}>` : 'Desconocido', inline: true },
            { name: 'Contenido', value: content,                                               inline: false }
        );

    if (executor) embed.addFields({ name: 'Eliminado por', value: `<@${executor.id}>`, inline: true });
    send(message.guild, embed);
}
