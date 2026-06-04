// sync-resultados.js
// Cron job que jala resultados de API-Sports cada 5 minutos
// y los guarda como "pendiente de validar" en SQL Server

const cron       = require('node-cron');
const { sql, poolPromise } = require('./db');

const API_KEY    = process.env.APISPORTS_KEY;
const LEAGUE_ID  = 1;    // FIFA World Cup
const SEASON     = 2026;
const API_URL    = 'https://v3.football.api-sports.io';

// ─── FUNCIÓN PRINCIPAL ────────────────────────────────────────────────────────
async function sincronizarResultados() {
    console.log(`[${new Date().toLocaleTimeString()}] 🔄 Sincronizando resultados...`);

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

        const pool = await poolPromise;

        for (const fixture of data.response) {
            const { fixture: f, teams, goals, score } = fixture;

            // Solo tiempo regular (FT = Full Time, no AET ni PEN)
            if (f.status.short !== 'FT') continue;

            const golesLocal     = goals.home;
            const golesVisitante = goals.away;
            const nombreLocal    = teams.home.name;
            const nombreVisitante = teams.away.name;

            // Buscar partido en nuestro JSON/BD por nombre de equipos
            const partidoLocal = await pool.request()
                .input('Local',     sql.NVarChar(100), nombreLocal)
                .input('Visitante', sql.NVarChar(100), nombreVisitante)
                .query(`
                    SELECT PartidoId 
                    FROM dbo.ResultadosPendientes 
                    WHERE LocalNombre = @Local AND VisitanteNombre = @Visitante
                `).catch(() => ({ recordset: [] }));

            // Buscar el PartidoId en nuestra tabla de partidos estática
            // (cruzamos por nombre del equipo contra el JSON)
            const yaExiste = await pool.request()
                .input('LocalNombre',     sql.NVarChar(100), nombreLocal)
                .input('VisitanteNombre', sql.NVarChar(100), nombreVisitante)
                .query(`
                    SELECT IdPendiente FROM dbo.ResultadosPendientes
                    WHERE LocalNombre = @LocalNombre AND VisitanteNombre = @VisitanteNombre
                `).catch(() => ({ recordset: [] }));

            if (yaExiste.recordset.length > 0) {
                console.log(`Ya existe pendiente: ${nombreLocal} vs ${nombreVisitante}`);
                continue;
            }

            // Insertar como pendiente de validar
            await pool.request()
                .input('FixtureId',       sql.Int,          f.id)
                .input('LocalNombre',     sql.NVarChar(100), nombreLocal)
                .input('VisitanteNombre', sql.NVarChar(100), nombreVisitante)
                .input('GolesLocal',      sql.Int,          golesLocal)
                .input('GolesVisitante',  sql.Int,          golesVisitante)
                .input('FechaPartido',    sql.DateTime,     new Date(f.date))
                .query(`
                    INSERT INTO dbo.ResultadosPendientes 
                    (FixtureId, LocalNombre, VisitanteNombre, GolesLocal, GolesVisitante, FechaPartido, Validado)
                    VALUES (@FixtureId, @LocalNombre, @VisitanteNombre, @GolesLocal, @GolesVisitante, @FechaPartido, 0)
                `);

            console.log(`✅ Pendiente agregado: ${nombreLocal} ${golesLocal}-${golesVisitante} ${nombreVisitante}`);
        }

    } catch (error) {
        console.error('Error al sincronizar:', error.message);
    }
}

// ─── CRON JOB: cada 5 minutos ─────────────────────────────────────────────────
// Solo entre las 12:00 y las 23:59 hora México
cron.schedule('*/15 12-15 * * *', sincronizarResultados); // cada 15 min solo en horario de partidos

// También ejecutar al arrancar
sincronizarResultados();

console.log('🕐 Cron job de sincronización iniciado — cada 5 minutos');

module.exports = { sincronizarResultados };
