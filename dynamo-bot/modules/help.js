import { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';

const helpCategories = {
  musica: {
    name: 'Música',
    emoji: '🎵',
    description: 'Comandos para reproducir música - Actualmente en desarrollo',
    commands: [
      { name: '/play <canción>', desc: 'Reproduce una canción' },
      { name: '/pause', desc: 'Pausa o reanuda la música' },
      { name: '/change', desc: 'Salta a la siguiente canción' },
      { name: '/disconnect', desc: 'Desconecta del canal de voz' },
      { name: '/queue', desc: 'Muestra la cola de reproducción' },
      { name: '/volume <0-100>', desc: 'Ajusta el volumen' },
      { name: '/nowplaying', desc: 'Muestra la canción actual' }
    ]
  },
  niveles: {
    name: 'Niveles',
    emoji: '•',
    description: 'Comandos del sistema de niveles y XP - Actualmente en desarrollo',
    commands: [
      { name: '/rank [usuario]', desc: 'Ver tu rango y XP' },
      { name: '/leaderboard', desc: 'Top 10 usuarios por XP' },
      { name: '/level-config <xp> <@rol>', desc: 'Configurar rol por XP (Admin)' }
    ]
  },
  moderacion: {
    name: 'Moderación',
    emoji: '•',
    description: 'Comandos de moderación y seguridad',
    commands: [
      { name: '/ban <@usuario> [razón]', desc: 'Banear usuario' },
      { name: '/kick <@usuario> [razón]', desc: 'Expulsar usuario' },
      { name: '/mute <@usuario> [tiempo]', desc: 'Silenciar usuario' },
      { name: '/unmute <@usuario>', desc: 'Dessilenciar usuario' },
      { name: '/warn <@usuario> [razón]', desc: 'Advertir usuario' },
      { name: '/warnings <@usuario>', desc: 'Ver advertencias' },
      { name: '/clear <cantidad>', desc: 'Eliminar mensajes' },
      { name: '/slowmode <segundos>', desc: 'Modo lento en canal' },
      { name: '/lock [canal]', desc: 'Bloquear canal' },
      { name: '/unlock [canal]', desc: 'Desbloquear canal' },
      { name: '/antispam <on|off>', desc: 'Activar/desactivar anti-spam' },
      { name: '/antibot <on|off>', desc: 'Activar/desactivar anti-bot' },
      { name: '/antiraid <on|off>', desc: 'Activar/desactivar anti-raid' }
    ]
  },
  configuracion: {
    name: 'Configuración',
    emoji: '•',
    description: 'Comandos de configuración del servidor',
    commands: [
      { name: '/config welcome <#canal>', desc: 'Canal de bienvenida' },
      { name: '/config exit <#canal>', desc: 'Canal de salida' },
      { name: '/config levels <#canal>', desc: 'Canal de niveles' },
      { name: '/config logs <#canal>', desc: 'Canal de logs' },
      { name: '/config ticket <#canal>', desc: 'Canal de tickets' },
      { name: '/config ticket-category <id>', desc: 'Categoría de tickets' },
      { name: '/config ticket-staff <@rol>', desc: 'Rol de staff' },
      { name: '/config music <#canal>', desc: 'Canal de música' },
      { name: '/config autorole <@rol>', desc: 'Rol automático' },
      { name: '/config ver', desc: 'Ver configuración actual' }
    ]
  },
  idioma: {
    name: 'Idioma',
    emoji: '•',
    description: 'Cambiar idioma del bot',
    commands: [
      { name: '/language <español|english>', desc: 'Cambiar idioma' }
    ]
  },
  ia: {
    name: 'Inteligencia Artificial',
    emoji: '•',
    description: 'Comandos de IA',
    commands: [
      { name: '/ia enable', desc: 'Activar IA en el servidor' },
      { name: '/ia disable', desc: 'Desactivar IA en el servidor' },
      { name: 'Menciona al bot en DM', desc: 'Conversa con la IA en privado' }
    ]
  }
};

function createCategoryEmbed(categoryKey) {
  const category = helpCategories[categoryKey];
  if (!category) return null;

  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle(`${category.emoji} ${category.name}`)
    .setDescription(category.description)
    .setFooter({ text: 'Dynamo Bot - Sistema de Ayuda' })
    .setTimestamp();

  for (const cmd of category.commands) {
    embed.addFields({
      name: cmd.name,
      value: cmd.desc,
      inline: false
    });
  }

  return embed;
}

function createSelectMenu() {
  return new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('help_select')
        .setPlaceholder('Selecciona una categoría...')
        .addOptions([
          { label: 'Música', value: 'musica', emoji: '•' },
          { label: 'Niveles', value: 'niveles', emoji: '•' },
          { label: 'Moderación', value: 'moderacion', emoji: '•' },
          { label: 'Configuración', value: 'configuracion', emoji: '•' },
          { label: 'Idioma', value: 'idioma', emoji: '•' },
          { label: 'Inteligencia Artificial', value: 'ia', emoji: '•' }
        ])
    );
}

export async function handleHelpCommand(interaction) {
  try {
    const mainEmbed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('Dynamo Bot - Sistema de Ayuda')
      .setDescription('Selecciona una categoría para ver los comandos disponibles.')
      .addFields(
        { name: '• Música', value: '7 comandos', inline: true },
        { name: '• Niveles', value: '3 comandos', inline: true },
        { name: '• Moderación', value: '13 comandos', inline: true },
        { name: '• Configuración', value: '10 comandos', inline: true },
        { name: '• Idioma', value: '1 comando', inline: true },
        { name: '• IA', value: '3 comandos', inline: true }
      )
      .setFooter({ text: 'Total: 37 comandos disponibles' })
      .setTimestamp();

    await interaction.reply({
      embeds: [mainEmbed],
      components: [createSelectMenu()],
      ephemeral: true
    });
  } catch (error) {
    console.error('[HELP] Error en handleHelpCommand:', error);
    await interaction.reply({
      content: 'Error al mostrar la ayuda.',
      ephemeral: true
    });
  }
}

export function handleHelpSelectMenu(interaction) {
  try {
    const categoryKey = interaction.values[0];
    const embed = createCategoryEmbed(categoryKey);

    if (!embed) {
      return interaction.reply({
        content: 'Categoría no encontrada.',
        ephemeral: true
      });
    }

    interaction.reply({
      embeds: [embed],
      components: [createSelectMenu()],
      ephemeral: true
    });
  } catch (error) {
    console.error('[HELP] Error en handleHelpSelectMenu:', error);
    interaction.reply({
      content: 'Error al procesar la selección.',
      ephemeral: true
    });
  }
}
