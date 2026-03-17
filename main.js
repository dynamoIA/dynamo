import fs from 'fs';
import { Client, GatewayIntentBits, Partials, ActivityType, REST, Routes, SlashCommandBuilder } from 'discord.js';
import * as dotenv from 'dotenv';
import express from 'express';
import { initDB } from './database/db.js';
import { handleIA } from './modules/ia.js';
import { handleMemberJoin, handleMemberRemove } from './modules/welcome.js';
import { handleTicketCreation } from './modules/tickets.js';
import { handleReaction } from './modules/voting.js';
import { handleLevelup, handleModeration } from './modules/levels.js';
import { handlePlay, handlePause, handleSkip, handleStop, handleQueue } from './modules/music.js';

const ENV_PATH = 'sloet.env';
const DYNAMO_PATH = 'dynamo.sf';
dotenv.config({ path: ENV_PATH });

function readConfig(filePath) {
    if (!fs.existsSync(filePath)) return {};
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const config = {};
        content.split('\n').forEach(line => {
            const parts = line.split('=');
            if (parts.length >= 2 && !line.startsWith('#')) {
                const key = parts[0].trim();
                const val = parts.slice(1).join('=').trim().replace(/^"|"$/g, '');
                config[key] = val;
            }
        });
        return config;
    } catch (e) {
        console.error('Error leyendo config:', e);
        return {};
    }
}

function buildConfig() {
    const envConfig = readConfig(ENV_PATH);
    const dynamoConfig = readConfig(DYNAMO_PATH);
    return { ...envConfig, ...dynamoConfig };
}

let config = buildConfig();

// ─── Slash commands definidos ───────────────────────────────────────
const slashCommands = [
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Reproduce una canción en el canal de voz')
        .addStringOption(opt =>
            opt.setName('query')
               .setDescription('Nombre o URL de la canción')
               .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pausa o reanuda la canción actual'),
    new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Salta a la siguiente canción de la cola'),
    new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Detiene la música y desconecta al bot del canal de voz'),
    new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Muestra la cola de reproducción actual'),
].map(cmd => cmd.toJSON());

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User, Partials.Reaction]
});

// Web Server
const app = express();
app.get('/', (req, res) => res.send('Dynamo activo'));
app.listen(5000, '0.0.0.0', () => console.log('✅ Servidor en puerto 5000'));

client.on('ready', async () => {
    console.log(`✅ Dynamo activo: ${client.user.tag}`);
    client.user.setActivity(config.STATUS || 'Sloet Froom', { type: ActivityType.Watching });

    // Registrar slash commands en todos los servidores
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
        for (const guild of client.guilds.cache.values()) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guild.id),
                { body: slashCommands }
            );
        }
        console.log(`✅ Slash commands registrados en ${client.guilds.cache.size} servidor(es)`);
    } catch (error) {
        console.error('Error registrando slash commands:', error);
    }

    setInterval(() => {
        config = buildConfig();
    }, 30000);
});

// ─── Slash commands ────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
        switch (interaction.commandName) {
            case 'play':   await handlePlay(interaction);  break;
            case 'pause':  await handlePause(interaction); break;
            case 'skip':   await handleSkip(interaction);  break;
            case 'stop':   await handleStop(interaction);  break;
            case 'queue':  await handleQueue(interaction); break;
        }
    } catch (error) {
        console.error(`Error en comando /${interaction.commandName}:`, error);
        const msg = { content: '❌ Ocurrió un error al ejecutar el comando.', ephemeral: true };
        if (interaction.deferred) interaction.editReply(msg).catch(() => {});
        else interaction.reply(msg).catch(() => {});
    }
});

// ─── Eventos del servidor ──────────────────────────────────────────
client.on('guildMemberAdd', (member) => {
    handleMemberJoin(member, config);
});

client.on('guildMemberRemove', (member) => {
    handleMemberRemove(member, config);
});

client.on('messageReactionAdd', (reaction, user) => {
    handleReaction(reaction, user, config);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild && !message.channel.isDMBased()) return;

    try {
        if (await handleTicketCreation(message, config)) return;
        if (await handleIA(message, config)) return;

        if (message.guild) {
            await handleLevelup(message, config);
            await handleModeration(message, config);
        }
    } catch (error) {
        console.error('Error procesando mensaje:', error);
    }
});

(async () => {
    await initDB();
    client.login(process.env.BOT_TOKEN);
})();
