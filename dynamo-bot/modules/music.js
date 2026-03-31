import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState
} from '@discordjs/voice';
import play from 'play-dl';

const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      songs: [],
      player: null,
      connection: null,
      playing: false
    });
  }
  return queues.get(guildId);
}

async function playSong(queue, guildId) {
  if (!queue.songs.length) {
    queue.playing = false;
    if (queue.connection) {
      try {
        queue.connection.destroy();
      } catch (e) {}
    }
    queue.connection = null;
    queues.delete(guildId);
    return;
  }

  const song = queue.songs[0];
  queue.playing = true;

  try {
    // Forzar actualización de tokens para evitar errores 403
    if (play.is_expired()) await play.getFreeToken();

    const stream = await play.stream(song.url, { 
      quality: 2,
      discordPlayerCompatibility: true 
    });
    
    const resource = createAudioResource(stream.stream, { 
      inputType: stream.type,
      inlineVolume: true
    });

    resource.volume.setVolume(0.5);
    queue.player.play(resource);
    console.log(`[MUSIC] Sonando ahora: ${song.title}`);

  } catch (error) {
    console.error(`[MUSIC ERROR] Error en ${song.title}:`, error.message);
    queue.songs.shift();
    await playSong(queue, guildId);
  }
}

export async function handlePlay(interaction) {
  const voiceChannel = interaction.member.voice.channel;
  
  if (!voiceChannel) {
    return interaction.reply({ content: '¡Debes estar en un canal de voz!', ephemeral: true });
  }

  await interaction.deferReply();

  const query = interaction.options.getString('query');
  const guildId = interaction.guildId;
  const queue = getQueue(guildId);

  try {
    let songInfo;
    const validation = await play.validate(query);

    // Mejor detección de URL vs Búsqueda
    if (validation === 'video' || (typeof query === 'string' && query.includes('http'))) {
      const info = await play.video_info(query);
      songInfo = {
        title: info.video_details.title,
        url: info.video_details.url,
        duration: info.video_details.durationRaw
      };
    } else {
      const results = await play.search(query, { limit: 1 });
      if (!results || results.length === 0) return interaction.editReply('No se encontraron resultados.');
      songInfo = {
        title: results[0].title,
        url: results[0].url,
        duration: results[0].durationRaw
      };
    }

    queue.songs.push(songInfo);

    // Inicializar Player
    if (!queue.player) {
      queue.player = createAudioPlayer();
      
      queue.player.on(AudioPlayerStatus.Idle, () => {
        queue.songs.shift();
        playSong(queue, guildId);
      });

      queue.player.on('error', (error) => {
        console.error(`[PLAYER ERROR]`, error.message);
        queue.songs.shift();
        playSong(queue, guildId);
      });
    }

    // Inicializar Conexión (AQUÍ ESTABA EL FALLO)
    if (!queue.connection || queue.connection.state.status === VoiceConnectionStatus.Destroyed) {
      queue.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true, // ESTO ES VITAL: Evita errores de timeout en muchos servidores
        selfMute: false
      });

      queue.connection.subscribe(queue.player);

      try {
        // Esperamos a que la conexión esté lista
        await entersState(queue.connection, VoiceConnectionStatus.Ready, 20_000);
        console.log(`[MUSIC] Conectado exitosamente a ${guildId}`);
      } catch (error) {
        console.error(`[CONNECTION ERROR] No se pudo establecer conexión:`, error.message);
        queue.connection.destroy();
        queue.connection = null;
        return interaction.editReply('❌ Error al conectar al canal de voz (Timeout). Intenta de nuevo.');
      }
    }

    if (queue.player.state.status !== AudioPlayerStatus.Playing) {
      await playSong(queue, guildId);
      await interaction.editReply(`🎶 Reproduciendo ahora: **${songInfo.title}**`);
    } else {
      await interaction.editReply(`✅ Añadido a la cola: **${songInfo.title}**`);
    }

  } catch (error) {
    console.error(`[PLAY ERROR]`, error);
    await interaction.editReply('Ocurrió un error interno al intentar reproducir.');
  }
}

export async function handlePause(interaction) {
  const queue = queues.get(interaction.guildId);
  if (!queue?.player) return interaction.reply({ content: 'No hay música activa.', ephemeral: true });

  if (queue.player.state.status === AudioPlayerStatus.Playing) {
    queue.player.pause();
    await interaction.reply('⏸️ Música pausada.');
  } else {
    queue.player.unpause();
    await interaction.reply('▶️ Música reanudada.');
  }
}

export async function handleSkip(interaction) {
  const queue = queues.get(interaction.guildId);
  if (!queue || queue.songs.length === 0) {
    return interaction.reply({ content: 'No hay nada que saltar.', ephemeral: true });
  }

  queue.player.stop(); // Esto dispara el evento Idle automáticamente
  await interaction.reply('⏭️ Saltando canción...');
}

export async function handleStop(interaction) {
  const queue = queues.get(interaction.guildId);
  if (!queue) return interaction.reply({ content: 'No estoy en un canal de voz.', ephemeral: true });

  queue.songs = [];
  queue.player?.stop(true);
  queue.connection?.destroy();
  queues.delete(interaction.guildId);

  await interaction.reply('⏹️ Música detenida y bot desconectado.');
}

export async function handleQueue(interaction) {
  const queue = queues.get(interaction.guildId);
  if (!queue || !queue.songs.length) return interaction.reply('La cola está vacía.');

  const list = queue.songs.slice(0, 10).map((s, i) =>
    `${i === 0 ? '▶️' : `${i}.`} **${s.title}** \`[${s.duration}]\``
  ).join('\n');

  await interaction.reply(`📖 **Cola de reproducción:**\n${list}${queue.songs.length > 10 ? `\n... y ${queue.songs.length - 10} más` : ''}`);
}
