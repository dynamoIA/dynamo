import { getDB } from '../database/db.js';

// ─── Diccionario de idiomas ───────────────────────────────────────────
const translations = {
  es: {
    // Música
    music_must_be_in_voice: 'Debes estar en un canal de voz para usar este comando.',
    music_no_results: 'No se encontraron resultados para tu búsqueda.',
    music_playing_now: 'Reproduciendo ahora',
    music_added_to_queue: 'Añadido a la cola',
    music_paused: 'Música pausada.',
    music_resumed: 'Música reanudada.',
    music_skipped: 'Canción saltada.',
    music_stopped: 'Reproducción detenida.',
    music_queue_empty: 'La cola está vacía.',

    // Niveles
    level_no_data: 'No tienes datos de XP en este servidor aún.',
    level_up: 'Nivel Subido',
    level_progress: 'Progreso de Nivel',
    level_xp_total: 'XP Total Acumulado',
    level_next_level: 'Siguiente Objetivo',
    level_unlocked_roles: 'Roles Desbloqueados',

    // Moderación
    mod_ban_success: 'Usuario baneado correctamente.',
    mod_kick_success: 'Usuario expulsado correctamente.',
    mod_mute_success: 'Usuario silenciado correctamente.',
    mod_unmute_success: 'Usuario dessilenciado correctamente.',
    mod_warn_success: 'Advertencia registrada.',
    mod_clear_success: 'Mensajes eliminados.',
    mod_no_permission: 'No tienes permisos para usar este comando.',

    // IA
    ia_hello: 'Hola',
    ia_thinking: 'Pensando...',
    ia_error: 'Ocurrió un error al procesar tu mensaje.',

    // Idioma
    language_set: 'Idioma establecido a **Español** correctamente.',
    language_invalid: 'Idioma no válido. Usa `es` o `en`.',
  },
  en: {
    // Music
    music_must_be_in_voice: 'You must be in a voice channel to use this command.',
    music_no_results: 'No results found for your search.',
    music_playing_now: 'Playing now',
    music_added_to_queue: 'Added to queue',
    music_paused: 'Music paused.',
    music_resumed: 'Music resumed.',
    music_skipped: 'Song skipped.',
    music_stopped: 'Playback stopped.',
    music_queue_empty: 'The queue is empty.',

    // Levels
    level_no_data: 'You have no XP data on this server yet.',
    level_up: 'Level Up',
    level_progress: 'Level Progress',
    level_xp_total: 'Total XP Accumulated',
    level_next_level: 'Next Goal',
    level_unlocked_roles: 'Unlocked Roles',

    // Moderation
    mod_ban_success: 'User banned successfully.',
    mod_kick_success: 'User kicked successfully.',
    mod_mute_success: 'User muted successfully.',
    mod_unmute_success: 'User unmuted successfully.',
    mod_warn_success: 'Warning recorded.',
    mod_clear_success: 'Messages deleted.',
    mod_no_permission: 'You do not have permission to use this command.',

    // AI
    ia_hello: 'Hello',
    ia_thinking: 'Thinking...',
    ia_error: 'An error occurred while processing your message.',

    // Language
    language_set: 'Language set to **English** successfully.',
    language_invalid: 'Invalid language. Use `es` or `en`.',
  }
};

// ─── Cache en memoria para evitar consultas repetidas a la DB ─────────
const languageCache = new Map();

/**
 * Obtiene el idioma preferido de un usuario en un servidor.
 * Consulta la DB y cachea el resultado. Por defecto devuelve 'es'.
 * @param {string} userId
 * @param {string} guildId
 * @returns {Promise<string>} Código de idioma ('es' | 'en')
 */
export async function getLanguage(userId, guildId) {
  const cacheKey = `${userId}:${guildId}`;
  if (languageCache.has(cacheKey)) return languageCache.get(cacheKey);

  try {
    const db = getDB();
    const row = await db.oneOrNone(
      'SELECT language FROM user_languages WHERE user_id = $1 AND guild_id = $2',
      [userId, guildId]
    );
    const lang = row?.language ?? 'es';
    languageCache.set(cacheKey, lang);
    return lang;
  } catch {
    return 'es';
  }
}

/**
 * Guarda el idioma preferido de un usuario en la DB y actualiza la caché.
 * @param {string} userId
 * @param {string} guildId
 * @param {string} language  'es' | 'en'
 */
export async function setUserLanguage(userId, guildId, language) {
  const db = getDB();
  await db.none(
    `INSERT INTO user_languages (user_id, guild_id, language)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, guild_id) DO UPDATE SET language = excluded.language`,
    [userId, guildId, language]
  );
  languageCache.set(`${userId}:${guildId}`, language);
}

/**
 * Traduce una clave al idioma indicado.
 * Si la clave no existe en ese idioma cae al español; si tampoco existe devuelve la clave.
 * @param {string} key
 * @param {string} [lang='es']
 * @returns {string}
 */
export function t(key, lang = 'es') {
  return translations[lang]?.[key] ?? translations['es'][key] ?? key;
}
