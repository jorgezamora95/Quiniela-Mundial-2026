const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool(
    process.env.DATABASE_URL
        ? {
              connectionString: process.env.DATABASE_URL,
              ssl: { rejectUnauthorized: false }
          }
        : {
              host:     process.env.DB_HOST     || process.env.PGHOST,
              port:     Number(process.env.DB_PORT || process.env.PGPORT || 5432),
              database: process.env.DB_NAME     || process.env.PGDATABASE,
              user:     process.env.DB_USER     || process.env.PGUSER,
              password: process.env.DB_PASSWORD || process.env.PGPASSWORD,
              ssl: process.env.DB_SSL === 'true'
                  ? { rejectUnauthorized: false }
                  : false
          }
);

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

        // Crear tabla de configuración de la bolsa si no existe
        await pool.query(`
            CREATE TABLE IF NOT EXISTS config_bolsa (
                clave                VARCHAR(50)   NOT NULL PRIMARY KEY,
                valor                DECIMAL(5,2)  NOT NULL,
                fecha_actualizacion  TIMESTAMP     DEFAULT NOW(),
                actualizado_por      VARCHAR(100)
            );
        `);
        console.log('✅ Tabla config_bolsa verificada/creada.');

        // Insertar valores predeterminados de distribución de la bolsa
        await pool.query(`
            INSERT INTO config_bolsa (clave, valor) VALUES
                ('PctAdmin',   15.00),
                ('PctPremio1', 50.00),
                ('PctPremio2', 30.00),
                ('PctPremio3', 20.00)
            ON CONFLICT (clave) DO NOTHING;
        `);
        console.log('✅ Valores iniciales de config_bolsa verificados/insertados.');
    } catch (err) {
        console.error('❌ Error al verificar/crear tabla/columna:', err);
    }
})();

module.exports = { pool, query };

