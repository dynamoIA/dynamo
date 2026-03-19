import fs from 'fs';
import {
    Client, GatewayIntentBits, Partials, ActivityType,
    REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder
} from 'discord.js';
import express from 'express';
import { initDB, getDB } from './database/db.js';
import { loadAllGuildConfigs, initGuildConfig, getConfig, setConfig } from './modules/config-manager.js';
import { handleIA } from './modules/ia.js';
import { handleMemberJoin, handleMemberRemove } from './modules/welcome.js';
import { handleTicketCreation } from './modules/tickets.js';
import { handleReaction } from './modules/voting.js';
import { handleLevelup, handleModeration } from './modules/levels.js';
import { handlePlay, handlePause, handleSkip, handleStop, handleQueue } from './modules/music.js';

// Importación de logs
import * as Logs from './modules/logs.js';

const DYNAMO_PATH = './dynamo.sf';

function readConfig(filePath) {
    if (!fs.existsSync(filePath)) return {};
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const config  = {};
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

let globalConfig = { ...process.env, ...readConfig(DYNAMO_PATH) };

// ─── Slash commands ──────────────────────────────────────────────────
const slashCommands = [
    // ── Musica ──
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Reproduce una cancion en el canal de voz')
        .addStringOption(opt => opt.setName('query').setDescription('Nombre o URL de la cancion').setRequired(true)),
    new SlashCommandBuilder().setName('pause').setDescription('Pausa o reanuda la cancion actual'),
    new SlashCommandBuilder().setName('change').setDescription('Cambia a la siguiente cancion en la cola'),
    new SlashCommandBuilder().setName('disconnect').setDescription('Desconecta el bot del canal de voz'),
    new SlashCommandBuilder().setName('queue').setDescription('Muestra la cola de reproduccion'),

    // ── IA ──
    new SlashCommandBuilder()
        .setName('ia')
        .setDescription('Gestiona el asistente de IA')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub.setName('enable').setDescription('Activa el asistente de IA en este servidor'))
        .addSubcommand(sub => sub.setName('disable').setDescription('Desactiva el asistente de IA en este servidor')),

    // ── Config ──
    new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configura Dynamo para este servidor')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('welcome')
            .setDescription('Canal donde se envian los mensajes de bienvenida')
            .addChannelOption(opt => opt.setName('channel').setDescription('Canal de texto').setRequired(true).addChannelTypes(ChannelType.GuildText))
        )
        .addSubcommand(sub => sub
            .setName('exit')
            .setDescription('Canal donde se envian los mensajes de salida')
            .addChannelOption(opt => opt.setName('channel').setDescription('Canal de texto').setRequired(true).addChannelTypes(ChannelType.GuildText))
        )
        .addSubcommand(sub => sub
            .setName('levels')
            .setDescription('Canal donde se anuncian los cambios de nivel')
            .addChannelOption(opt => opt.setName('channel').setDescription('Canal de texto').setRequired(true).addChannelTypes(ChannelType.GuildText))
        )
        .addSubcommand(sub => sub
            .setName('logs')
            .setDescription('Canal donde se registran los eventos del servidor')
            .addChannelOption(opt => opt.setName('channel').setDescription('Canal de texto').setRequired(true).addChannelTypes(ChannelType.GuildText))
        )
        .addSubcommand(sub => sub
            .setName('ticket')
            .setDescription('Canal donde los usuarios abren tickets')
            .addChannelOption(opt => opt.setName('channel').setDescription('Canal de texto').setRequired(true).addChannelTypes(ChannelType.GuildText))
        )
        .addSubcommand(sub => sub
            .setName('ticket-category')
            .setDescription('Categoria donde se crean los canales de ticket')
            .addStringOption(opt => opt.setName('id').setDescription('ID de la categoria de Discord').setRequired(true))
        )
        .addSubcommand(sub => sub
            .setName('ticket-staff')
            .setDescription('Rol de staff que puede gestionar tickets')
            .addRoleOption(opt => opt.setName('rol').setDescription('Rol de staff').setRequired(true))
        )
        .addSubcommand(sub => sub
            .setName('music')
            .setDescription('Canal asociado a la musica (opcional)')
            .addChannelOption(opt => opt.setName('channel').setDescription('Canal de texto').addChannelTypes(ChannelType.GuildText))
        )
        .addSubcommand(sub => sub
            .setName('level-rol')
            .setDescription('Configura un rol que se asigna al alcanzar cierto XP')
            .addRoleOption(opt => opt.setName('rol').setDescription('Rol a asignar').setRequired(true))
            .addIntegerOption(opt => opt.setName('xp').setDescription('XP total requerido para obtener el rol').setRequired(true).setMinValue(1))
        )
        .addSubcommand(sub => sub
            .setName('autorole')
            .setDescription('Rol que se asigna automaticamente al entrar al servidor')
            .addRoleOption(opt => opt.setName('rol').setDescription('Rol').setRequired(true))
        )
        .addSubcommand(sub => sub
            .setName('ver')
            .setDescription('Muestra la configuracion actual de este servidor')
        ),
].map(cmd => cmd.toJSON());

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration
    ],
    partials: [Partials.Channel, Partials.Message, Partials.User, Partials.Reaction]
});

// ─── Web Server (keep-alive) ─────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 5000;
app.get('/', (_req, res) => res.send('Dynamo activo'));
app.listen(PORT, '0.0.0.0', () => console.log(`[OK] Servidor de estado en puerto ${PORT}`));

// ─── Ready ───────────────────────────────────────────────────────────
client.on('ready', async () => {
    console.log(`[OK] Dynamo activo: ${client.user.tag}`);
    client.user.setPresence({
        status: 'online',
        activities: [{ name: globalConfig.STATUS || 'Sloet Froom', type: ActivityType.Watching }]
    });

    await loadAllGuildConfigs(client.guilds.cache);

    try {
        const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
        console.log(`[OK] Slash commands registrados globalmente`);
    } catch (error) {
        console.error('Error registrando slash commands:', error);
    }

    setInterval(() => {
        globalConfig = { ...process.env, ...readConfig(DYNAMO_PATH) };
    }, 30000);
});

// ─── Bot entra a un nuevo servidor ──────────────────────────────────
client.on('guildCreate', async (guild) => {
    console.log(`[OK] Dynamo añadido a: ${guild.name} (${guild.id})`);
    await initGuildConfig(guild.id);
});

// ─── Slash commands handler ──────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
        switch (interaction.commandName) {
            case 'play':       return await handlePlay(interaction);
            case 'pause':      return await handlePause(interaction);
            case 'change':     return await handleSkip(interaction);
            case 'disconnect': return await handleStop(interaction);
            case 'queue':      return await handleQueue(interaction);
            case 'ia':         return await handleIACommand(interaction);
            case 'config':     return await handleConfigCommand(interaction);
        }
    } catch (error) {
        console.error(`Error en /${interaction.commandName}:`, error);
        const msg = { content: 'Ocurrio un error al ejecutar el comando.', ephemeral: true };
        if (interaction.deferred || interaction.replied) interaction.editReply(msg).catch(() => {});
        else interaction.reply(msg).catch(() => {});
    }
});

// ─── /ia handler ────────────────────────────────────────────────────
async function handleIACommand(interaction) {
    try {
        const sub     = interaction.options.getSubcommand();
        const enabled = sub === 'enable' ? 1 : 0;

        console.log(`[DB DEBUG] Guardando IA config: ia_enabled = ${enabled} (Guild: ${interaction.guildId})`);
        
        await setConfig(interaction.guildId, 'ia_enabled', enabled);
        await interaction.reply({
            content: enabled
                ? '✅ Asistente de IA activado en este servidor.'
                : '✅ Asistente de IA desactivado en este servidor.',
            ephemeral: true
        });
    } catch (error) {
        console.error('[DB ERROR] Fallo al guardar IA:', error);
        await interaction.reply({ content: '❌ Error al guardar en la base de datos.', ephemeral: true });
    }
}

// ─── /config handler ────────────────────────────────────────────────
async function handleConfigCommand(interaction) {
    if (!interaction.deferred) await interaction.deferReply({ ephemeral: true });
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (!guildId) return interaction.editReply('❌ Este comando solo funciona dentro de un servidor.');

    try {
        // ── Ver ──
        if (sub === 'ver') {
            const cfg        = await getConfig(guildId);
            const db         = getDB();
            const levelRoles = await db.all(
                'SELECT * FROM level_roles WHERE guild_id = ? ORDER BY xp_required ASC',
                [guildId]
            );
            const lrStr = levelRoles.length
                ? levelRoles.map(lr => `<@&${lr.role_id}> — ${lr.xp_required} XP`).join('\n')
                : 'No configurado';

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('Configuracion de Dynamo')
                .setFooter({ text: interaction.guild.name })
                .addFields(
                    { name: 'Bienvenida',        value: cfg.welcome_channel_id  ? `<#${cfg.welcome_channel_id}>`  : 'No configurado', inline: true },
                    { name: 'Salida',            value: cfg.exit_channel_id     ? `<#${cfg.exit_channel_id}>`     : 'No configurado', inline: true },
                    { name: 'Niveles',           value: cfg.levels_channel_id   ? `<#${cfg.levels_channel_id}>`   : 'No configurado', inline: true },
                    { name: 'Logs',              value: cfg.logs_channel_id     ? `<#${cfg.logs_channel_id}>`     : 'No configurado', inline: true },
                    { name: 'Canal tickets',     value: cfg.ticket_channel_id   ? `<#${cfg.ticket_channel_id}>`   : 'No configurado', inline: true },
                    { name: 'Categoria tickets', value: cfg.ticket_category_id  || 'No configurado',                inline: true },
                    { name: 'Staff tickets',     value: cfg.ticket_staff_roles  ? `<@&${cfg.ticket_staff_roles}>` : 'No configurado', inline: true },
                    { name: 'Musica',            value: cfg.music_channel_id    ? `<#${cfg.music_channel_id}>`    : 'No configurado', inline: true },
                    { name: 'Autorole',          value: cfg.autorole_id         ? `<@&${cfg.autorole_id}>`         : 'No configurado', inline: true },
                    { name: 'IA',                value: cfg.ia_enabled !== 0    ? 'Activa'                        : 'Desactivada',    inline: true },
                    { name: 'Roles de Nivel',    value: lrStr,                                                                        inline: false }
                );
            return interaction.editReply({ embeds: [embed] });
        }

        // ── level-rol ──
        if (sub === 'level-rol') {
            const roleId = interaction.options.getRole('rol').id;
            const xp     = interaction.options.getInteger('xp');
            const db     = getDB();
            
            console.log(`[DB DEBUG] /config level-rol -> Guild: ${guildId}, Role: ${roleId}, XP: ${xp}`);
            
            await db.run(
                'INSERT INTO level_roles (guild_id, role_id, xp_required) VALUES (?, ?, ?) ON CONFLICT(guild_id, role_id) DO UPDATE SET xp_required = excluded.xp_required',
                [guildId, roleId, xp]
            );
            return interaction.editReply(`✅ Rol <@&${roleId}> configurado para **${xp} XP totales**.`);
        }

        // ── music (canal opcional) ──
        if (sub === 'music') {
            const ch = interaction.options.getChannel('channel');
            if (ch) {
                console.log(`[DB DEBUG] /config music -> Guardando music_channel_id: ${ch.id}`);
                await setConfig(guildId, 'music_channel_id', ch.id);
                return interaction.editReply(`✅ Canal de musica configurado: <#${ch.id}>.`);
            }
            return interaction.editReply('Usa `/config music channel:#canal` para configurar el canal de musica.');
        }

        // ── Extracción segura del resto de opciones ──
        let field = null;
        let value = null;

        switch (sub) {
            case 'welcome':         field = 'welcome_channel_id'; value = interaction.options.getChannel('channel')?.id; break;
            case 'exit':            field = 'exit_channel_id';    value = interaction.options.getChannel('channel')?.id; break;
            case 'levels':          field = 'levels_channel_id';  value = interaction.options.getChannel('channel')?.id; break;
            case 'logs':            field = 'logs_channel_id';    value = interaction.options.getChannel('channel')?.id; break;
            case 'ticket':          field = 'ticket_channel_id';  value = interaction.options.getChannel('channel')?.id; break;
            case 'ticket-category': field = 'ticket_category_id'; value = interaction.options.getString('id');         break;
            case 'ticket-staff':    field = 'ticket_staff_roles'; value = interaction.options.getRole('rol')?.id;        break;
            case 'autorole':        field = 'autorole_id';        value = interaction.options.getRole('rol')?.id;        break;
        }

        if (!field) return; // Por si acaso cae fuera de los switch

        if (!value) {
            return interaction.editReply(`❌ Valor no recibido para **${sub}**. Asegúrate de seleccionar la opción correctamente.`);
        }

        console.log(`[DB DEBUG] /config ${sub} -> Campo: '${field}', Valor: '${value}', Guild: '${guildId}'`);

        await setConfig(guildId, field, value);
        await interaction.editReply(`✅ **${sub}** actualizado correctamente.`);

    } catch (error) {
        console.error(`[DB ERROR] Ocurrió un error en /config ${sub}:`, error);
        await interaction.editReply(`❌ Hubo un problema al intentar guardar la configuración en la base de datos.`);
    }
}

// ─── Eventos de miembros (ASINCRONOS PARA DB) ──────────────────────
client.on('guildMemberAdd', async (member) => {
    if (member.user.bot) {
        if (Logs.onNewBot) await Logs.onNewBot(member);
    } else {
        await handleMemberJoin(member);
    }
});
client.on('guildMemberRemove', async (member) => await handleMemberRemove(member));

// ─── Reacciones ──────────────────────────────────────────────────────
client.on('messageReactionAdd', async (reaction, user) => {
    if (reaction.partial) await reaction.fetch();
    const config = await getConfig(reaction.message.guildId);
    handleReaction(reaction, user, config);
});

// ─── Mensajes ────────────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const isDM           = message.channel.isDMBased();
    if (!isDM && !message.guild) return;
    const guildConfig  = isDM ? null : await getConfig(message.guild.id);

    try {
        if (!isDM && await handleTicketCreation(message)) return;
        if (await handleIA(message, globalConfig, guildConfig)) return;

        if (message.guild) {
            await handleLevelup(message, guildConfig);
            await handleModeration(message, guildConfig);
        }
    } catch (error) {
        console.error('Error procesando mensaje:', error);
    }
});

// ─── Sistema de Logs Protegido ──────────────────────────────────────────
client.on('channelCreate',     (ch)      => Logs.onChannelCreate?.(ch).catch(err => console.error('Error en logs channelCreate:', err)));
client.on('channelDelete',     (ch)      => Logs.onChannelDelete?.(ch).catch(err => console.error('Error en logs channelDelete:', err)));
client.on('channelUpdate',     (old, nw) => Logs.onChannelUpdate?.(old, nw).catch(err => console.error('Error en logs channelUpdate:', err)));
client.on('roleCreate',        (role)    => Logs.onRoleCreate?.(role).catch(err => console.error('Error en logs roleCreate:', err)));
client.on('roleDelete',        (role)    => Logs.onRoleDelete?.(role).catch(err => console.error('Error en logs roleDelete:', err)));
client.on('roleUpdate',        (old, nw) => Logs.onRoleUpdate?.(old, nw).catch(err => console.error('Error en logs roleUpdate:', err)));
client.on('guildUpdate',       (old, nw) => Logs.onGuildUpdate?.(old, nw).catch(err => console.error('Error en logs guildUpdate:', err)));
client.on('guildMemberUpdate', (old, nw) => Logs.onGuildMemberUpdate?.(old, nw).catch(err => console.error('Error en logs guildMemberUpdate:', err)));
client.on('guildBanAdd',       (ban)     => Logs.onGuildBanAdd?.(ban).catch(err => console.error('Error en logs guildBanAdd:', err)));
client.on('messageDelete',     (msg)     => Logs.onMessageDelete?.(msg).catch(err => console.error('Error en logs messageDelete:', err)));

// ─── Inicio ───────────────────────────────────────────────────────────
(async () => {
    try {
        await initDB();
        await client.login(process.env.BOT_TOKEN);
    } catch (err) {
        console.error('Fallo crítico al iniciar el bot:', err);
    }
})();
