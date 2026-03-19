import { getDB } from '../database/db.js';

const conversations  = new Map(); // userId -> mensajes en memoria
const userUsage      = new Map(); // ID (User o Guild) -> { count, cooldownUntil }

// ---------------------------------------------------------
// 🔹 CONFIGURACIÓN DE LÍMITES (MODIFICA AQUÍ)
// ---------------------------------------------------------
const LIMIT_DMS = 10;        // Cantidad de mensajes permitidos en DM
const LIMIT_SERVER = 20;     // Cantidad de mensajes permitidos en Servidores
const COOLDOWN_MINUTES = 5;  // Tiempo de espera en minutos
// ---------------------------------------------------------

function getGroqKeys(config) {
    const raw = config.GROQ_KEYS || config.GROQ_KEY || '';
    return String(raw).split(',').map(k => k.trim()).filter(Boolean);
}

// Nueva lógica de control de spam
function checkSpam(id, limit) {
    const now = Date.now();
    const data = userUsage.get(id) || { count: 0, cooldownUntil: 0 };

    if (data.cooldownUntil > now) return { allowed: false };

    if (data.count >= limit) {
        userUsage.set(id, { count: 0, cooldownUntil: now + (COOLDOWN_MINUTES * 60 * 1000) });
        return { allowed: false };
    }
    return { allowed: true };
}

function recordUsage(id) {
    const data = userUsage.get(id) || { count: 0, cooldownUntil: 0 };
    userUsage.set(id, { ...data, count: data.count + 1 });
}

export async function handleIA(message, globalConfig, guildConfig) {
    if (message.author.bot) return false;

    const isDM        = message.channel.isDMBased();
    const isMentioned = message.mentions.has(message.client.user);
    const userId      = message.author.id;
    
    // Identificador para el límite: User ID en DM, Guild ID en Servidores
    const limitId     = isDM ? userId : message.guildId;

    if (!isDM) {
        const iaEnabled = guildConfig?.ia_enabled;
        if (!iaEnabled) return false; 
        if (!isMentioned) return false;
    }

    const keys = getGroqKeys(globalConfig);
    if (!keys.length) return false;

    // 🔹 VALIDACIÓN DE LÍMITES
    const currentLimit = isDM ? LIMIT_DMS : LIMIT_SERVER;
    const spamCheck = checkSpam(limitId, currentLimit);

    if (!spamCheck.allowed) {
        if (isDM) {
            await message.reply(`Has consumido el límite del plan Free, espere ${COOLDOWN_MINUTES} Minutos para continuar el chat.`).catch(() => {});
        } else {
            await message.reply(`Se a consumido el límite de mensajes en este servidor, espere ${COOLDOWN_MINUTES} Minutos.`).catch(() => {});
        }
        return true;
    }

    const history = conversations.get(userId) || [];
    conversations.set(userId, history);

    const userContent = message.content.replace(/<@!?\d+>/g, '').trim();
    if (!userContent) return false;

    history.push({ role: 'user', content: userContent });
    if (history.length > 10) history.splice(0, 2);

    const systemPrompt = globalConfig.KNOWLEDGE || 'Te llamas Dynamo, un Bot de Discord desarrollado por Sloet Froom ™. Respondes de forma técnica, precisa y sin usar emojis.';

    let lastError;
    for (const key of keys) {
        try {
            await message.channel.sendTyping().catch(() => {});

            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [ { role: 'system', content: systemPrompt }, ...history ],
                    max_tokens: 1024,
                    temperature: 0.7 
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error?.message || 'Groq API error');
            }

            const data  = await response.json();
            const reply = data.choices[0]?.message?.content;
            if (!reply) throw new Error('Respuesta vacía de Groq');

            history.push({ role: 'assistant', content: reply });
            
            // 🔹 REGISTRAMOS EL USO Y GUARDAMOS EN DB
            recordUsage(limitId);

            const db = getDB();
            await db.none(
                `INSERT INTO users (user_id, username) 
                 VALUES ($1, $2) 
                 ON CONFLICT (user_id) 
                 DO UPDATE SET username = $2`,
                [userId, message.author.username]
            ).catch(err => console.error("Error al guardar en DB:", err));

            const chunks = reply.match(/[\s\S]{1,2000}/g) || [reply];
            for (const chunk of chunks) {
                await message.reply(chunk).catch(() => {});
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
