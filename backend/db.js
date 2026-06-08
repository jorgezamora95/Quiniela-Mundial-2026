const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl:      process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : false,
    max:      10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('connect', () => console.log('✅ Conectado a PostgreSQL'));
pool.on('error', (err) => console.error('❌ Error PostgreSQL:', err));

// Helper para queries más limpias
const query = (text, params) => pool.query(text, params);

// Crear tabla de logs de actividad si no existe (auto-bootstrap)
(async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS logs_actividad (
                id_log          SERIAL PRIMARY KEY,
                id_usuario      INT,
                accion          VARCHAR(100) NOT NULL,
                partido_id      INT,
                detalle         TEXT,
                fecha           TIMESTAMP DEFAULT NOW(),
                exito           BOOLEAN DEFAULT TRUE,
                error_message   TEXT
            )
        `);
        console.log('✅ Tabla logs_actividad verificada/creada.');

        // Modificar columna foto_url a TEXT para soportar base64 o URLs muy largas
        await pool.query(`
            ALTER TABLE usuarios ALTER COLUMN foto_url TYPE TEXT;
        `);
        console.log('✅ Columna foto_url modificada a TEXT.');
    } catch (err) {
        console.error('❌ Error al verificar/crear tabla/columna:', err);
    }
})();

module.exports = { pool, query };
