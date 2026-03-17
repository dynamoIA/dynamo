import { EmbedBuilder } from 'discord.js';

export async function handleReaction(reaction, user, config) {
    if (user.bot) return;

    const voteChannelId = String(config.VOTE_CHANNEL_ID || '').trim();
    const targetChannelId = String(config.VOTE_TARGET_CHANNEL_ID || '').trim();
    const threshold = parseInt(config.VOTE_THRESHOLD) || 10;

    if (!voteChannelId || !targetChannelId) return;
    if (reaction.message.channelId !== voteChannelId) return;

    if (reaction.partial) {
        try { await reaction.fetch(); } catch { return; }
    }

    const upvotes = reaction.message.reactions.cache.get('👍');
    const count = upvotes?.count || 0;

    if (count < threshold) return;

    try {
        const guild = reaction.message.guild;
        const targetChannel = guild?.channels.cache.get(targetChannelId);
        if (!targetChannel) return;

        const recentMessages = await targetChannel.messages.fetch({ limit: 20 });
        const alreadyForwarded = recentMessages.some(m =>
            m.embeds[0]?.footer?.text?.includes(reaction.message.id)
        );
        if (alreadyForwarded) return;

        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('Mensaje Destacado')
            .setDescription(reaction.message.content || '*(Sin texto)*')
            .setAuthor({
                name: reaction.message.author.username,
                iconURL: reaction.message.author.displayAvatarURL()
            })
            .addFields({ name: 'Votos', value: `${count}`, inline: true })
            .setFooter({ text: `ID: ${reaction.message.id}` })
            .setTimestamp();

        await targetChannel.send({ embeds: [embed] });
    } catch (error) {
        console.error('Error en voting:', error);
    }
}
