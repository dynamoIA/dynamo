import pgPromise from 'pg-promise';

// Inicializamos pg-promise
const pgp = pgPromise();

// Usamos la URL que te da Railway en sus Variables de Entorno
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ ERROR CRÍTICO: No se encontró process.env.DATABASE_URL. Revisa las variables de entorno en Railway.");
}

// Creamos la conexión a la base de datos
let db;
if (connectionString) {
  db = pgp(connectionString);
}

export async function initDB() {
  try {
    // En pg-promise usamos .none para ejecutar código sin esperar resultados de vuelta
    await db.none(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        username TEXT,
        level INTEGER DEFAULT 0,
        xp INTEGER DEFAULT 0,
        total_xp INTEGER DEFAULT 0,
        warnings INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, guild_id)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_unique ON users(user_id, guild_id);

      CREATE TABLE IF NOT EXISTS guild_configs (
        guild_id TEXT PRIMARY KEY,
        welcome_channel_id TEXT,
        exit_channel_id TEXT,
        autorole_id TEXT,
        ticket_category_id TEXT,
        ticket_channel_id TEXT,
        ticket_staff_roles TEXT,
        mod_role_id TEXT,
        logs_channel_id TEXT,
        levels_channel_id TEXT,
        music_channel_id TEXT,
        ia_enabled INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS level_roles (
        guild_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        xp_required INTEGER NOT NULL,
        PRIMARY KEY (guild_id, role_id)
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        user_id TEXT,
        guild_id TEXT,
        channel_id TEXT,
        reason TEXT,
        status TEXT DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS logs (
        id SERIAL PRIMARY KEY,
        guild_id TEXT,
        action TEXT,
        user_id TEXT,
        target_id TEXT,
        details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_languages (
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        language TEXT DEFAULT 'es',
        PRIMARY KEY (user_id, guild_id)
      );
    `);
    
    console.log('✅ Base de datos PostgreSQL inicializada y conectada.');
    return db;
  } catch (error) {
    console.error('❌ Error al conectar o crear tablas en PostgreSQL:', error.message);
  }
}

export function getDB() {
  if (!db) {
    throw new Error("La base de datos no está inicializada. Asegúrate de llamar a initDB() primero.");
  }
  return db;
}
