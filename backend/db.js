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

module.exports = { pool, query };
