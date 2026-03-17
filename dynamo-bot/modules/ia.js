const conversations  = new Map(); // userId -> messages[]
const userRateLimit  = new Map(); // userId -> { count, cooldownUntil }

function getGroqKeys(config) {
    return String(config.GROQ_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
}

function canSend(userId) {
    const data = userRateLimit.get(userId) || { count: 0, cooldownUntil: 0 };
    const now  = Date.now();
    if (data.cooldownUntil > now) {
        return { allowed: false, minutesLeft: Math.ceil((data.cooldownUntil - now) / 60000) };
    }
    return { allowed: true };
}

function recordMessage(userId) {
    const data     = userRateLimit.get(userId) || { count: 0, cooldownUntil: 0 };
    const now      = Date.now();
    const newCount = data.count + 1;
    if (newCount >= 20) {
        userRateLimit.set(userId, { count: 0, cooldownUntil: now + 15 * 60 * 1000 });
    } else {
        userRateLimit.set(userId, { count: newCount, cooldownUntil: 0 });
    }
}

export async function handleIA(message, globalConfig, guildConfig) {
    const isDM        = message.channel.isDMBased();
    const isMentioned = message.mentions.has(message.client.user);

    if (!isDM) {
        const iaEnabled = guildConfig?.ia_enabled;
        if (iaEnabled === 0) return false;
        if (!isMentioned) return false;
    }

    const keys = getGroqKeys(globalConfig);
    if (!keys.length) return false;

    const rateCheck = canSend(message.author.id);
    if (!rateCheck.allowed) {
        await message.reply(
            `El asistente de IA estara disponible en **${rateCheck.minutesLeft} minuto(s)**. Por favor espera.`
        ).catch(() => {});
        return true;
    }

    const userId  = message.author.id;
    const history = conversations.get(userId) || [];
    conversations.set(userId, history);

    const userContent = message.content.replace(/<@!?\d+>/g, '').trim();
    if (!userContent) return false;

    history.push({ role: 'user', content: userContent });
    if (history.length > 20) history.splice(0, 2);

    const systemPrompt = globalConfig.KNOWLEDGE || 'Te llamas Dynamo, un bot de Discord de Sloet Games.';

    let lastError;
    for (const key of keys) {
        try {
            await message.channel.sendTyping();

            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...history
                    ],
                    max_tokens: 1024
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error?.message || 'Groq API error');
            }

            const data  = await response.json();
            const reply = data.choices[0].message.content;

            history.push({ role: 'assistant', content: reply });
            recordMessage(userId);

            const chunks = reply.match(/[\s\S]{1,2000}/g) || [reply];
            for (const chunk of chunks) {
                await message.reply(chunk);
            }

            return true;
        } catch (error) {
            lastError = error;
            console.error(`Error con key Groq: ${error.message}`);
        }
    }

    console.error('Todas las keys de Groq fallaron:', lastError?.message);
    await message.reply('Error al conectar con el sistema de IA. Intenta de nuevo.').catch(() => {});
    return true;
}
