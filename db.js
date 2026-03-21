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
        // En pg-promise no usamos .exec, usamos .none para ejecutar código sin esperar resultados de vuelta
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
                welcome_enabled INTEGER DEFAULT 1,
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
