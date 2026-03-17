import { ChannelType, PermissionsBitField, EmbedBuilder } from 'discord.js';
import { getDB } from '../database/db.js';
import { getConfig } from './config-manager.js';

// Guard de creacion por usuario+guild para evitar doble-click
const creating = new Set();

export async function handleTicketCreation(message) {
    if (!message.guild || message.author.bot) return false;

    const config = getConfig(message.guild.id);
    const ticketCategoryId = config.ticket_category_id?.trim() || '';
    const ticketChannelId  = config.ticket_channel_id?.trim()  || '';

    // Comando !close: verificar por ID en la BD, no por nombre
    if (message.content.toLowerCase() === '!close') {
        const db = getDB();
        const isTicket = await db.get(
            'SELECT id FROM tickets WHERE channel_id = ? AND status = ?',
            [message.channel.id, 'open']
        );
        if (isTicket) {
            closeTicket(message, config);
            return true;
        }
    }

    if (!ticketChannelId || message.channel.id !== ticketChannelId) return false;
    if (!ticketCategoryId) return false;

    const guardKey = `${message.guild.id}:${message.author.id}`;
    if (creating.has(guardKey)) {
        message.delete().catch(() => {});
        return true;
    }
    creating.add(guardKey);

    const db = getDB();

    try {
        const existing = await db.get(
            'SELECT * FROM tickets WHERE user_id = ? AND guild_id = ? AND status = ?',
            [message.author.id, message.guild.id, 'open']
        );

        if (existing) {
            const existingChannel = message.guild.channels.cache.get(existing.channel_id);
            if (existingChannel) {
                message.reply({
                    content: `Ya tienes un ticket abierto en <#${existing.channel_id}>. Escribe \`!close\` ahi para cerrarlo primero.`
                }).then(warn => setTimeout(() => warn.delete().catch(() => {}), 7000)).catch(() => {});
                message.delete().catch(() => {});
                return true;
            }
            db.run(
                'UPDATE tickets SET status = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?',
                ['closed', existing.id]
            ).catch(() => {});
        }

        const safeUsername = message.author.username
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 20) || 'usuario';

        const staffRoleIds = (config.ticket_staff_roles || '')
            .split(',').map(r => r.trim()).filter(Boolean);

        const permissionOverwrites = [
            { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            {
                id: message.author.id,
                allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.AttachFiles,
                    PermissionsBitField.Flags.EmbedLinks,
                    PermissionsBitField.Flags.ReadMessageHistory
                ]
            }
        ];

        for (const roleId of staffRoleIds) {
            if (message.guild.roles.cache.has(roleId)) {
                permissionOverwrites.push({
                    id: roleId,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.AttachFiles,
                        PermissionsBitField.Flags.EmbedLinks,
                        PermissionsBitField.Flags.ReadMessageHistory,
                        PermissionsBitField.Flags.ManageChannels
                    ]
                });
            }
        }

        const ticketChannel = await message.guild.channels.create({
            name: `ticket-${safeUsername}`,
            type: ChannelType.GuildText,
            parent: ticketCategoryId,
            permissionOverwrites
        });

        const now     = new Date();
        const dateStr = now.toLocaleDateString('es-ES');
        const timeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const reasonStr = message.content || 'Sin especificar';

        const embed = new EmbedBuilder()
            .setColor('#FF8C00')
            .setTitle('Ticket Abierto')
            .setThumbnail(message.author.displayAvatarURL({ size: 64, extension: 'png' }))
            .setDescription(
                `Hola <@${message.author.id}>, el equipo de soporte atendara tu solicitud en breve.\n\n` +
                `**Motivo:** ${reasonStr}\n` +
                `**Fecha:** ${dateStr} — **Hora:** ${timeStr}`
            )
            .setFooter({ text: 'Escribe !close para cerrar este ticket.' })
            .setTimestamp();

        await Promise.all([
            ticketChannel.send({ content: `<@${message.author.id}>`, embeds: [embed] }),
            message.delete().catch(() => {})
        ]);

        db.run(
            'INSERT INTO tickets (user_id, guild_id, channel_id, reason, status) VALUES (?, ?, ?, ?, ?)',
            [message.author.id, message.guild.id, ticketChannel.id, reasonStr, 'open']
        ).catch(err => console.error('Error guardando ticket en DB:', err.message));

        console.log(`[${message.guild.name}] Ticket creado para ${message.author.username} -> #${ticketChannel.name}`);
        return true;

    } catch (error) {
        console.error(`[${message.guild.name}] Error creando ticket:`, error.code, error.message);
        let errorMsg = 'Ocurrio un error al crear tu ticket. Contacta a un administrador.';
        if (error.code === 50013) errorMsg = 'El bot no tiene el permiso **Gestionar Canales**.';
        if (error.code === 50001) errorMsg = 'El bot no tiene acceso a la categoria de tickets.';
        message.channel.send(errorMsg)
            .then(m => setTimeout(() => m.delete().catch(() => {}), 5000))
            .catch(() => {});
        return false;
    } finally {
        creating.delete(guardKey);
    }
}

async function closeTicket(message, config) {
    if (!message.guild) return;
    const db = getDB();

    const staffRoles = (config.ticket_staff_roles || '')
        .split(',').map(r => r.trim()).filter(Boolean);

    const isStaff =
        message.member.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
        staffRoles.some(id => message.member.roles.cache.has(id));

    const ticket = await db.get(
        'SELECT * FROM tickets WHERE channel_id = ? AND status = ?',
        [message.channel.id, 'open']
    ).catch(() => null);

    const isOwner = ticket?.user_id === message.author.id;

    if (!isStaff && !isOwner) {
        message.reply('No tienes permiso para cerrar este ticket.')
            .then(w => setTimeout(() => w.delete().catch(() => {}), 5000))
            .catch(() => {});
        return;
    }

    const embed = new EmbedBuilder()
        .setColor('#FF4444')
        .setTitle('Ticket Cerrado')
        .setDescription(
            `Ticket cerrado por <@${message.author.id}>.\n` +
            `Este canal se eliminara en **5 segundos**.`
        )
        .setTimestamp();

    await Promise.all([
        db.run(
            'UPDATE tickets SET status = ?, closed_at = CURRENT_TIMESTAMP WHERE channel_id = ?',
            ['closed', message.channel.id]
        ).catch(() => {}),
        message.channel.send({ embeds: [embed] }).catch(() => {})
    ]);

    setTimeout(() => {
        message.channel.delete().catch(err =>
            console.error('Error eliminando canal de ticket:', err.message)
        );
    }, 5000);

    console.log(`[${message.guild.name}] Ticket cerrado por ${message.author.username}`);
}
