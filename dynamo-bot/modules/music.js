/**
 * music.js — Sistema de música con Lavalink + erela.js
 *
 * Variables de entorno requeridas:
 *   LAVALINK_HOST        (default: localhost)
 *   LAVALINK_PORT        (default: 2333)
 *   LAVALINK_PASSWORD    (default: youshallnotpass)
 *   SPOTIFY_CLIENT_ID    (opcional — activa soporte Spotify)
 *   SPOTIFY_CLIENT_SECRET
 */

import { Manager } from 'erela.js';
import Spotify from 'erela.js-spotify';
import Filters from 'erela.js-filter';
import { EmbedBuilder } from 'discord.js';

// ─── Manager singleton ────────────────────────────────────────────────────────
let manager = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Construye una barra de progreso visual.
 * @param {number} current  Posición actual en ms
 * @param {number} total    Duración total en ms
 * @param {number} size     Longitud de la barra en caracteres
 */
function buildProgressBar(current, total, size = 20) {
  if (!total || total <= 0) return '`[──────────────────────]`';
  const progress = Math.min(Math.round((current / total) * size), size);
  const filled   = '█'.repeat(progress);
  const empty    = '─'.repeat(size - progress);
  return `\`[${filled}${empty}]\``;
}

/**
 * Formatea milisegundos a mm:ss o hh:mm:ss.
 */
function formatDuration(ms) {
  if (!ms || ms <= 0) return '0:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Responde de forma segura (deferred o no).
 */
async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(payload);
    }
    return await interaction.reply(payload);
  } catch (err) {
    console.error('[MUSIC] safeReply error:', err.message);
  }
}

/**
 * Construye el embed de "Now Playing".
 */
function buildNowPlayingEmbed(player) {
  const track    = player.queue.current;
  const position = player.position || 0;
  const duration = track?.duration || 0;
  const bar      = buildProgressBar(position, duration);

  return new EmbedBuilder()
    .setColor('#1DB954')
    .setTitle('🎵 Reproduciendo ahora')
    .setDescription(`**[${track?.title ?? 'Desconocido'}](${track?.uri ?? '#'})**`)
    .setThumbnail(track?.thumbnail ?? null)
    .addFields(
      { name: 'Artista',   value: track?.author  ?? 'Desconocido', inline: true },
      { name: 'Duración',  value: formatDuration(duration),        inline: true },
      { name: 'Volumen',   value: `${player.volume}%`,             inline: true },
      { name: 'Progreso',  value: `${bar}  \`${formatDuration(position)} / ${formatDuration(duration)}\``, inline: false }
    )
    .setFooter({ text: `Solicitado por ${track?.requester?.tag ?? 'Desconocido'}` });
}

// ─── Inicialización del Manager ───────────────────────────────────────────────

/**
 * Inicializa el Manager de Lavalink y registra todos los eventos.
 * Debe llamarse una sola vez en el evento `ready` del cliente.
 *
 * @param {import('discord.js').Client} client
 */
export function initMusicManager(client) {
  const plugins = [new Filters()];

  // Spotify solo si se proveen credenciales
  if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
    plugins.push(
      new Spotify({
        clientID:     process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET
      })
    );
    console.log('[MUSIC] Plugin de Spotify activado.');
  }

  manager = new Manager({
    nodes: [
      {
        host:       process.env.LAVALINK_HOST     ?? 'localhost',
        port:       Number(process.env.LAVALINK_PORT ?? 2333),
        password:   process.env.LAVALINK_PASSWORD ?? 'youshallnotpass',
        secure:     false,
        retryDelay: 5000,
        retryAmount: 10
      }
    ],
    plugins,
    send(id, payload) {
      const guild = client.guilds.cache.get(id);
      if (guild) guild.shard.send(payload);
    }
  });

  // ── Eventos del Manager ──────────────────────────────────────────────────

  manager.on('nodeConnect', node => {
    console.log(`[LAVALINK] Nodo conectado: ${node.options.host}:${node.options.port}`);
  });

  manager.on('nodeError', (node, error) => {
    console.error(`[LAVALINK] Error en nodo ${node.options.host}:`, error.message);
  });

  manager.on('nodeDisconnect', (node, reason) => {
    console.warn(`[LAVALINK] Nodo desconectado: ${node.options.host} — ${reason?.code ?? 'sin código'}`);
  });

  manager.on('nodeReconnect', node => {
    console.log(`[LAVALINK] Reconectando nodo: ${node.options.host}`);
  });

  // ── Eventos del Player ───────────────────────────────────────────────────

  manager.on('trackStart', (player, track) => {
    console.log(`[MUSIC] trackStart → ${track.title} (guild: ${player.guild})`);

    const channel = client.channels.cache.get(player.textChannel);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor('#1DB954')
      .setTitle('🎵 Reproduciendo ahora')
      .setDescription(`**[${track.title}](${track.uri})**`)
      .setThumbnail(track.thumbnail ?? null)
      .addFields(
        { name: 'Artista',  value: track.author ?? 'Desconocido', inline: true },
        { name: 'Duración', value: formatDuration(track.duration), inline: true },
        { name: 'Volumen',  value: `${player.volume}%`,            inline: true }
      )
      .setFooter({ text: `Solicitado por ${track.requester?.tag ?? 'Desconocido'}` });

    channel.send({ embeds: [embed] }).catch(() => {});
  });

  manager.on('trackEnd', (player, track) => {
    console.log(`[MUSIC] trackEnd → ${track.title} (guild: ${player.guild})`);
  });

  manager.on('trackError', (player, track, payload) => {
    console.error(`[MUSIC] trackError → ${track?.title}: ${payload?.exception?.message ?? 'error desconocido'}`);

    const channel = client.channels.cache.get(player.textChannel);
    channel?.send(`❌ Error al reproducir **${track?.title ?? 'pista desconocida'}**. Saltando...`).catch(() => {});

    // Intentar continuar con la siguiente pista
    if (player.queue.size > 0) {
      player.stop();
    } else {
      player.destroy();
    }
  });

  manager.on('trackStuck', (player, track) => {
    console.warn(`[MUSIC] trackStuck → ${track.title}`);
    const channel = client.channels.cache.get(player.textChannel);
    channel?.send(`⚠️ La pista **${track.title}** se atascó. Saltando...`).catch(() => {});
    player.stop();
  });

  manager.on('queueEnd', player => {
    console.log(`[MUSIC] queueEnd (guild: ${player.guild})`);

    const channel = client.channels.cache.get(player.textChannel);
    channel?.send(
      new EmbedBuilder()
        .setColor('#FF6B6B')
        .setDescription('✅ La cola ha terminado. ¡Hasta la próxima!')
        .toJSON()
        ? { embeds: [new EmbedBuilder().setColor('#FF6B6B').setDescription('✅ La cola ha terminado. ¡Hasta la próxima!')] }
        : '✅ La cola ha terminado.'
    ).catch(() => {});

    // Destruir el player tras un breve delay para evitar reconexiones fantasma
    setTimeout(() => {
      if (player && !player.playing && !player.paused) {
        player.destroy();
      }
    }, 30_000);
  });

  // ── Reenvío de payloads de voz de Discord → Lavalink ────────────────────
  client.on('raw', d => manager.updateVoiceState(d));

  manager.init(client.user.id);
  console.log('[MUSIC] Manager de Lavalink inicializado.');

  return manager;
}

// ─── Obtener el manager (con guard) ──────────────────────────────────────────

function getManager() {
  if (!manager) throw new Error('El Manager de Lavalink no ha sido inicializado. Llama a initMusicManager(client) primero.');
  return manager;
}

// ─── Handlers de comandos ─────────────────────────────────────────────────────

/**
 * /play <query>
 * Busca en YouTube, Spotify o SoundCloud y reproduce / añade a la cola.
 */
export async function handlePlay(interaction) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return safeReply(interaction, { content: '❌ Debes estar en un canal de voz para usar este comando.', ephemeral: true });
  }

  await interaction.deferReply();

  const query   = interaction.options.getString('query');
  const guildId = interaction.guildId;

  try {
    const mgr = getManager();

    // Crear o recuperar el player para este servidor
    let player = mgr.players.get(guildId);
    if (!player) {
      player = mgr.create({
        guild:       guildId,
        voiceChannel: voiceChannel.id,
        textChannel:  interaction.channelId,
        selfDeaf:     true,
        volume:       80
      });
    }

    // Conectar si no está conectado
    if (player.state !== 'CONNECTED') {
      player.connect();
    }

    // Buscar la pista
    const res = await mgr.search(query, interaction.user);

    switch (res.loadType) {
      case 'LOAD_FAILED':
        return interaction.editReply(`❌ Error al cargar: ${res.exception?.message ?? 'error desconocido'}`);

      case 'NO_MATCHES':
        return interaction.editReply('❌ No se encontraron resultados para tu búsqueda.');

      case 'PLAYLIST_LOADED': {
        player.queue.add(res.tracks);
        if (!player.playing && !player.paused) player.play();

        const embed = new EmbedBuilder()
          .setColor('#1DB954')
          .setTitle('📋 Playlist añadida')
          .setDescription(`**${res.playlist.name}**`)
          .addFields(
            { name: 'Pistas',    value: `${res.tracks.length}`,                    inline: true },
            { name: 'Duración',  value: formatDuration(res.playlist.duration),     inline: true }
          )
          .setFooter({ text: `Solicitado por ${interaction.user.tag}` });

        return interaction.editReply({ embeds: [embed] });
      }

      default: {
        // TRACK_LOADED o SEARCH_RESULT — tomamos la primera pista
        const track = res.tracks[0];
        player.queue.add(track);
        if (!player.playing && !player.paused) player.play();

        const isQueued = player.queue.size > 1 || player.playing;
        const embed = new EmbedBuilder()
          .setColor('#1DB954')
          .setTitle(isQueued ? '✅ Añadido a la cola' : '🎵 Reproduciendo ahora')
          .setDescription(`**[${track.title}](${track.uri})**`)
          .setThumbnail(track.thumbnail ?? null)
          .addFields(
            { name: 'Artista',  value: track.author ?? 'Desconocido',  inline: true },
            { name: 'Duración', value: formatDuration(track.duration), inline: true },
            ...(isQueued ? [{ name: 'Posición en cola', value: `#${player.queue.size}`, inline: true }] : [])
          )
          .setFooter({ text: `Solicitado por ${interaction.user.tag}` });

        return interaction.editReply({ embeds: [embed] });
      }
    }
  } catch (error) {
    console.error('[PLAY ERROR]', error);
    return interaction.editReply(`❌ Ocurrió un error: ${error.message}`);
  }
}

/**
 * /pause
 * Pausa o reanuda la reproducción actual.
 */
export async function handlePause(interaction) {
  try {
    const player = getManager().players.get(interaction.guildId);
    if (!player?.queue.current) {
      return interaction.reply({ content: '❌ No hay música reproduciéndose.', ephemeral: true });
    }

    if (player.paused) {
      player.pause(false);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#1DB954').setDescription('▶️ Música reanudada.')] });
    } else {
      player.pause(true);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFA500').setDescription('⏸️ Música pausada.')] });
    }
  } catch (error) {
    console.error('[PAUSE ERROR]', error);
    return interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
  }
}

/**
 * /change (skip)
 * Salta a la siguiente canción de la cola.
 */
export async function handleSkip(interaction) {
  try {
    const player = getManager().players.get(interaction.guildId);
    if (!player?.queue.current) {
      return interaction.reply({ content: '❌ No hay nada que saltar.', ephemeral: true });
    }

    const skipped = player.queue.current;
    player.stop(); // Dispara trackEnd → trackStart con la siguiente pista

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor('#1DB954')
          .setDescription(`⏭️ Saltando **${skipped.title}**...`)
      ]
    });
  } catch (error) {
    console.error('[SKIP ERROR]', error);
    return interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
  }
}

/**
 * /disconnect (stop)
 * Detiene la reproducción, limpia la cola y desconecta el bot.
 */
export async function handleStop(interaction) {
  try {
    const player = getManager().players.get(interaction.guildId);
    if (!player) {
      return interaction.reply({ content: '❌ No estoy conectado a ningún canal de voz.', ephemeral: true });
    }

    player.destroy();

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor('#FF6B6B')
          .setDescription('⏹️ Reproducción detenida y bot desconectado.')
      ]
    });
  } catch (error) {
    console.error('[STOP ERROR]', error);
    return interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
  }
}

/**
 * /queue
 * Muestra la cola de reproducción actual (hasta 10 pistas).
 */
export async function handleQueue(interaction) {
  try {
    const player = getManager().players.get(interaction.guildId);
    if (!player?.queue.current) {
      return interaction.reply({ content: '❌ La cola está vacía.', ephemeral: true });
    }

    const current  = player.queue.current;
    const upcoming = player.queue.toArray();
    const total    = upcoming.length;

    const list = upcoming.slice(0, 10).map((t, i) =>
      `\`${i + 1}.\` **${t.title}** — \`${formatDuration(t.duration)}\``
    ).join('\n') || '*No hay más pistas en la cola.*';

    const totalDuration = upcoming.reduce((acc, t) => acc + (t.duration ?? 0), 0);

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('📖 Cola de reproducción')
      .setDescription(
        `**Reproduciendo ahora:**\n▶️ **[${current.title}](${current.uri})** — \`${formatDuration(current.duration)}\`\n\n` +
        `**Próximas pistas:**\n${list}`
      )
      .addFields(
        { name: 'Pistas en cola', value: `${total}`,                    inline: true },
        { name: 'Duración total', value: formatDuration(totalDuration), inline: true },
        { name: 'Volumen',        value: `${player.volume}%`,           inline: true }
      )
      .setFooter({ text: total > 10 ? `... y ${total - 10} pistas más` : `${total} pista(s) en cola` });

    return interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error('[QUEUE ERROR]', error);
    return interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
  }
}

/**
 * /volume <level>
 * Ajusta el volumen del player (0–100).
 */
export async function handleVolume(interaction) {
  try {
    const player = getManager().players.get(interaction.guildId);
    if (!player?.queue.current) {
      return interaction.reply({ content: '❌ No hay música reproduciéndose.', ephemeral: true });
    }

    const level = interaction.options.getInteger('level');
    if (level < 0 || level > 100) {
      return interaction.reply({ content: '❌ El volumen debe estar entre **0** y **100**.', ephemeral: true });
    }

    player.setVolume(level);

    const emoji = level === 0 ? '🔇' : level < 30 ? '🔈' : level < 70 ? '🔉' : '🔊';
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor('#1DB954')
          .setDescription(`${emoji} Volumen ajustado a **${level}%**`)
      ]
    });
  } catch (error) {
    console.error('[VOLUME ERROR]', error);
    return interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
  }
}

/**
 * /nowplaying
 * Muestra información detallada de la pista actual con barra de progreso.
 */
export async function handleNowPlaying(interaction) {
  try {
    const player = getManager().players.get(interaction.guildId);
    if (!player?.queue.current) {
      return interaction.reply({ content: '❌ No hay música reproduciéndose.', ephemeral: true });
    }

    return interaction.reply({ embeds: [buildNowPlayingEmbed(player)] });
  } catch (error) {
    console.error('[NOWPLAYING ERROR]', error);
    return interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
  }
}

