import { EmbedBuilder, AuditLogEvent, PermissionsBitField, ChannelType } from 'discord.js';
import { getConfig } from './config-manager.js'; // ruta correcta dentro de modules/

// ─── Utilidades ────────────────────────────────────────────────────

async function getLogChannel(guild) {
    const cfg = await getConfig(guild.id);
    if (!cfg.logs_channel_id) return null;
    return guild.channels.cache.get(cfg.logs_channel_id) ?? null;
}

async function send(guild, embed) {
    try {
        const ch = await getLogChannel(guild);
        if (ch) await ch.send({ embeds: [embed] });
    } catch (err) {
        console.error('Error enviando log:', err);
    }
}

function base(color, title, guild) {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setFooter({
            text: guild.name,
            iconURL: guild.iconURL({ extension: 'png' }) ?? undefined
        })
        .setTimestamp();
}

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
        [ChannelType.GuildText]: 'Texto',
        [ChannelType.GuildVoice]: 'Voz',
        [ChannelType.GuildCategory]: 'Categoria',
        [ChannelType.GuildAnnouncement]: 'Anuncio',
        [ChannelType.GuildForum]: 'Foro',
        [ChannelType.GuildStageVoice]: 'Escenario',
        [ChannelType.GuildThread]: 'Hilo',
    };
    return names[type] ?? 'Desconocido';
}

// ─── Canales ───────────────────────────────────────────────────────

export async function onChannelCreate(channel) {
    if (!channel.guild) return;

    const executor = await getAuditUser(channel.guild, AuditLogEvent.ChannelCreate, channel.id);

    const embed = base('#57F287', 'Canal Creado', channel.guild)
        .addFields(
            { name: 'Canal', value: `<#${channel.id}> (\`${channel.name}\`)`, inline: true },
            { name: 'Tipo', value: channelTypeName(channel.type), inline: true },
            { name: 'Creado por', value: executor ? `<@${executor.id}>` : 'Desconocido', inline: true }
        );

    if (channel.parent) {
        embed.addFields({ name: 'Categoria', value: channel.parent.name, inline: true });
    }

    await send(channel.guild, embed);
}

export async function onChannelDelete(channel) {
    if (!channel.guild) return;

    const executor = await getAuditUser(channel.guild, AuditLogEvent.ChannelDelete, channel.id);

    const embed = base('#ED4245', 'Canal Eliminado', channel.guild)
        .addFields(
            { name: 'Canal', value: `\`#${channel.name}\``, inline: true },
            { name: 'Tipo', value: channelTypeName(channel.type), inline: true },
            { name: 'Eliminado por', value: executor ? `<@${executor.id}>` : 'Desconocido', inline: true }
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

    if (oldCh.rateLimitPerUser !== undefined && oldCh.rateLimitPerUser !== newCh.rateLimitPerUser)
        changes.push({ name: 'Slowmode', value: `${oldCh.rateLimitPerUser}s -> ${newCh.rateLimitPerUser}s`, inline: true });

    if (oldCh.nsfw !== undefined && oldCh.nsfw !== newCh.nsfw)
        changes.push({ name: 'NSFW', value: `${oldCh.nsfw} -> ${newCh.nsfw}`, inline: true });

    if (!changes.length) return;

    const executor = await getAuditUser(newCh.guild, AuditLogEvent.ChannelUpdate, newCh.id);

    const embed = base('#FEE75C', 'Canal Modificado', newCh.guild)
        .setDescription(`**Canal:** <#${newCh.id}> (\`${newCh.name}\`)`)
        .addFields(...changes);

    if (executor) {
        embed.addFields({ name: 'Modificado por', value: `<@${executor.id}>`, inline: true });
    }

    await send(newCh.guild, embed);
}

// ─── Roles ─────────────────────────────────────────────────────────

export async function onRoleCreate(role) {
    const executor = await getAuditUser(role.guild, AuditLogEvent.RoleCreate, role.id);

    const embed = base('#57F287', 'Rol Creado', role.guild)
        .addFields(
            { name: 'Rol', value: `<@&${role.id}> (\`${role.name}\`)`, inline: true },
            { name: 'Color', value: role.hexColor || 'Por defecto', inline: true },
            { name: 'Creado por', value: executor ? `<@${executor.id}>` : 'Desconocido', inline: true }
        );

    await send(role.guild, embed);
}

export async function onRoleDelete(role) {
    const executor = await getAuditUser(role.guild, AuditLogEvent.RoleDelete, role.id);

    const embed = base('#ED4245', 'Rol Eliminado', role.guild)
        .addFields(
            { name: 'Rol', value: `\`${role.name}\``, inline: true },
            { name: 'Color', value: role.hexColor || 'Por defecto', inline: true },
            { name: 'Eliminado por', value: executor ? `<@${executor.id}>` : 'Desconocido', inline: true }
        );

    await send(role.guild, embed);
}

// ─── Mensajes ─────────────────────────────────────────────────────

export async function onMessageDelete(message) {
    if (!message.guild) return;
    if (message.partial) return;
    if (message.author?.bot) return;

    const executor = await getAuditUser(message.guild, AuditLogEvent.MessageDelete, message.author?.id);
    const content = message.content ? message.content.slice(0, 1000) : '(sin texto / solo adjuntos)';

    const embed = base('#ED4245', 'Mensaje Eliminado', message.guild)
        .addFields(
            { name: 'Canal', value: `<#${message.channelId}>`, inline: true },
            { name: 'Autor', value: message.author ? `<@${message.author.id}>` : 'Desconocido', inline: true },
            { name: 'Contenido', value: content, inline: false }
        );

    if (executor) {
        embed.addFields({ name: 'Eliminado por', value: `<@${executor.id}>`, inline: true });
    }

    await send(message.guild, embed);
}