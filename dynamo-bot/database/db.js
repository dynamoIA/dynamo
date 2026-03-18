// database/db.js
import pgPromise from 'pg-promise';

const pgp = pgPromise();

// Configuración ajustada para Railway (producción) y Local (desarrollo)
const connectionConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }, // Fundamental para que Railway no bloquee la conexión
        max: 30
      }
    : {
        host: process.env.PGHOST || 'localhost',
        port: process.env.PGPORT || 5432,
        database: process.env.PGDATABASE || 'dynamo',
        user: process.env.PGUSER || 'user',
        password: process.env.PGPASSWORD || 'pass',
        max: 30
      };

const db = pgp(connectionConfig);

// Inicializa las tablas si no existen
export async function initDB() {
    try {
        await db.none(`
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                username TEXT,
                level INTEGER DEFAULT 0,
                xp INTEGER DEFAULT 0,
                warnings INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS guild_config (
                guild_id TEXT PRIMARY KEY,
                welcome_enabled BOOLEAN DEFAULT TRUE,
                autorole_id TEXT,
                moderation_level TEXT DEFAULT 'medium',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        `);

        console.log('✅ Base de datos PostgreSQL inicializada');
    } catch (err) {
        console.error('❌ Error inicializando PostgreSQL:', err.message);
    }
}

// Exporta la instancia para usarla en todo el bot
export { db };
