import { EmbedBuilder, AuditLogEvent, PermissionsBitField, ChannelType } from 'discord.js';
import { getConfig } from './config-manager.js';

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

// ─── Exportaciones de canales y roles ───────────────────────────────
export async function onChannelCreate(channel) { /* ...igual que tu código... */ }
export async function onChannelDelete(channel) { /* ...igual que tu código... */ }
export async function onChannelUpdate(oldCh, newCh) { /* ...igual que tu código... */ }

export async function onRoleCreate(role) { /* ...igual que tu código... */ }
export async function onRoleDelete(role) { /* ...igual que tu código... */ }

export async function onMessageDelete(message) { /* ...igual que tu código... */ }

// ─── Eventos que faltaban ─────────────────────────────────────────
export async function onGuildBanAdd(ban) {
    if (!ban.guild) return;

    const executor = await getAuditUser(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    const embed = base('#ED4245', 'Usuario Baneado', ban.guild)
        .addFields(
            { name: 'Usuario', value: `<@${ban.user.id}>`, inline: true },
            { name: 'Baneado por', value: executor ? `<@${executor.id}>` : 'Desconocido', inline: true }
        );

    await send(ban.guild, embed);
}

export async function onNewBot(member) {
    if (!member.guild || !member.user.bot) return;

    const embed = base('#57F287', 'Nuevo Bot Unido', member.guild)
        .addFields(
            { name: 'Bot', value: `<@${member.user.id}> (\`${member.user.tag}\`)`, inline: true }
        );

    await send(member.guild, embed);
}

export async function onMessageDeleteLog(message) {
    // Esta función se puede renombrar si quieres manejar duplicados o logs especiales
    await onMessageDelete(message);
}