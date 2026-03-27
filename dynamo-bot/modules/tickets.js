import { ChannelType, PermissionsBitField, EmbedBuilder } from 'discord.js';
import { getDB } from '../database/db.js';
import { getConfig } from './config-manager.js';

// Guard de creación por usuario+guild para evitar doble-click
const creating = new Set();

export async function handleTicketCreation(message) {
  if (!message.guild || message.author.bot) return false;

  // Obtener configuración de forma asíncrona
  const config = await getConfig(message.guild.id);
  if (!config) return false;

  const ticketCategoryId = config.ticket_category_id?.trim() || '';
  const ticketChannelId = config.ticket_channel_id?.trim() || '';

  // Comando !close: verificar por ID en la BD
  if (message.content.toLowerCase() === '!close') {
    const db = getDB();
    const isTicket = await db.oneOrNone(
      'SELECT id FROM tickets WHERE channel_id = $1 AND status = $2',
      [message.channel.id, 'open']
    ).catch(() => null);

    if (isTicket) {
      await closeTicket(message, config);
      return true;
    }
  }

  // Verificar si estamos en el canal de apertura de tickets
  if (!ticketChannelId || message.channel.id !== ticketChannelId) return false;
  if (!ticketCategoryId) return false;

  // Evitar spam de creación (Double click guard)
  const guardKey = `${message.guild.id}:${message.author.id}`;
  if (creating.has(guardKey)) {
    message.delete().catch(() => {});
    return true;
  }
  creating.add(guardKey);

  const db = getDB();

  try {
    // Verificar si ya tiene un ticket abierto
    const existing = await db.oneOrNone(
      'SELECT * FROM tickets WHERE user_id = $1 AND guild_id = $2 AND status = $3',
      [message.author.id, message.guild.id, 'open']
    ).catch(() => null);

    if (existing) {
      const existingChannel = message.guild.channels.cache.get(existing.channel_id) || 
        await message.guild.channels.fetch(existing.channel_id).catch(() => null);
      
      if (existingChannel) {
        const warn = await message.reply({
          content: `Ya tienes un ticket abierto en <#${existing.channel_id}>. Escribe \`!close\` ahí para cerrarlo primero.`
        }).catch(() => null);

        if (warn) setTimeout(() => warn.delete().catch(() => {}), 7000);
        message.delete().catch(() => {});
        return true;
      }
      
      // Si el canal ya no existe en Discord pero figura abierto en la DB, lo marcamos como cerrado
      await db.none(
        'UPDATE tickets SET status = $1, closed_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['closed', existing.id]
      ).catch(() => {});
    }

    // Limpiar nombre de usuario para el canal
    const safeUsername = message.author.username
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 20) || 'usuario';

    const staffRoleIds = (config.ticket_staff_roles || '')
      .split(',').map(r => r.trim()).filter(Boolean);

    // Configurar permisos del canal
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

    // Crear el canal
    const ticketChannel = await message.guild.channels.create({
      name: `ticket-${safeUsername}`,
      type: ChannelType.GuildText,
      parent: ticketCategoryId,
      permissionOverwrites
    });

    const now = new Date();
    const dateStr = now.toLocaleDateString('es-ES');
    const timeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const reasonStr = message.content || 'Sin especificar';

    const embed = new EmbedBuilder()
      .setColor('#c816f0')
      .setTitle('Ticket Abierto')
      .setThumbnail(message.author.displayAvatarURL({ size: 64, extension: 'png' }))
      .setDescription(
        `Hola <@${message.author.id}>, el equipo de soporte atenderá tu solicitud en breve.\n\n` +
        `**Motivo:** ${reasonStr}\n` +
        `**Fecha:** ${dateStr} — **Hora:** ${timeStr}`
      )
      .setFooter({ text: 'Escribe !close para cerrar este ticket.' })
      .setTimestamp();

    await ticketChannel.send({ content: `<@${message.author.id}>`, embeds: [embed] });
    message.delete().catch(() => {});

    // Guardar en Base de Datos
    await db.none(
      'INSERT INTO tickets (user_id, guild_id, channel_id, reason, status) VALUES ($1, $2, $3, $4, $5)',
      [message.author.id, message.guild.id, ticketChannel.id, reasonStr, 'open']
    );

    console.log(`[${message.guild.name}] Ticket creado: ${message.author.username} -> #${ticketChannel.name}`);
    return true;

  } catch (error) {
    console.error(`[${message.guild.name}] Error creando ticket:`, error.code, error.message);
    let errorMsg = 'Ocurrió un error al crear tu ticket. Contacta a un administrador.';
    if (error.code === 50013) errorMsg = 'El bot no tiene el permiso **Gestionar Canales**.';
    if (error.code === 50001) errorMsg = 'El bot no tiene acceso a la categoría de tickets.';
    
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

  // Verificar permisos para cerrar
  const isStaff =
    message.member.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
    staffRoles.some(id => message.member.roles.cache.has(id));

  const ticket = await db.oneOrNone(
    'SELECT * FROM tickets WHERE channel_id = $1 AND status = $2',
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
    .setColor('#c816f0')
    .setTitle('Ticket Cerrado')
    .setDescription(
      `Ticket cerrado por <@${message.author.id}>.\n` +
      `Este canal se eliminará en **5 segundos**.`
    )
    .setTimestamp();

  try {
    await db.none(
      'UPDATE tickets SET status = $1, closed_at = CURRENT_TIMESTAMP WHERE channel_id = $2',
      ['closed', message.channel.id]
    );
    
    await message.channel.send({ embeds: [embed] }).catch(() => {});

    setTimeout(() => {
      message.channel.delete().catch(err =>
        console.error('Error eliminando canal de ticket:', err.message)
      );
    }, 5000);

    console.log(`[${message.guild.name}] Ticket cerrado por ${message.author.username}`);
  } catch (err) {
    console.error('Error al cerrar ticket:', err.message);
  }
}
