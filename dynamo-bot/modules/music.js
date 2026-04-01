import { Manager } from 'erela.js';
import Spotify from 'erela.js-spotify';
import { EmbedBuilder } from 'discord.js';

// ─── Manager global de Lavalink ──────────────────────────────────────
let manager = null;

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDuration(ms) {
  if (!ms || isNaN(ms)) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const hours    = Math.floor(totalSec / 3600);
  const minutes  = Math.floor((totalSec % 3600) / 60);
  const seconds  = totalSec % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function buildProgressBar(position, duration, length = 20) {
  if (!duration || duration === 0) return '▬'.repeat(length);
  const progress  = Math.min(Math.floor((position / duration) * length), length);
  const remaining = length - progress;
  return '▬'.repeat(Math.max(progress - 1, 0)) + '🔘' + '▬'.repeat(remaining);
}

function getPlayer(guildId) {
  return manager?.players.get(guildId) ?? null;
}

function createPlayer(client, voiceChannel, textChannel) {
  return manager.create({
    guild:   voiceChannel.guild.id,
    voiceChannel: voiceChannel.id,
    textChannel:  textChannel.id,
    selfDeafen: true,
    volume: 80
  });
}

// ─── Inicialización del Manager ──────────────────────────────────────

export async function initMusicManager(client) {
  const plugins = [];

  if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
    plugins.push(new Spotify({
      clientID:     process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET
    }));
    console.log('[MUSIC] Plugin de Spotify cargado.');
  }

  manager = new Manager({
    nodes: [
      {
        host:       process.env.LAVALINK_HOST     || 'localhost',
        port:       Number(process.env.LAVALINK_PORT)   || 2333,
        password:   process.env.LAVALINK_PASSWORD  || 'youshallnotpass',
        secure:     process.env.LAVALINK_SECURE === 'true',
        identifier: 'dynamo-main',
        retryAmount: 10,
        retryDelay:  5000
      }
    ],
    plugins,
    send(id, payload) {
      const guild = client.guilds.cache.get(id);
      if (guild) guild.shard.send(payload);
    }
  });

  // ── Eventos del nodo ──
  manager.on('nodeConnect', node =>
    console.log(`[LAVALINK] Nodo "${node.options.identifier}" conectado.`)
  );
  manager.on('nodeError', (node, error) =>
    console.error(`[LAVALINK] Error en nodo "${node.options.identifier}":`, error.message)
  );
  manager.on('nodeDisconnect', node =>
    console.warn(`[LAVALINK] Nodo "${node.options.identifier}" desconectado.`)
  );

  // ── Eventos de reproducción ──
  manager.on('trackStart', (player, track) => {
    const channel = client.channels.cache.get(player.textChannel);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor('#1DB954')
      .setTitle('🎶 Reproduciendo ahora')
      .setDescription(`**[${track.title}](${track.uri})**`)
      .addFields(
        { name: '👤 Artista',   value: track.author   || 'Desconocido', inline: true },
        { name: '⏱️ Duración',  value: track.isStream ? '🔴 En vivo' : formatDuration(track.duration), inline: true },
        { name: '🔊 Volumen',   value: `${player.volume}%`, inline: true }
      )
      .setThumbnail(track.thumbnail || null)
      .setFooter({ text: `Solicitado por ${track.requester?.tag ?? 'Desconocido'}` })
      .setTimestamp();

    channel.send({ embeds: [embed] }).catch(() => {});
  });

  manager.on('trackEnd', (player, track, payload) => {
    if (payload.reason === 'REPLACED') return;
    console.log(`[MUSIC] Pista terminada: ${track.title}`);
  });

  manager.on('trackError', (player, track, payload) => {
    console.error(`[MUSIC] Error en pista "${track.title}":`, payload.error);
    const channel = client.channels.cache.get(player.textChannel);
    if (channel) {
      channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor('#ED4245')
            .setTitle('❌ Error de reproducción')
            .setDescription(`No se pudo reproducir **${track.title}**.\nSaltando a la siguiente canción...`)
        ]
      }).catch(() => {});
    }
  });

  manager.on('trackStuck', (player, track) => {
    console.warn(`[MUSIC] Pista atascada: ${track.title}. Saltando...`);
    player.stop();
  });

  manager.on('queueEnd', player => {
    const channel = client.channels.cache.get(player.textChannel);
    if (channel) {
      channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('✅ Cola finalizada')
            .setDescription('No hay más canciones en la cola. ¡Añade más con `/play`!')
        ]
      }).catch(() => {});
    }
    player.destroy();
  });

  // ── Reenviar eventos de voz de Discord al Manager ──
  client.on('raw', data => manager.updateVoiceState(data));

  manager.init(client.user.id);
}

// ─── Comandos ─────────────────────────────────────────────────────────

export async function handlePlay(interaction) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return interaction.reply({ content: '❌ Debes estar en un canal de voz para usar este comando.', ephemeral: true });
  }

  if (!manager) {
    return interaction.reply({ content: '❌ El sistema de música no está listo todavía. Inténtalo en unos segundos.', ephemeral: true });
  }

  await interaction.deferReply();

  const query   = interaction.options.getString('query');
  const guildId = interaction.guildId;

  try {
    let player = getPlayer(guildId);
    if (!player) {
      player = createPlayer(interaction.client, voiceChannel, interaction.channel);
    }

    const res = await manager.search(query, interaction.user);

    switch (res.loadType) {
      case 'LOAD_FAILED':
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('#ED4245')
              .setTitle('❌ Error al cargar')
              .setDescription(`No se pudo cargar la canción: \`${res.exception?.message ?? 'Error desconocido'}\``)
          ]
        });

      case 'NO_MATCHES':
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('#FEE75C')
              .setTitle('🔍 Sin resultados')
              .setDescription(`No se encontraron resultados para: **${query}**`)
          ]
        });

      case 'PLAYLIST_LOADED': {
        for (const track of res.tracks) {
          track.requester = interaction.user;
          player.queue.add(track);
        }
        const embed = new EmbedBuilder()
          .setColor('#1DB954')
          .setTitle('📋 Lista de reproducción añadida')
          .setDescription(`**${res.playlist.name}**`)
          .addFields(
            { name: '🎵 Canciones', value: `${res.tracks.length}`, inline: true },
            { name: '⏱️ Duración',  value: formatDuration(res.playlist.duration), inline: true }
          )
          .setFooter({ text: `Solicitado por ${interaction.user.tag}` });

        if (!player.playing && !player.paused) player.connect().play();
        return interaction.editReply({ embeds: [embed] });
      }

      default: {
        const track = res.tracks[0];
        track.requester = interaction.user;
        player.queue.add(track);

        if (!player.playing && !player.paused) {
          player.connect().play();
          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setColor('#1DB954')
                .setTitle('🎶 Reproduciendo ahora')
                .setDescription(`**[${track.title}](${track.uri})**`)
                .addFields(
                  { name: '👤 Artista',  value: track.author   || 'Desconocido', inline: true },
                  { name: '⏱️ Duración', value: track.isStream ? '🔴 En vivo' : formatDuration(track.duration), inline: true }
                )
                .setThumbnail(track.thumbnail || null)
                .setFooter({ text: `Solicitado por ${interaction.user.tag}` })
            ]
          });
        }

        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('#5865F2')
              .setTitle('✅ Añadido a la cola')
              .setDescription(`**[${track.title}](${track.uri})**`)
              .addFields(
                { name: '👤 Artista',       value: track.author || 'Desconocido', inline: true },
                { name: '⏱️ Duración',      value: track.isStream ? '🔴 En vivo' : formatDuration(track.duration), inline: true },
                { name: '📋 Posición cola', value: `${player.queue.size}`, inline: true }
              )
              .setThumbnail(track.thumbnail || null)
              .setFooter({ text: `Solicitado por ${interaction.user.tag}` })
          ]
        });
      }
    }
  } catch (error) {
    console.error('[PLAY ERROR]', error);
    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor('#ED4245')
          .setTitle('❌ Error inesperado')
          .setDescription('Ocurrió un error interno al procesar la música. Inténtalo de nuevo.')
      ]
    });
  }
}

export async function handlePause(interaction) {
  const player = getPlayer(interaction.guildId);
  if (!player || !player.playing) {
    return interaction.reply({ content: '❌ No hay música activa en este servidor.', ephemeral: true });
  }

  if (player.paused) {
    player.pause(false);
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor('#1DB954')
          .setTitle('▶️ Música reanudada')
          .setDescription(`Reanudando: **${player.queue.current?.title ?? 'canción actual'}**`)
      ]
    });
  }

  player.pause(true);
  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor('#FEE75C')
        .setTitle('⏸️ Música pausada')
        .setDescription(`Pausado: **${player.queue.current?.title ?? 'canción actual'}**\nUsa \`/pause\` de nuevo para reanudar.`)
    ]
  });
}

export async function handleSkip(interaction) {
  const player = getPlayer(interaction.guildId);
  if (!player || !player.playing) {
    return interaction.reply({ content: '❌ No hay música activa en este servidor.', ephemeral: true });
  }

  const current = player.queue.current?.title ?? 'canción actual';
  const next    = player.queue[0]?.title;

  player.stop();

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('⏭️ Canción saltada')
        .setDescription(`Se saltó: **${current}**${next ? `\nSiguiente: **${next}**` : '\nNo hay más canciones en la cola.'}`)
    ]
  });
}

export async function handleStop(interaction) {
  const player = getPlayer(interaction.guildId);
  if (!player) {
    return interaction.reply({ content: '❌ No estoy conectado a ningún canal de voz.', ephemeral: true });
  }

  player.destroy();

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle('⏹️ Reproducción detenida')
        .setDescription('Se limpió la cola y el bot se desconectó del canal de voz.')
    ]
  });
}

export async function handleQueue(interaction) {
  const player = getPlayer(interaction.guildId);
  if (!player || (!player.playing && player.queue.size === 0)) {
    return interaction.reply({ content: '❌ La cola está vacía.', ephemeral: true });
  }

  const current  = player.queue.current;
  const upcoming = player.queue.slice(0, 10);
  const total    = player.queue.size;

  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('📋 Cola de reproducción')
    .setTimestamp();

  if (current) {
    const bar = buildProgressBar(player.position, current.duration);
    embed.addFields({
      name: '▶️ Reproduciendo ahora',
      value: `**[${current.title}](${current.uri})**\n${bar}\n\`${formatDuration(player.position)} / ${formatDuration(current.duration)}\``
    });
  }

  if (upcoming.length > 0) {
    const list = upcoming.map((t, i) =>
      `\`${i + 1}.\` **${t.title}** — \`${formatDuration(t.duration)}\``
    ).join('\n');
    embed.addFields({ name: `📜 Próximas canciones (${total} en total)`, value: list });
  }

  if (total > 10) {
    embed.setFooter({ text: `... y ${total - 10} canciones más en la cola` });
  }

  return interaction.reply({ embeds: [embed] });
}

export async function handleVolume(interaction) {
  const player = getPlayer(interaction.guildId);
  if (!player || !player.playing) {
    return interaction.reply({ content: '❌ No hay música activa en este servidor.', ephemeral: true });
  }

  const level = interaction.options.getInteger('level');
  player.setVolume(level);

  const bar   = '█'.repeat(Math.floor(level / 10)) + '░'.repeat(10 - Math.floor(level / 10));
  const emoji = level === 0 ? '🔇' : level < 30 ? '🔈' : level < 70 ? '🔉' : '🔊';

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor('#1DB954')
        .setTitle(`${emoji} Volumen ajustado`)
        .setDescription(`\`[${bar}]\` **${level}%**`)
    ]
  });
}

export async function handleNowPlaying(interaction) {
  const player = getPlayer(interaction.guildId);
  if (!player || !player.queue.current) {
    return interaction.reply({ content: '❌ No hay ninguna canción reproduciéndose ahora mismo.', ephemeral: true });
  }

  const track = player.queue.current;
  const bar   = buildProgressBar(player.position, track.duration);

  const embed = new EmbedBuilder()
    .setColor('#1DB954')
    .setTitle('🎶 Reproduciendo ahora')
    .setDescription(`**[${track.title}](${track.uri})**`)
    .addFields(
      { name: '👤 Artista',   value: track.author || 'Desconocido', inline: true },
      { name: '⏱️ Duración',  value: track.isStream ? '🔴 En vivo' : formatDuration(track.duration), inline: true },
      { name: '🔊 Volumen',   value: `${player.volume}%`, inline: true },
      { name: '📊 Progreso',  value: `${bar}\n\`${formatDuration(player.position)} / ${formatDuration(track.duration)}\``, inline: false }
    )
    .setThumbnail(track.thumbnail || null)
    .setFooter({ text: `Solicitado por ${track.requester?.tag ?? 'Desconocido'}` })
    .setTimestamp();

  return interaction.reply({ embeds: [embed] });
}

