import { ChannelType, PermissionsBitField, EmbedBuilder } from 'discord.js';
import { getDB } from '../database/db.js';

export async function handleTicketCreation(message, config) {
    // Evitar que el bot actúe en DMs o responda a otros bots
    if (!message.guild || message.author.bot) return false;

    // Convertir a texto de forma segura para evitar errores de .trim()
    const ticketCategoryId = String(config.TICKET_CATEGORY_ID || '').trim();
    const ticketChannelId  = String(config.TICKET_CHANNEL_ID || '').trim();

    // ── Comando !close dentro de un canal de ticket ──────────────────
    if (message.channel.name?.startsWith('ticket-') && message.content.toLowerCase() === '!close') {
        await closeTicket(message, config);
        return true;
    }

    // ── Solo actuar en el canal designado para abrir tickets ─────────
    if (!ticketChannelId || message.channel.id !== ticketChannelId) return false;
    if (!ticketCategoryId) return false;

    const db = getDB();

    // ── Verificar ticket existente ───────────────────────────────────
    try {
        const existing = await db.get(
            'SELECT * FROM tickets WHERE user_id = ? AND guild_id = ? AND status = ?',
            [message.author.id, message.guild.id, 'open']
        );

        if (existing) {
            const existingChannel = message.guild.channels.cache.get(existing.channel_id);
            if (existingChannel) {
                const warn = await message.reply({
                    content: `Ya tienes un ticket abierto en <#${existing.channel_id}>. Escribe \`!close\` ahí para cerrarlo antes de abrir uno nuevo.`
                });
                setTimeout(() => warn.delete().catch(() => {}), 7000);
                await message.delete().catch(() => {});
                return true;
            }
            // Canal eliminado manualmente → cerrar ticket huérfano y continuar
            await db.run(
                'UPDATE tickets SET status = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?',
                ['closed', existing.id]
            );
        }
    } catch (dbErr) {
        console.error('Error en DB al verificar ticket existente:', dbErr.message);
    }

    // ── Sanitizar nombre de usuario ──────────────────────────────────
    const safeUsername = message.author.username
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 20) || 'usuario';

    // ── Construir permisos del canal ─────────────────────────────────
    const staffRoleIds = String(config.TICKET_STAFF_ROLES || '')
        .split(',')
        .map(r => r.trim())
        .filter(Boolean);

    const permissionOverwrites = [
        // Ocultar el canal a todos por defecto
        {
            id: message.guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
        },
        // Permitir al usuario que abrió el ticket
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

    // Agregar roles de staff SOLO si existen en el servidor (esto causaba tu error)
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

    // ── Crear canal del ticket ───────────────────────────────────────
    try {
        const ticketChannel = await message.guild.channels.create({
            name: `ticket-${safeUsername}`,
            type: ChannelType.GuildText,
            parent: ticketCategoryId,
            permissionOverwrites
        });

        const now     = new Date();
        const dateStr = now.toLocaleDateString('es-ES');
        const timeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const avatarURL = message.author.displayAvatarURL({ size: 64, extension: 'png' });

        // Manejar caso donde el usuario solo envía una imagen sin texto
        const reasonStr = message.content || 'Sin especificar';

        const embed = new EmbedBuilder()
            .setColor('#FF8C00')
            .setTitle('🎫 Ticket Abierto')
            .setThumbnail(avatarURL)
            .setDescription(
                `Hola <@${message.author.id}>, el equipo de soporte atenderá tu solicitud en breve.\n\n` +
                `**Motivo:** ${reasonStr}\n` +
                `**Fecha:** ${dateStr} — **Hora:** ${timeStr}`
            )
            .setFooter({ text: 'Escribe !close para cerrar este ticket.' })
            .setTimestamp();

        await ticketChannel.send({ content: `<@${message.author.id}>`, embeds: [embed] });
        await message.delete().catch(() => {});

        await db.run(
            'INSERT INTO tickets (user_id, guild_id, channel_id, reason, status) VALUES (?, ?, ?, ?, ?)',
            [message.author.id, message.guild.id, ticketChannel.id, reasonStr, 'open']
        );

        console.log(`✅ Ticket creado para ${message.author.username} → #${ticketChannel.name}`);
        return true;

    } catch (error) {
        console.error(`❌ Error creando ticket — Código: ${error.code} | Mensaje: ${error.message}`);

        let errorMsg = 'Ocurrió un error al crear tu ticket. Contacta a un administrador.';
        if (error.code === 50013) errorMsg = 'El bot no tiene el permiso **Gestionar Canales**. Otórgaselo en el servidor.';
        if (error.code === 50001) errorMsg = 'El bot no tiene acceso a la categoría de tickets.';
        if (error.code === 50035) errorMsg = 'Error 50035: Revisa que el ID de la categoría sea correcto.';

        await message.channel.send(errorMsg).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
        return false;
    }
}

async function closeTicket(message, config) {
    if (!message.guild) return;
    const db = getDB();
    try {
        const staffRoles = String(config.TICKET_STAFF_ROLES || '')
            .split(',').map(r => r.trim()).filter(Boolean);

        const isStaff =
            message.member.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
            staffRoles.some(roleId => message.member.roles.cache.has(roleId));

        const ticket = await db.get(
            'SELECT * FROM tickets WHERE channel_id = ? AND status = ?',
            [message.channel.id, 'open']
        );

        const isOwner = ticket && ticket.user_id === message.author.id;

        if (!isStaff && !isOwner) {
            const warn = await message.reply('No tienes permiso para cerrar este ticket.');
            setTimeout(() => warn.delete().catch(() => {}), 5000);
            return;
        }

        await db.run(
            'UPDATE tickets SET status = ?, closed_at = CURRENT_TIMESTAMP WHERE channel_id = ?',
            ['closed', message.channel.id]
        );

        const embed = new EmbedBuilder()
            .setColor('#FF4444')
            .setTitle('🔒 Ticket Cerrado')
            .setDescription(
                `Ticket cerrado por <@${message.author.id}>.\n` +
                `Este canal se eliminará en **5 segundos**.`
            )
            .setTimestamp();

        await message.channel.send({ embeds: [embed] });

        setTimeout(async () => {
            await message.channel.delete().catch(err =>
                console.error('Error eliminando canal de ticket:', err.message)
            );
        }, 5000);

        console.log(`✅ Ticket cerrado por ${message.author.username} → #${message.channel.name}`);
    } catch (error) {
        console.error('Error cerrando ticket:', error.message);
        await message.reply('Ocurrió un error al cerrar el ticket.').catch(() => {});
    }
}
