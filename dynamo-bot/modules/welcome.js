import { EmbedBuilder } from 'discord.js';
import { getDB } from '../database/db.js';
import { getConfig } from './config-manager.js';

export function handleMemberJoin(member) {
    const config = getConfig(member.guild.id);

    if (config.autorole_id) {
        member.roles.add(config.autorole_id).catch(err =>
            console.error(`[${member.guild.name}] Error asignando autorole:`, err.message)
        );
    }

    if (config.welcome_channel_id) {
        const channel = member.guild.channels.cache.get(config.welcome_channel_id);
        if (channel) {
            const embed = new EmbedBuilder()
                .setColor('#1E90FF')
                .setTitle('Bienvenido al servidor')
                .setDescription(
                    `Hola <@${member.id}>, nos alegra tenerte aqui.\n` +
                    `Eres el miembro numero **${member.guild.memberCount}** de **${member.guild.name}**.`
                )
                .setThumbnail(member.user.displayAvatarURL({ size: 256, extension: 'png' }))
                .setFooter({
                    text: member.guild.name,
                    iconURL: member.guild.iconURL({ extension: 'png' }) ?? undefined
                })
                .setTimestamp();

            channel.send({ embeds: [embed] }).catch(err =>
                console.error(`[${member.guild.name}] Error enviando welcome:`, err.message)
            );
        }
    }

    const db = getDB();
    db.run(
        'INSERT OR IGNORE INTO users (user_id, guild_id, username) VALUES (?, ?, ?)',
        [member.id, member.guild.id, member.user.username]
    ).catch(err => console.error('Error registrando usuario:', err.message));
}

export function handleMemberRemove(member) {
    const config = getConfig(member.guild.id);

    if (!config.exit_channel_id) return;

    const channel = member.guild.channels.cache.get(config.exit_channel_id);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setColor('#FF4444')
        .setTitle('Hasta luego')
        .setDescription(`**@${member.user.username}** ha abandonado el servidor.`)
        .setThumbnail(member.user.displayAvatarURL({ size: 256, extension: 'png' }))
        .setFooter({
            text: member.guild.name,
            iconURL: member.guild.iconURL({ extension: 'png' }) ?? undefined
        })
        .setTimestamp();

    channel.send({ embeds: [embed] }).catch(err =>
        console.error(`[${member.guild.name}] Error enviando goodbye:`, err.message)
    );
}
