import { getDB } from '../database/db.js';
import { PermissionFlagsBits } from 'discord.js';

const conversations = new Map(); // userId -> mensajes en memoria
const userUsage = new Map(); // ID (User o Guild) -> { count, cooldownUntil }

// ---------------------------------------------------------
// 🔹 CONFIGURACIÓN DE LÍMITES (MODIFICA AQUÍ)
// ---------------------------------------------------------
const LIMIT_DMS = 10;        
const LIMIT_SERVER = 20;     
const COOLDOWN_MINUTES = 5;  
const MAX_CONTENT_LENGTH = 500; // 🔹 Punto 6: Máximo de caracteres por mensaje
// ---------------------------------------------------------

function getGroqKeys(config) {
  const raw = config.GROQ_KEYS || config.GROQ_KEY || '';
  return String(raw).split(',').map(k => k.trim()).filter(Boolean);
}

function formatTimeRemaining(milliseconds) {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function checkSpam(id, limit) {
  const now = Date.now();
  const data = userUsage.get(id) || { count: 0, cooldownUntil: 0 };
  if (data.cooldownUntil > now) {
    const timeRemaining = data.cooldownUntil - now;
    return { allowed: false, timeRemaining };
  }
  if (data.count >= limit) {
    userUsage.set(id, { count: 0, cooldownUntil: now + (COOLDOWN_MINUTES * 60 * 1000) });
    return { allowed: false, timeRemaining: COOLDOWN_MINUTES * 60 * 1000 };
  }
  return { allowed: true };
}

function recordUsage(id) {
  const data = userUsage.get(id) || { count: 0, cooldownUntil: 0 };
  userUsage.set(id, { ...data, count: data.count + 1 });
}

export async function handleIA(message, globalConfig, guildConfig) {
  if (message.author.bot) return false;

  // 🔹 Punto 1: Validar permisos antes de procesar nada
  if (message.guild && !message.guild.members.me.permissionsIn(message.channel).has(PermissionFlagsBits.SendMessages)) {
    return false;
  }

  const isDM = message.channel.isDMBased();
  const isMentioned = message.mentions.has(message.client.user);
  const userId = message.author.id;
  const limitId = isDM ? userId : message.guildId;

  if (!isDM) {
    if (!guildConfig?.ia_enabled || !isMentioned) return false;
  }

  // 🔹 Punto 5: Filtrar mensajes inútiles (< 3 caracteres)
  const userContent = message.content.replace(/<@!?\d+>/g, '').trim();
  if (userContent.length < 3) return false;

  // 🔹 Punto 6: Limitar longitud de mensajes (> 500 caracteres)
  if (userContent.length > MAX_CONTENT_LENGTH) {
    await message.reply(`Tu mensaje es muy largo. El máximo permitido es de ${MAX_CONTENT_LENGTH} caracteres.`).catch(() => {});
    return true;
  }

  const keys = getGroqKeys(globalConfig);
  if (!keys.length) return false;

  const currentLimit = isDM ? LIMIT_DMS : LIMIT_SERVER;
  const spamCheck = checkSpam(limitId, currentLimit);

  if (!spamCheck.allowed) {
    const timeRemaining = formatTimeRemaining(spamCheck.timeRemaining);
    const msg = isDM 
      ? `Has consumido el límite del plan Free. Espera ${timeRemaining} para continuar el chat.`
      : `Se ha consumido el límite de mensajes en este servidor. Espera ${timeRemaining} para continuar.`;
    await message.reply(msg).catch(() => {});
    return true;
  }

  // 🔹 Punto 4: Registrar uso ANTES del fetch (Protección preventiva)
  recordUsage(limitId);

  const history = conversations.get(userId) || [];
  history.push({ role: 'user', content: userContent });
  if (history.length > 10) history.splice(0, 2);
  conversations.set(userId, history);

  const systemPrompt = globalConfig.KNOWLEDGE || 'Te llamas Dynamo, una inteligencia artificial desarrollada por la compañía Sloet Froom™, basada en el modelo LLaMA 3.1 8B; solo puedes generar texto y debes utilizar pocos emojis. Como modelo de IA, tienes límites de uso: 10 mensajes en DMs y 25 mensajes por servidor, los cuales se restablecen cada 5 minutos. Asistes como soporte y compañero del usuario, ofreciendo ayuda clara y útil. Bajo ninguna circunstancia debes compartir datos de mensajes privados (DMs) del usuario en servidores públicos ni con otros usuarios.';

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
          // 🔹 Punto 2: Modelo económico llama-3.1-8b-instant
          model: 'llama-3.1-8b-instant', 
          messages: [ { role: 'system', content: systemPrompt }, ...history ],
          // 🔹 Punto 3: Reducir límite de tokens a 300
          max_tokens: 300, 
          temperature: 0.7 
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || 'Groq API error');
      }

      const data = await response.json();
      const reply = data.choices[0]?.message?.content;
      if (!reply) throw new Error('Respuesta vacía');

      history.push({ role: 'assistant', content: reply });

      // Guardar en DB (Postgres) - CORREGIDO CON guild_id
      const db = getDB();
      const guildId = message.guildId || 'DM';
      
      await db.none(
        `INSERT INTO users (user_id, guild_id, username) VALUES ($1, $2, $3) 
         ON CONFLICT (user_id, guild_id) DO UPDATE SET username = $3`,
        [userId, guildId, message.author.username]
      ).catch(err => console.error("Error DB:", err));

      const chunks = reply.match(/[\s\S]{1,2000}/g) || [reply];
      for (const chunk of chunks) {
        await message.reply(chunk).catch(() => {});
      }

      return true;
    } catch (error) {
      lastError = error;
      console.error(`Error key: ${error.message}`);
    }
  }

  await message.reply('Error al conectar con el sistema de IA. Intenta de nuevo.').catch(() => {});
  return true;
}
