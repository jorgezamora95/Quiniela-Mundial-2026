// sync-resultados.js
// Cron job que jala resultados de API-Sports cada 15 minutos
// y los guarda como "pendiente de validar" en PostgreSQL

const cron = require('node-cron');
const { query } = require('./db');

const API_KEY    = process.env.APISPORTS_KEY;
const LEAGUE_ID  = 1;    // FIFA World Cup
const SEASON     = 2026;
const API_URL    = 'https://v3.football.api-sports.io';

// ─── FUNCIÓN PRINCIPAL ────────────────────────────────────────────────────────
async function sincronizarResultados() {
    console.log(`[${new Date().toLocaleTimeString()}] 🔄 Sincronizando resultados...`);

    if (!API_KEY) {
        console.warn('⚠️ No se ha configurado APISPORTS_KEY. Sincronización omitida.');
        return;
    }

    try {
        // 1. Jalamos partidos terminados del día de hoy
        const hoy = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const response = await fetch(
            `${API_URL}/fixtures?league=${LEAGUE_ID}&season=${SEASON}&date=${hoy}&status=FT`,
            { headers: { 'x-apisports-key': API_KEY } }
        );

        const data = await response.json();

        if (!data.response || data.response.length === 0) {
            console.log('Sin partidos terminados hoy.');
            return;
        }

        for (const fixture of data.response) {
            const { fixture: f, teams, goals } = fixture;

            // Solo tiempo regular (FT = Full Time, no AET ni PEN)
            if (f.status.short !== 'FT') continue;

            const golesLocal     = goals.home;
            const golesVisitante = goals.away;
            const nombreLocal    = teams.home.name;
            const nombreVisitante = teams.away.name;

            // Buscar si ya existe el resultado pendiente en nuestra tabla
            const yaExiste = await query(
                `SELECT id_pendiente FROM resultados_pendientes
                 WHERE local_nombre = $1 AND visitante_nombre = $2`,
                [nombreLocal, nombreVisitante]
            );

            if (yaExiste.rows.length > 0) {
                console.log(`Ya existe pendiente: ${nombreLocal} vs ${nombreVisitante}`);
                continue;
            }

            // Insertar como pendiente de validar
            await query(
                `INSERT INTO resultados_pendientes 
                 (fixture_id, local_nombre, visitante_nombre, goles_local, goles_visitante, fecha_partido, validado)
                 VALUES ($1, $2, $3, $4, $5, $6, FALSE)`,
                [f.id, nombreLocal, nombreVisitante, golesLocal, golesVisitante, new Date(f.date)]
            );

            console.log(`✅ Pendiente agregado: ${nombreLocal} ${golesLocal}-${golesVisitante} ${nombreVisitante}`);
        }

    } catch (error) {
        console.error('Error al sincronizar:', error.message);
    }
}

// ─── CRON JOB: cada 15 minutos solo en horario de partidos ─────────────────────
// Solo se activa si la API Key está presente
if (API_KEY) {
    cron.schedule('*/15 12-23 * * *', sincronizarResultados); 
    console.log('🕐 Cron job de sincronización de resultados iniciado (cada 15 minutos entre las 12:00 y las 23:59).');
} else {
    console.log('🕐 Cron job de resultados no iniciado (Falta APISPORTS_KEY).');
}

// Ejecutar al arrancar
sincronizarResultados();

module.exports = { sincronizarResultados };
