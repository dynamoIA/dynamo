import { EmbedBuilder } from 'discord.js';
import { getDB } from '../database/db.js';
import { getConfig } from './config-manager.js';

/**
 * Maneja la entrada de nuevos miembros (Bienvenidas y Autorole).
 */
export async function handleMemberJoin(member) {
  // Obtenemos la configuración de forma asíncrona
  const config = await getConfig(member.guild.id);
  if (!config) return;

  // --- Lógica de Auto-Role ---
  if (config.autorole_id) {
    member.roles.add(config.autorole_id).catch(err =>
      console.error(`[${member.guild.name}] Error asignando autorole:`, err.message)
    );
  }

  // --- Lógica de Bienvenida ---
  if (config.welcome_channel_id) {
    try {
      // Buscamos el canal en caché o mediante fetch por si acaso
      let channel = member.guild.channels.cache.get(config.welcome_channel_id);
      if (!channel) {
        channel = await member.guild.channels.fetch(config.welcome_channel_id).catch(() => null);
      }

      if (channel && channel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setColor('#1E90FF') // Azul brillante
          .setTitle('¡Bienvenido al servidor!')
          .setDescription(
            `Hola <@${member.id}>, nos alegra tenerte aquí.\n\n` +
            `Eres el miembro número **${member.guild.memberCount}** de **${member.guild.name}**.`
          )
          .setThumbnail(member.user.displayAvatarURL({ size: 256, extension: 'png' }))
          .setFooter({
            text: `Bienvenida • ${member.guild.name}`,
            iconURL: member.guild.iconURL({ extension: 'png' }) ?? undefined
          })
          .setTimestamp();

        await channel.send({ embeds: [embed] });
      }
    } catch (err) {
      console.error(`[${member.guild.name}] Error enviando bienvenida:`, err.message);
    }
  }

  // --- Registro en Base de Datos ---
  try {
    const db = getDB();
    await db.run(
      'INSERT OR IGNORE INTO users (user_id, guild_id, username) VALUES (?, ?, ?)',
      [member.id, member.guild.id, member.user.username]
    );
  } catch (err) {
    console.error('Error registrando usuario en DB:', err.message);
  }
}

/**
 * Maneja la salida de miembros (Despedidas).
 */
export async function handleMemberRemove(member) {
  const config = await getConfig(member.guild.id);
  if (!config || !config.exit_channel_id) return;

  try {
    // Buscamos el canal de despedidas
    let channel = member.guild.channels.cache.get(config.exit_channel_id);
    if (!channel) {
      channel = await member.guild.channels.fetch(config.exit_channel_id).catch(() => null);
    }

    if (channel && channel.isTextBased()) {
      const embed = new EmbedBuilder()
        .setColor('#FF4444') // Rojo suave
        .setTitle('Hasta luego')
        .setDescription(`**${member.user.username}** ha abandonado el servidor.`)
        .setThumbnail(member.user.displayAvatarURL({ size: 256, extension: 'png' }))
        .setFooter({
          text: `Salida • ${member.guild.name}`,
          iconURL: member.guild.iconURL({ extension: 'png' }) ?? undefined
        })
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error(`[${member.guild.name}] Error enviando despedida:`, err.message);
  }
}
