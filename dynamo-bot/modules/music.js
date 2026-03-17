import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus
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
            queue.connection.destroy();
            queue.connection = null;
        }
        return;
    }

    const song = queue.songs[0];
    queue.playing = true;

    try {
        const stream = await play.stream(song.url, { quality: 2 });
        const resource = createAudioResource(stream.stream, { inputType: stream.type });
        queue.player.play(resource);
    } catch (error) {
        console.error('Error reproduciendo:', error);
        queue.songs.shift();
        await playSong(queue, guildId);
    }
}

export async function handlePlay(interaction) {
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
        return interaction.reply({ content: 'Debes estar en un canal de voz.', ephemeral: true });
    }

    await interaction.deferReply();

    const query = interaction.options.getString('query');

    try {
        let songInfo;
        const validated = play.yt_validate(query);

        if (validated === 'video') {
            const info = await play.video_info(query);
            songInfo = {
                title: info.video_details.title,
                url: query,
                duration: info.video_details.durationRaw
            };
        } else {
            const results = await play.search(query, { limit: 1 });
            if (!results.length) return interaction.editReply('No se encontraron resultados.');
            songInfo = {
                title: results[0].title,
                url: results[0].url,
                duration: results[0].durationRaw
            };
        }

        const guildId = interaction.guildId;
        const queue = getQueue(guildId);
        queue.songs.push(songInfo);

        if (!queue.player) {
            queue.player = createAudioPlayer();

            queue.player.on(AudioPlayerStatus.Idle, () => {
                queue.songs.shift();
                playSong(queue, guildId);
            });

            queue.player.on('error', (error) => {
                console.error('Player error:', error);
                queue.songs.shift();
                playSong(queue, guildId);
            });
        }

        if (!queue.connection) {
            queue.connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId,
                adapterCreator: interaction.guild.voiceAdapterCreator
            });
            queue.connection.subscribe(queue.player);
        }

        if (!queue.playing) {
            await playSong(queue, guildId);
            await interaction.editReply(`Reproduciendo: **${songInfo.title}** (${songInfo.duration})`);
        } else {
            await interaction.editReply(`Añadido a la cola: **${songInfo.title}** (${songInfo.duration})`);
        }
    } catch (error) {
        console.error('Error en play:', error);
        await interaction.editReply('Error al reproducir. Verifica la URL o intenta con otro termino.');
    }
}

export async function handlePause(interaction) {
    const queue = queues.get(interaction.guildId);
    if (!queue?.player) {
        return interaction.reply({ content: 'No hay musica reproduciendose.', ephemeral: true });
    }

    if (queue.player.state.status === AudioPlayerStatus.Playing) {
        queue.player.pause();
        await interaction.reply('Musica pausada.');
    } else {
        queue.player.unpause();
        await interaction.reply('Musica reanudada.');
    }
}

export async function handleSkip(interaction) {
    const queue = queues.get(interaction.guildId);
    if (!queue?.songs.length) {
        return interaction.reply({ content: 'No hay canciones en la cola.', ephemeral: true });
    }

    queue.songs.shift();
    if (queue.songs.length) {
        await playSong(queue, interaction.guildId);
        await interaction.reply(`Saltando. Ahora: **${queue.songs[0].title}**`);
    } else {
        queue.player?.stop();
        if (queue.connection) {
            queue.connection.destroy();
            queue.connection = null;
        }
        queue.playing = false;
        await interaction.reply('Cola vacia. Desconectando.');
    }
}

export async function handleStop(interaction) {
    const queue = queues.get(interaction.guildId);
    if (!queue?.connection) {
        return interaction.reply({ content: 'El bot no esta en un canal de voz.', ephemeral: true });
    }

    queue.songs = [];
    queue.player?.stop();
    queue.connection.destroy();
    queue.connection = null;
    queue.playing = false;
    queues.delete(interaction.guildId);

    await interaction.reply('Musica detenida.');
}

export async function handleQueue(interaction) {
    const queue = queues.get(interaction.guildId);
    if (!queue?.songs.length) {
        return interaction.reply({ content: 'La cola esta vacia.', ephemeral: true });
    }

    const list = queue.songs.slice(0, 10).map((s, i) =>
        `${i === 0 ? '[Reproduciendo]' : `${i + 1}.`} **${s.title}** (${s.duration})`
    ).join('\n');

    const more = queue.songs.length > 10 ? `\n... y ${queue.songs.length - 10} mas` : '';
    await interaction.reply(`**Cola de reproduccion:**\n${list}${more}`);
}