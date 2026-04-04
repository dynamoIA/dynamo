import axios from 'axios';
import { EmbedBuilder } from 'discord.js';

const conversationHistory = new Map();
const MAX_HISTORY = 10;

export async function handleIA(message, globalConfig, guildConfig) {
  try {
    // Ignorar bots
    if (message.author.bot) return false;

    // Verificar si es DM o si la IA está habilitada en el servidor
    const isDM = message.channel.isDMBased();
    if (!isDM && guildConfig?.ia_enabled !== 1) return false;

    // Ignorar si no menciona al bot o no es DM
    if (!isDM && !message.mentions.has(message.client.user.id)) return false;

    // Mostrar que está escribiendo
    await message.channel.sendTyping();

    const userId = message.author.id;
    const userName = message.author.username;
    const userTag = message.author.tag;
    const content = message.content
      .replace(`<@${message.client.user.id}>`, '')
      .replace(`<@!${message.client.user.id}>`, '')
      .trim();

    if (!content) {
      return message.reply('Hola ' + userName + ', ¿en qué puedo ayudarte?');
    }

    // Obtener historial de conversación
    const cacheKey = `${message.guildId || 'DM'}:${userId}`;
    let history = conversationHistory.get(cacheKey) || [];

    // Agregar mensaje del usuario al historial
    history.push({
      role: 'user',
      content: `${userName} dice: ${content}`
    });

    // Mantener solo los últimos MAX_HISTORY mensajes
    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
    }

    // Construir prompt del sistema
    const systemPrompt = `Eres un asistente de IA amigable y útil llamado Dynamo. 
Tu objetivo es ayudar a los usuarios de Discord de manera inteligente y conversacional.
El usuario actual es ${userTag} (ID: ${userId}).
Responde siempre en español, de manera natural y concisa.
Sé amable, profesional y útil.
Si no sabes algo, admítelo honestamente.
Máximo 2000 caracteres por respuesta.`;

    // Llamar a la API de OpenAI (o alternativa)
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          ...history
        ],
        temperature: 0.7,
        max_tokens: 500,
        top_p: 0.9
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    ).catch(async (error) => {
      console.error('[IA] Error en API:', error.message);
      return null;
    });

    if (!response || !response.data?.choices?.[0]?.message?.content) {
      return message.reply('Ocurrió un error al procesar tu mensaje. Intenta de nuevo.');
    }

    const aiResponse = response.data.choices[0].message.content.trim();

    // Agregar respuesta de IA al historial
    history.push({
      role: 'assistant',
      content: aiResponse
    });

    // Guardar historial actualizado
    conversationHistory.set(cacheKey, history);

    // Dividir respuesta si es muy larga
    if (aiResponse.length > 2000) {
      const chunks = aiResponse.match(/[\s\S]{1,1990}/g) || [];
      for (const chunk of chunks) {
        await message.reply(chunk).catch(() => {});
      }
    } else {
      await message.reply(aiResponse);
    }

    return true;

  } catch (error) {
    console.error('[IA] Error:', error);
    return message.reply('Ocurrió un error inesperado. Intenta de nuevo.').catch(() => {});
  }
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

// Limpiar historial antiguo cada hora
setInterval(() => {
  conversationHistory.clear();
  console.log('[IA] Historial de conversaciones limpiado.');
}, 60 * 60 * 1000);
