const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host:     process.env.DB_HOST     || process.env.PGHOST,
    port:     Number(process.env.DB_PORT || process.env.PGPORT || 5432),
    database: process.env.DB_NAME     || process.env.PGDATABASE,
    user:     process.env.DB_USER     || process.env.PGUSER,
    password: process.env.DB_PASSWORD || process.env.PGPASSWORD,
    ssl: process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : false
});

pool.connect()
    .then(client => {
        console.log('✅ Conectado a PostgreSQL');
        client.release();
    })
    .catch(err => {
        console.error('❌ Error conectando a PostgreSQL:', err.message);
    });

async function query(text, params) {
    const res = await pool.query(text, params);
    return res;
}

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

