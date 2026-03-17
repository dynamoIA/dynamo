import { EmbedBuilder } from 'discord.js';
import { getDB } from '../database/db.js';

export async function handleMemberJoin(member, config) {
    try {
        const db = getDB();

        // Auto-role
        if (config.AUTOROLE_ID && config.AUTOROLE_ID.trim() !== '') {
            await member.roles.add(config.AUTOROLE_ID).catch(() => {});
        }

        // Welcome embed
        const channel = member.guild.channels.cache.get(config.WELCOME_CHANNEL_ID);
        if (channel) {
            const avatarURL = member.user.displayAvatarURL({ size: 256, extension: 'png' });
            const guildIcon = member.guild.iconURL({ extension: 'png' }) ?? undefined;
            const memberCount = member.guild.memberCount;

            const embed = new EmbedBuilder()
                .setColor('#1E90FF')
                .setTitle('¡Bienvenido al servidor!')
                .setDescription(
                    `Hola <@${member.id}>, nos alegra tenerte aquí.\n` +
                    `Eres el miembro número **${memberCount}** de **${member.guild.name}**.`
                )
                .setThumbnail(avatarURL)
                .setFooter({ text: member.guild.name, iconURL: guildIcon })
                .setTimestamp();

            await channel.send({ embeds: [embed] }).catch(() => {});
        }

        // Registrar en BD
        await db.run(
            'INSERT OR IGNORE INTO users (user_id, username) VALUES (?, ?)',
            [member.id, member.user.username]
        );
    } catch (error) {
        console.error('Error en welcome:', error);
    }
}

export async function handleMemberRemove(member, config) {
    try {
        const channel = member.guild.channels.cache.get(config.EXIT_CHANNEL_ID);
        if (!channel) return;

        const avatarURL = member.user.displayAvatarURL({ size: 256, extension: 'png' });
        const guildIcon = member.guild.iconURL({ extension: 'png' }) ?? undefined;

        const embed = new EmbedBuilder()
            .setColor('#FF4444')
            .setTitle('👋 Hasta luego')
            .setDescription(`**@${member.user.username}** ha abandonado el servidor.`)
            .setThumbnail(avatarURL)
            .setFooter({ text: member.guild.name, iconURL: guildIcon })
            .setTimestamp();

        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (error) {
        console.error('Error en goodbye:', error);
    }
}
