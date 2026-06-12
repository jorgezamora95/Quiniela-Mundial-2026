// sync-resultados.js
// Cron job que jala resultados de API-Sports cada 15 minutos
// y los guarda como "pendiente de validar" en PostgreSQL

const cron       = require('node-cron');
const { query }  = require('./db');
const path       = require('path');
const fs         = require('fs');
const nodemailer = require('nodemailer');

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

// ─── EMAIL ENVIAR PRONÓSTICOS ANTES DE PARTIDOS ──────────────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function enviarPronosticosAntesDePartido() {
    console.log(`[${new Date().toLocaleTimeString()}] 📧 Chequeando partidos para envío de pronósticos a admin...`);
    try {
        let todosLosPartidos = [];
        const partidosPath = path.join(__dirname, 'data', 'partidos.json');
        if (fs.existsSync(partidosPath)) {
            todosLosPartidos = todosLosPartidos.concat(JSON.parse(fs.readFileSync(partidosPath, 'utf8')));
        }
        const elimPath = path.join(__dirname, 'data', 'eliminatorios.json');
        if (fs.existsSync(elimPath)) {
            todosLosPartidos = todosLosPartidos.concat(JSON.parse(fs.readFileSync(elimPath, 'utf8')));
        }

        const ahora = Date.now();

        for (const match of todosLosPartidos) {
            if (!match.id || !match.fecha || !match.hora) continue;

            const horaLimpia = match.hora.replace(" hrs", "");
            const fechaPartido = new Date(`${match.fecha} ${horaLimpia}:00 GMT-0600`);
            const msHasta = fechaPartido.getTime() - ahora;

            // Enviar si falta menos de 15 minutos para que empiece, o si empezó hace menos de 1 hora
            // y no hemos registrado el envío aún.
            if (msHasta <= 15 * 60 * 1000 && msHasta >= -60 * 60 * 1000) {
                // Verificar si ya se envió
                const yaEnviado = await query(
                    `SELECT id_log FROM logs_actividad 
                     WHERE accion = 'correo_pronosticos_enviado' AND partido_id = $1`,
                    [match.id]
                );

                if (yaEnviado.rows.length === 0) {
                    console.log(`📧 Enviando pronósticos del partido #${match.id}: ${match.local} vs ${match.visitante}...`);

                    // Obtener pronósticos de este partido
                    const result = await query(`
                        SELECT 
                            u.nombre AS "Usuario",
                            u.correo AS "Correo",
                            p.partido_id AS "PartidoId",
                            p.goles_local AS "PronosticoLocal",
                            p.goles_visitante AS "PronosticoVisitante",
                            COALESCE(pd.modificaciones_usadas, 0) AS "Modificaciones"
                        FROM pronosticos p
                        INNER JOIN usuarios u ON p.id_usuario = u.id_usuario
                        LEFT JOIN partidos_desbloqueados pd ON pd.id_usuario = p.id_usuario AND pd.partido_id = p.partido_id
                        WHERE p.partido_id = $1 AND u.activo = TRUE
                        ORDER BY u.nombre ASC
                    `, [match.id]);

                    // Obtener correos de administradores (ID 2 y 3)
                    const adminsResult = await query(
                        `SELECT id_usuario AS "id_usuario", correo AS "correo" 
                         FROM usuarios WHERE id_usuario IN (2, 3) AND activo = TRUE`
                    );
                    const destinatarios = adminsResult.rows.map(r => r.correo).filter(c => c && c.trim() !== '');
                    destinatarios.push('jorge.galaviz@glacy.marketing');

                    if (destinatarios.length > 0) {
                        // Generar CSV
                        const escapeCSV = (str) => {
                            if (str === null || str === undefined) return '';
                            return `"${String(str).replace(/"/g, '""')}"`;
                        };

                        let csvContent = "\uFEFFUsuario,Correo,Partido #,Partido,Pronóstico Local,Pronóstico Visitante,Modificaciones\n";
                        for (const row of result.rows) {
                            const matchName = `${match.local} vs ${match.visitante}`;
                            csvContent += `${escapeCSV(row.Usuario)},${escapeCSV(row.Correo)},${row.PartidoId},${escapeCSV(matchName)},${row.PronosticoLocal},${row.PronosticoVisitante},${row.Modificaciones}\n`;
                        }

                        // Generar HTML
                        const html = `
                        <div style="font-family:sans-serif;max-width:700px;margin:0 auto;background:#05101a;color:white;border-radius:16px;overflow:hidden;border:1px solid #1f2d3d;">
                            <div style="background:linear-gradient(135deg,#16883f,#0b5229);padding:1.5rem;text-align:center;">
                                <h1 style="margin:0;font-size:1.8rem;color:white;">⚽ Pronósticos del Partido</h1>
                                <p style="margin:5px 0 0;color:#e8f5e9;font-size:1rem;">${match.local} vs ${match.visitante}</p>
                            </div>
                            <div style="padding:1.5rem;">
                                <p>Hola Admin,</p>
                                <p>A continuación se listan los pronósticos de los participantes para el partido <strong>${match.local} vs ${match.visitante}</strong> (#${match.id}), programado para el <strong>${match.fecha} a las ${match.hora}</strong>.</p>
                                
                                <div style="overflow-x:auto;margin:1.5rem 0;">
                                    <table style="width:100%;border-collapse:collapse;color:white;font-size:0.9rem;">
                                        <thead>
                                            <tr style="background:rgba(255,255,255,.08);border-bottom:2px solid rgba(255,255,255,.15);text-align:left;">
                                                <th style="padding:10px;">Usuario</th>
                                                <th style="padding:10px;">Correo</th>
                                                <th style="padding:10px;text-align:center;">Pronóstico</th>
                                                <th style="padding:10px;text-align:center;">Cambios</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${result.rows.length === 0 ? `
                                                <tr>
                                                    <td colspan="4" style="padding:20px;text-align:center;color:#b8c2d6;">No hay pronósticos registrados para este partido.</td>
                                                </tr>
                                            ` : result.rows.map((row, index) => `
                                                <tr style="background:${index % 2 === 0 ? 'rgba(255,255,255,.02)' : 'rgba(255,255,255,.05)'};border-bottom:1px solid rgba(255,255,255,.05);">
                                                    <td style="padding:10px;">${escapeHTML(row.Usuario)}</td>
                                                    <td style="padding:10px;color:#b8c2d6;">${escapeHTML(row.Correo)}</td>
                                                    <td style="padding:10px;text-align:center;font-weight:bold;color:#2ecc71;">${row.PronosticoLocal} - ${row.PronosticoVisitante}</td>
                                                    <td style="padding:10px;text-align:center;color:#f1c40f;">${row.Modificaciones}</td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>
                                
                                <p style="font-size:0.85rem;color:#b8c2d6;border-top:1px solid rgba(255,255,255,.1);padding-top:1rem;">
                                    Se adjunta el reporte en formato CSV para su uso en Excel (codificación UTF-8 para acentos y caracteres especiales).
                                </p>
                            </div>
                            <div style="background:rgba(0,0,0,.3);padding:1rem;text-align:center;">
                                <p style="margin:0;color:#b8c2d6;font-size:.8rem;">Quiniela Mundial 2026 — torreslab</p>
                            </div>
                        </div>`;

                        await transporter.sendMail({
                            from:    process.env.EMAIL_FROM,
                            to:      destinatarios.join(', '),
                            subject: `📋 Pronósticos: ${match.local} vs ${match.visitante} (#${match.id})`,
                            html,
                            attachments: [
                                {
                                    filename: `Pronosticos_Partido_${match.id}_${match.local}_vs_${match.visitante}.csv`,
                                    content: csvContent,
                                    contentType: 'text/csv; charset=utf-8'
                                }
                            ]
                        });

                        // Registrar Log de Actividad para cada administrador destinatario
                        for (const admin of adminsResult.rows) {
                            if (admin.correo) {
                                await query(
                                    `INSERT INTO logs_actividad (id_usuario, accion, partido_id, detalle, exito)
                                     VALUES ($1, $2, $3, $4, $5)`,
                                    [admin.id_usuario, 'correo_pronosticos_enviado', match.id, `Pronósticos de ${match.local} vs ${match.visitante} enviados a ${admin.correo}`, true]
                                );
                            }
                        }

                        console.log(`✅ Pronósticos del partido #${match.id} enviados con éxito a ${destinatarios.join(', ')}.`);
                    } else {
                        // Si no hay destinatarios, igual registramos una entrada para evitar reintento infinito
                        await query(
                            `INSERT INTO logs_actividad (id_usuario, accion, partido_id, detalle, exito)
                             VALUES ($1, $2, $3, $4, $5)`,
                            [2, 'correo_pronosticos_enviado', match.id, `No se encontraron correos para administradores 2 y 3. Envío omitido.`, true]
                        );
                        console.log(`⚠️ No se encontraron correos para administradores 2 y 3. Envío omitido para partido #${match.id}.`);
                    }
                }
            }
        }
    } catch (err) {
        console.error('❌ Error al enviar pronósticos antes de partido:', err.message);
    }
}

// ─── CRON JOBS Schedulers ──────────────────────────────────────────────────────
// 1. Sincronización de resultados reales de API-Sports
if (API_KEY) {
    cron.schedule('*/15 12-23 * * *', sincronizarResultados); 
    console.log('🕐 Cron job de sincronización de resultados iniciado (cada 15 minutos entre las 12:00 y las 23:59).');
} else {
    console.log('🕐 Cron job de resultados no iniciado (Falta APISPORTS_KEY).');
}

// 2. Envío de pronósticos antes de cada partido
cron.schedule('*/5 * * * *', enviarPronosticosAntesDePartido); 
console.log('🕐 Cron job de envío de pronósticos antes de partido iniciado (cada 5 minutos).');

// Ejecutar al arrancar
(async () => {
    try {
        console.log('🔄 Ejecutando reenvío forzado de pronósticos para partidos 1 y 2 (para automatización)...');
        
        let todosLosPartidos = [];
        const partidosPath = path.join(__dirname, 'data', 'partidos.json');
        if (fs.existsSync(partidosPath)) {
            todosLosPartidos = todosLosPartidos.concat(JSON.parse(fs.readFileSync(partidosPath, 'utf8')));
        }
        const elimPath = path.join(__dirname, 'data', 'eliminatorios.json');
        if (fs.existsSync(elimPath)) {
            todosLosPartidos = todosLosPartidos.concat(JSON.parse(fs.readFileSync(elimPath, 'utf8')));
        }

        const adminsResult = await query(
            `SELECT id_usuario AS "id_usuario", correo AS "correo" 
             FROM usuarios WHERE id_usuario IN (2, 3) AND activo = TRUE`
        );
        const destinatarios = adminsResult.rows.map(r => r.correo).filter(c => c && c.trim() !== '');
        destinatarios.push('jorge.galaviz@glacy.marketing');

        if (destinatarios.length > 0) {
            for (const partidoId of [1, 2]) {
                const match = todosLosPartidos.find(p => p.id === partidoId);
                if (match) {
                    const result = await query(`
                        SELECT 
                            u.nombre AS "Usuario",
                            u.correo AS "Correo",
                            p.partido_id AS "PartidoId",
                            p.goles_local AS "PronosticoLocal",
                            p.goles_visitante AS "PronosticoVisitante",
                            COALESCE(pd.modificaciones_usadas, 0) AS "Modificaciones"
                        FROM pronosticos p
                        INNER JOIN usuarios u ON p.id_usuario = u.id_usuario
                        LEFT JOIN partidos_desbloqueados pd ON pd.id_usuario = p.id_usuario AND pd.partido_id = p.partido_id
                        WHERE p.partido_id = $1 AND u.activo = TRUE
                        ORDER BY u.nombre ASC
                    `, [partidoId]);

                    const escapeCSV = (str) => {
                        if (str === null || str === undefined) return '';
                        return `"${String(str).replace(/"/g, '""')}"`;
                    };

                    let csvContent = "\uFEFFUsuario,Correo,Partido #,Partido,Pronóstico Local,Pronóstico Visitante,Modificaciones\n";
                    for (const row of result.rows) {
                        const matchName = `${match.local} vs ${match.visitante}`;
                        csvContent += `${escapeCSV(row.Usuario)},${escapeCSV(row.Correo)},${row.PartidoId},${escapeCSV(matchName)},${row.PronosticoLocal},${row.PronosticoVisitante},${row.Modificaciones}\n`;
                    }

                    const html = `
                    <div style="font-family:sans-serif;max-width:700px;margin:0 auto;background:#05101a;color:white;border-radius:16px;overflow:hidden;border:1px solid #1f2d3d;">
                        <div style="background:linear-gradient(135deg,#16883f,#0b5229);padding:1.5rem;text-align:center;">
                            <h1 style="margin:0;font-size:1.8rem;color:white;">⚽ Pronósticos del Partido</h1>
                            <p style="margin:5px 0 0;color:#e8f5e9;font-size:1rem;">${match.local} vs ${match.visitante}</p>
                        </div>
                        <div style="padding:1.5rem;">
                            <p>Hola Admin,</p>
                            <p>A continuación se listan los pronósticos de los participantes para el partido <strong>${match.local} vs ${match.visitante}</strong> (#${match.id}), programado para el <strong>${match.fecha} a las ${match.hora}</strong>.</p>
                            
                            <div style="overflow-x:auto;margin:1.5rem 0;">
                                <table style="width:100%;border-collapse:collapse;color:white;font-size:0.9rem;">
                                    <thead>
                                        <tr style="background:rgba(255,255,255,.08);border-bottom:2px solid rgba(255,255,255,.15);text-align:left;">
                                            <th style="padding:10px;">Usuario</th>
                                            <th style="padding:10px;">Correo</th>
                                            <th style="padding:10px;text-align:center;">Pronóstico</th>
                                            <th style="padding:10px;text-align:center;">Cambios</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${result.rows.length === 0 ? `
                                            <tr>
                                                <td colspan="4" style="padding:20px;text-align:center;color:#b8c2d6;">No hay pronósticos registrados para este partido.</td>
                                            </tr>
                                        ` : result.rows.map((row, index) => `
                                            <tr style="background:${index % 2 === 0 ? 'rgba(255,255,255,.02)' : 'rgba(255,255,255,.05)'};border-bottom:1px solid rgba(255,255,255,.05);">
                                                <td style="padding:10px;">${escapeHTML(row.Usuario)}</td>
                                                <td style="padding:10px;color:#b8c2d6;">${escapeHTML(row.Correo)}</td>
                                                <td style="padding:10px;text-align:center;font-weight:bold;color:#2ecc71;">${row.PronosticoLocal} - ${row.PronosticoVisitante}</td>
                                                <td style="padding:10px;text-align:center;color:#f1c40f;">${row.Modificaciones}</td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                            
                            <p style="font-size:0.85rem;color:#b8c2d6;border-top:1px solid rgba(255,255,255,.1);padding-top:1rem;">
                                Se adjunta el reporte en formato CSV para su uso en Excel (codificación UTF-8 para acentos y caracteres especiales).
                            </p>
                        </div>
                        <div style="background:rgba(0,0,0,.3);padding:1rem;text-align:center;">
                            <p style="margin:0;color:#b8c2d6;font-size:.8rem;">Quiniela Mundial 2026 — torreslab</p>
                        </div>
                    </div>`;

                    await transporter.sendMail({
                        from:    process.env.EMAIL_FROM,
                        to:      destinatarios.join(', '),
                        subject: `📋 Pronósticos: ${match.local} vs ${match.visitante} (#${match.id})`,
                        html,
                        attachments: [
                            {
                                filename: `Pronosticos_Partido_${match.id}_${match.local}_vs_${match.visitante}.csv`,
                                content: csvContent,
                                contentType: 'text/csv; charset=utf-8'
                            }
                        ]
                    });
                    console.log(`✅ Pronósticos del partido #${partidoId} forzados y enviados con éxito.`);
                }
            }
        }
    } catch (e) {
        console.error('Error al forzar reenvíos:', e.message);
    }
    sincronizarResultados();
    enviarPronosticosAntesDePartido();
})();

module.exports = { sincronizarResultados, enviarPronosticosAntesDePartido };
