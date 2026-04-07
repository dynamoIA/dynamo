import { getDB } from '../database/db.js';
import { PermissionFlagsBits } from 'discord.js';

const conversations = new Map();
const userUsage = new Map();

const LIMIT_DMS = 20;
const LIMIT_SERVER = 30;
const COOLDOWN_MINUTES = 2;
const MAX_CONTENT_LENGTH = 1000;

function getGroqKeys(config) {
  const raw = config.GROQ_KEYS || config.GROQ_KEY || '';
  const keys = String(raw).split(',').map(k => k.trim()).filter(Boolean);
  if (keys.length === 0) {
    console.warn('[IA] ADVERTENCIA: No se encontraron GROQ_KEYS en variables de entorno');
  }
  return keys;
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

  const isDM = message.channel.isDMBased();
  const isMentioned = message.mentions.has(message.client.user);

  console.log(`[IA] Mensaje recibido - DM: ${isDM}, Mencionado: ${isMentioned}, Usuario: ${message.author.username}`);

  // Validar permisos
  if (message.guild && !message.guild.members.me.permissionsIn(message.channel).has(PermissionFlagsBits.SendMessages)) {
    console.log('[IA] Sin permisos para responder en este canal');
    return false;
  }

  const userId = message.author.id;
  const userName = message.author.username;
  const userTag = message.author.tag;
  const limitId = isDM ? userId : message.guildId;

  // Validar si debe responder
  if (!isDM) {
    if (!guildConfig?.ia_enabled || !isMentioned) {
      console.log(`[IA] No responde - IA habilitada: ${guildConfig?.ia_enabled}, Mencionado: ${isMentioned}`);
      return false;
    }
  }

  // Filtrar mensajes inútiles
  const userContent = message.content.replace(/<@!?\d+>/g, '').trim();
  if (userContent.length < 3) {
    console.log('[IA] Mensaje muy corto, ignorando');
    return false;
  }

  // Limitar longitud
  if (userContent.length > MAX_CONTENT_LENGTH) {
    await message.reply(`Tu mensaje es muy largo. Máximo ${MAX_CONTENT_LENGTH} caracteres.`).catch(() => {});
    return true;
  }

  const keys = getGroqKeys(globalConfig);
  if (!keys.length) {
    console.error('[IA] ERROR: No hay claves de Groq configuradas. Agrega GROQ_KEYS a las variables de entorno.');
    return false;
  }

  console.log(`[IA] Procesando mensaje de ${userName} (${isDM ? 'DM' : 'Servidor'})`);

  const currentLimit = isDM ? LIMIT_DMS : LIMIT_SERVER;
  const spamCheck = checkSpam(limitId, currentLimit);

  if (!spamCheck.allowed) {
    const timeRemaining = formatTimeRemaining(spamCheck.timeRemaining);
    const msg = isDM
      ? `Has alcanzado tu límite de mensajes. Por favor espera ${timeRemaining} para continuar.`
      : `Se alcanzó el límite de mensajes en este servidor. Por favor espera ${timeRemaining} para continuar.`;
    await message.reply(msg).catch(() => {});
    return true;
  }

  recordUsage(limitId);

  const history = conversations.get(userId) || [];
  history.push({ role: 'user', content: `${userName} (ID: ${userId}) dice: ${userContent}` });
  if (history.length > 10) history.splice(0, 2);
  conversations.set(userId, history);

  const systemPrompt = `Eres Dynamo, un asistente de IA amigable y útil en Discord.
El usuario actual es ${userTag} (ID: ${userId}).
Responde siempre en español, de manera natural y concisa.
Sé amable, profesional y útil.
Si no sabes algo, admítelo honestamente.
Máximo 2000 caracteres por respuesta.
No compartas datos privados de usuarios.`;

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
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'system', content: systemPrompt }, ...history],
          max_tokens: 500,
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

      // Guardar en DB
      const db = getDB();
      const guildId = message.guildId || 'DM';

      await db.none(
        `INSERT INTO users (user_id, guild_id, username) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, guild_id) DO UPDATE SET username = $3`,
        [userId, guildId, message.author.username]
      ).catch(err => console.error('[IA] Error DB:', err));

      const chunks = reply.match(/[\s\S]{1,2000}/g) || [reply];
      for (const chunk of chunks) {
        await message.reply(chunk).catch(() => {});
      }

      return true;
    } catch (error) {
      lastError = error;
      console.error(`[IA] Error con key: ${error.message}`);
    }
  }

  await message.reply('Error al conectar con el sistema de IA. Intenta de nuevo.').catch(() => {});
  return true;
}

export async function handleIACommand(interaction) {
  try {
    const sub = interaction.options.getSubcommand();
    const enabled = sub === 'enable' ? 1 : 0;

    console.log(`[IA] Guardando IA config: ia_enabled = ${enabled} (Guild: ${interaction.guildId})`);

    const { setConfig } = await import('./config-manager.js');
    await setConfig(interaction.guildId, 'ia_enabled', enabled);

    await interaction.reply({
      content: enabled
        ? 'Asistente de IA activado en este servidor.'
        : 'Asistente de IA desactivado en este servidor.',
      ephemeral: true
    });
  } catch (error) {
    console.error('[IA] Error en handleIACommand:', error);
    await interaction.reply({
      content: 'Ocurrió un error al cambiar la configuración de IA.',
      ephemeral: true
    });
  }
}

// Limpiar historial cada hora
setInterval(() => {
  conversations.clear();
  console.log('[IA] Historial de conversaciones limpiado.');
}, 60 * 60 * 1000);
