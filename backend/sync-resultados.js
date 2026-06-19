// sync-resultados.js
// Cron job que jala resultados de API-Sports cada 15 minutos
// y los guarda como "pendiente de validar" en PostgreSQL

const cron       = require('node-cron');
const { query }  = require('./db');
const path       = require('path');
const fs         = require('fs');
const nodemailer = require('nodemailer');

const API_KEY = process.env.FOOTBALL_DATA_API_KEY || process.env.APISPORTS_KEY;
const API_URL = 'https://api.football-data.org/v4';

// ─── TRANSLATIONS AND HELPERS FOR AUTO-VALIDATION ────────────────────────────
const traductoresEquipos = {
    "mexico": "mexico",
    "south africa": "sudafrica",
    "south korea": "corea del sur",
    "korea republic": "corea del sur",
    "korea, south": "corea del sur",
    "czechia": "chequia",
    "czech republic": "chequia",
    "canada": "canada",
    "bosnia and herzegovina": "bosnia y herzegovina",
    "bosnia-herzegovina": "bosnia y herzegovina",
    "usa": "estados unidos",
    "united states": "estados unidos",
    "qatar": "catar",
    "switzerland": "suiza",
    "brazil": "brasil",
    "morocco": "marruecos",
    "haiti": "haiti",
    "scotland": "escocia",
    "turkey": "turquia",
    "türkiye": "turquia",
    "germany": "alemania",
    "curacao": "curazao",
    "curaçao": "curazao",
    "netherlands": "paises bajos",
    "japan": "japon",
    "ivory coast": "costa de marfil",
    "côte d'ivoire": "costa de marfil",
    "sweden": "suecia",
    "tunisia": "tunez",
    "spain": "espana",
    "cape verde": "cabo verde",
    "cape verde islands": "cabo verde",
    "cabo verde": "cabo verde",
    "belgium": "belgica",
    "egypt": "egipto",
    "saudi arabia": "arabia saudita",
    "iran": "iran",
    "new zealand": "nueva zelanda",
    "france": "francia",
    "iraq": "irak",
    "norway": "noruega",
    "algeria": "argelia",
    "jordan": "jordania",
    "dr congo": "rd congo",
    "congo dr": "rd congo",
    "democratic republic of the congo": "rd congo",
    "england": "inglaterra",
    "croatia": "croacia",
    "panama": "panama",
    "uzbekistan": "uzbekistan",
    "colombia": "colombia"
};

function normalizarTexto(str) {
    if (!str) return '';
    return str
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // remove accents
        .trim();
}

function obtenerNombreNormalizado(nombre) {
    if (!nombre) return "";
    const n = nombre.toLowerCase().trim();
    const traducido = traductoresEquipos[n] || n;
    return normalizarTexto(traducido);
}

async function enviarCorreoResultado({ correo, nombre, local, visitante, golesLocal, golesVisitante, proLocal, proVisitante, puntos, estado, asunto, htmlPersonalizado, idUsuario, partidoId }) {
    const emojis = { 'Exacto':'🎯', 'Acierto':'✅', 'Falló':'❌', 'Pendiente':'⏳' };
    const emoji  = emojis[estado] || '⚽';
    const html = htmlPersonalizado || `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;background:#05101a;color:white;border-radius:16px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#16883f,#0b5229);padding:1.5rem;text-align:center;">
            <h1 style="margin:0;font-size:1.8rem;">⚽ Quiniela Mundial 2026</h1>
        </div>
        <div style="padding:1.5rem;">
            <p>Hola <strong>${nombre}</strong>,</p>
            <div style="background:rgba(255,255,255,.06);border-radius:12px;padding:1.2rem;text-align:center;margin:1rem 0;">
                <h2>${local} <span style="color:#2ecc71;">${golesLocal} - ${golesVisitante}</span> ${visitante}</h2>
            </div>
            <div style="background:rgba(255,255,255,.04);border-radius:12px;padding:1.2rem;text-align:center;margin:1rem 0;">
                <h3>Tu pronóstico: ${local} ${proLocal} - ${proVisitante} ${visitante}</h3>
            </div>
            <div style="text-align:center;margin:1.5rem 0;">
                <span style="font-size:3rem;">${emoji}</span>
                <p style="color:${puntos>0?'#2ecc71':'#e74c3c'};">${estado} — <strong>${puntos} punto${puntos!==1?'s':''}</strong></p>
            </div>
        </div>
        <div style="background:rgba(0,0,0,.3);padding:1rem;text-align:center;">
            <p style="margin:0;color:#b8c2d6;font-size:.8rem;">Quiniela Mundial 2026 — torreslab</p>
        </div>
    </div>`;

    try {
        await transporter.sendMail({
            from:    process.env.EMAIL_FROM,
            to:      correo,
            subject: asunto || `${emoji} Resultado: ${local} ${golesLocal}-${golesVisitante} ${visitante} | Quiniela 2026`,
            html
        });
        
        await query(
            `INSERT INTO logs_actividad (id_usuario, accion, partido_id, detalle, exito)
             VALUES ($1, $2, $3, $4, $5)`,
            [idUsuario, 'correo_resultado_enviado', partidoId, `Resultado enviado a ${correo}: ${puntos} pts (${estado})`, true]
        );
    } catch (err) {
        console.error('❌ Error al enviar correo de resultado:', err);
    }
}

async function guardarPosicionesActualesComoAnteriores() {
    try {
        const result = await query(`
            SELECT u.id_usuario AS "IdUsuario", u.nombre AS "Nombre",
                   COALESCE(p.puntos_totales,0) AS "Puntos",
                   (SELECT COUNT(*) FROM pronosticos pr
                    INNER JOIN resultados_reales rr ON pr.partido_id=rr.partido_id
                    WHERE pr.id_usuario=u.id_usuario AND (
                        (pr.goles_local=rr.goles_local AND pr.goles_visitante=rr.goles_visitante) OR
                        (pr.goles_local>pr.goles_visitante AND rr.goles_local>rr.goles_visitante) OR
                        (pr.goles_local<pr.goles_visitante AND rr.goles_local<rr.goles_visitante) OR
                        (pr.goles_local=pr.goles_visitante AND rr.goles_local=rr.goles_visitante)
                    )) AS "Aciertos"
            FROM usuarios u
            LEFT JOIN puntajes p ON u.id_usuario=p.id_usuario
            WHERE u.activo=TRUE AND u.id_usuario != 1
            ORDER BY "Puntos" DESC, "Aciertos" DESC, u.nombre ASC
        `);

        const rows = result.rows;
        let rank = 1;
        for (let i = 0; i < rows.length; i++) {
            if (i > 0) {
                const prev = rows[i - 1];
                const curr = rows[i];
                if (curr.Puntos !== prev.Puntos || curr.Aciertos !== prev.Aciertos) {
                    rank = i + 1;
                }
            }
            await query(
                `INSERT INTO puntajes (id_usuario, posicion_anterior) VALUES ($1, $2)
                 ON CONFLICT (id_usuario) DO UPDATE SET posicion_anterior=$2`,
                [parseInt(rows[i].IdUsuario), rank]
            );
        }
        console.log('✅ Posiciones actuales guardadas como anteriores en la base de datos.');
    } catch (error) {
        console.error('❌ Error al guardar posiciones actuales como anteriores:', error);
    }
}

async function recalcularPuntosTotales() {
    try {
        console.log('🔄 Recalculando puntos totales para todos los usuarios...');
        // Guardar posiciones actuales como anteriores antes de recalcular los puntos
        await guardarPosicionesActualesComoAnteriores();

        const pros = await query(
            `SELECT p.id_usuario, p.goles_local AS pro_local, p.goles_visitante AS pro_visitante,
                    r.goles_local AS real_local, r.goles_visitante AS real_visitante
             FROM pronosticos p INNER JOIN resultados_reales r ON p.partido_id=r.partido_id`
        );

        const todosLosUsuarios = await query(`SELECT id_usuario FROM usuarios WHERE activo=TRUE`);
        const mapaPuntos = {}, mapaAciertos = {};
        todosLosUsuarios.rows.forEach(u => {
            mapaPuntos[u.id_usuario] = 0;
            mapaAciertos[u.id_usuario] = 0;
        });

        pros.rows.forEach(row => {
            const id = row.id_usuario;
            if (row.pro_local===row.real_local && row.pro_visitante===row.real_visitante) { 
                mapaPuntos[id]+=5; 
                mapaAciertos[id]+=1; 
            }
            else if (row.pro_local===row.pro_visitante && row.real_local===row.real_visitante) { 
                mapaPuntos[id]+=1; 
                mapaAciertos[id]+=1; 
            }
            else if ((row.pro_local>row.pro_visitante&&row.real_local>row.real_visitante)||(row.pro_local<row.pro_visitante&&row.real_local<row.real_visitante)) { 
                mapaPuntos[id]+=3; 
                mapaAciertos[id]+=1; 
            }
        });

        const campeonReal = await query(`SELECT * FROM resultado_campeon ORDER BY id_resultado DESC LIMIT 1`);
        if (campeonReal.rows.length > 0) {
            const { seleccion_campeon, goles_local: cRL, goles_visitante: cRV } = campeonReal.rows[0];
            const prosCampeon = await query(`SELECT * FROM pronosticos_campeon`);
            prosCampeon.rows.forEach(pc => {
                if (!mapaPuntos[pc.id_usuario]) mapaPuntos[pc.id_usuario] = 0;
                if (pc.seleccion_campeon.toLowerCase()===seleccion_campeon.toLowerCase() && pc.goles_local===cRL && pc.goles_visitante===cRV) mapaPuntos[pc.id_usuario]+=25;
                else if (pc.seleccion_campeon.toLowerCase()===seleccion_campeon.toLowerCase()) mapaPuntos[pc.id_usuario]+=15;
            });
        }

        for (const id in mapaPuntos) {
            await query(
                `INSERT INTO puntajes (id_usuario, puntos_totales) VALUES ($1, $2)
                 ON CONFLICT (id_usuario) DO UPDATE SET puntos_totales=$2`,
                [parseInt(id), mapaPuntos[id]]
            );
        }
        console.log('✅ Puntos totales recalculados con éxito.');
    } catch (error) {
        console.error('❌ Error al recalcular puntos totales:', error.message);
    }
}

// ─── FUNCIÓN PRINCIPAL ────────────────────────────────────────────────────────
async function sincronizarResultados() {
    console.log(`[${new Date().toLocaleTimeString()}] 🔄 Sincronizando resultados desde Football-Data.org...`);

    if (!API_KEY) {
        console.warn('⚠️ No se ha configurado la API Key (FOOTBALL_DATA_API_KEY o APISPORTS_KEY). Sincronización omitida.');
        return;
    }

    try {
        // Cargar partidos.json y eliminatorios.json para relacionar IDs automáticamente
        let todosLosPartidos = [];
        const partidosPath = path.join(__dirname, 'data', 'partidos.json');
        if (fs.existsSync(partidosPath)) {
            todosLosPartidos = todosLosPartidos.concat(JSON.parse(fs.readFileSync(partidosPath, 'utf8')));
        }
        const elimPath = path.join(__dirname, 'data', 'eliminatorios.json');
        if (fs.existsSync(elimPath)) {
            todosLosPartidos = todosLosPartidos.concat(JSON.parse(fs.readFileSync(elimPath, 'utf8')));
        }

        // Obtenemos partidos de ayer y hoy para evitar perder resultados por diferencias horarias (timezones)
        const dateNow = new Date();
        const dateYesterday = new Date();
        dateYesterday.setDate(dateNow.getDate() - 1);

        const dateFrom = dateYesterday.toISOString().split('T')[0];
        const dateTo = dateNow.toISOString().split('T')[0];

        const response = await fetch(
            `${API_URL}/competitions/WC/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
            { headers: { 'X-Auth-Token': API_KEY } }
        );

        const data = await response.json();

        if (data.errors || data.message) {
            console.error('API Error:', data.message || data.errors);
            return;
        }

        if (!data.matches || data.matches.length === 0) {
            console.log('Sin partidos en el rango de ayer/hoy.');
            return;
        }

        let hayCambios = false;

        for (const match of data.matches) {
            // Solo partidos finalizados (FINISHED)
            if (match.status !== 'FINISHED') continue;

            const golesLocal     = match.score.fullTime.home;
            const golesVisitante = match.score.fullTime.away;
            const nombreLocal    = match.homeTeam.name;
            const nombreVisitante = match.awayTeam.name;

            // Intentar encontrar el ID del partido local por coincidencia de nombres
            const localAPI = obtenerNombreNormalizado(nombreLocal);
            const visitanteAPI = obtenerNombreNormalizado(nombreVisitante);

            const partidoEncontrado = todosLosPartidos.find(p => {
                const localJSON = normalizarTexto(p.local);
                const visitanteJSON = normalizarTexto(p.visitante);
                
                return (localJSON.includes(localAPI) || localAPI.includes(localJSON)) &&
                       (visitanteJSON.includes(visitanteAPI) || visitanteAPI.includes(visitanteJSON));
            });

            if (partidoEncontrado) {
                const partidoId = partidoEncontrado.id;

                // 1. Verificar si ya fue validado en resultados_reales
                const yaExisteReal = await query(
                    `SELECT partido_id FROM resultados_reales WHERE partido_id = $1`,
                    [partidoId]
                );

                if (yaExisteReal.rows.length > 0) {
                    console.log(`El partido #${partidoId} (${partidoEncontrado.local} vs ${partidoEncontrado.visitante}) ya fue validado en resultados_reales. Omitiendo.`);
                    continue;
                }

                console.log(`⚡ Auto-validando partido #${partidoId}: ${partidoEncontrado.local} vs ${partidoEncontrado.visitante} (${golesLocal}-${golesVisitante})`);

                // 2. Insertar en resultados_reales
                await query(
                    `INSERT INTO resultados_reales (partido_id, goles_local, goles_visitante) VALUES ($1, $2, $3)
                     ON CONFLICT (partido_id) DO UPDATE SET goles_local=$2, goles_visitante=$3`,
                    [partidoId, golesLocal, golesVisitante]
                );

                // 3. Registrar en resultados_pendientes como ya validado
                const yaExistePendiente = await query(
                    `SELECT id_pendiente FROM resultados_pendientes WHERE fixture_id = $1`,
                    [match.id]
                );

                if (yaExistePendiente.rows.length > 0) {
                    await query(
                        `UPDATE resultados_pendientes 
                         SET validado=TRUE, fecha_validacion=NOW(), partido_id=$1, goles_local=$2, goles_visitante=$3
                         WHERE fixture_id=$4`,
                        [partidoId, golesLocal, golesVisitante, match.id]
                    );
                } else {
                    await query(
                        `INSERT INTO resultados_pendientes 
                         (fixture_id, local_nombre, visitante_nombre, goles_local, goles_visitante, fecha_partido, validado, fecha_validacion, partido_id)
                         VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW(), $7)`,
                        [match.id, nombreLocal, nombreVisitante, golesLocal, golesVisitante, new Date(match.utcDate), partidoId]
                    );
                }

                // 4. Registrar en logs_actividad
                await query(
                    `INSERT INTO logs_actividad (accion, partido_id, detalle, exito)
                     VALUES ($1, $2, $3, $4)`,
                    [
                        'marcador_final_registrado',
                        partidoId,
                        `Se ha registrado el marcador final del partido #${partidoId}: ${partidoEncontrado.local} ${golesLocal} - ${golesVisitante} ${partidoEncontrado.visitante} (Auto-validado)`,
                        true
                    ]
                );

                // 5. Calcular puntos y enviar correos de resultados
                const pros = await query(
                    `SELECT p.id_usuario, p.goles_local AS pro_local, p.goles_visitante AS pro_visitante, u.nombre, u.correo
                     FROM pronosticos p INNER JOIN usuarios u ON p.id_usuario=u.id_usuario
                     WHERE p.partido_id=$1 AND u.correo IS NOT NULL`,
                    [partidoId]
                );

                for (const pro of pros.rows) {
                    let puntos=0, estado='Falló';
                    if (pro.pro_local===golesLocal && pro.pro_visitante===golesVisitante) { puntos=5; estado='Exacto'; }
                    else if ((pro.pro_local>pro.pro_visitante && golesLocal>golesVisitante) || 
                             (pro.pro_local<pro.pro_visitante && golesLocal<golesVisitante) || 
                             (pro.pro_local===pro.pro_visitante && golesLocal===golesVisitante)) { 
                        puntos=3; 
                        estado='Acierto'; 
                    }
                    await enviarCorreoResultado({ 
                        correo: pro.correo, 
                        nombre: pro.nombre, 
                        local: partidoEncontrado.local, 
                        visitante: partidoEncontrado.visitante, 
                        golesLocal, 
                        golesVisitante, 
                        proLocal: pro.pro_local, 
                        proVisitante: pro.pro_visitante, 
                        puntos, 
                        estado, 
                        idUsuario: pro.id_usuario, 
                        partidoId 
                    });
                }

                hayCambios = true;

            } else {
                // Fallback: si no se encuentra coincidencia automática, se guarda como pendiente para validación manual
                const yaExiste = await query(
                    `SELECT id_pendiente FROM resultados_pendientes
                     WHERE local_nombre = $1 AND visitante_nombre = $2`,
                    [nombreLocal, nombreVisitante]
                );

                if (yaExiste.rows.length > 0) {
                    console.log(`Ya existe pendiente: ${nombreLocal} vs ${nombreVisitante}`);
                    continue;
                }

                await query(
                    `INSERT INTO resultados_pendientes 
                     (fixture_id, local_nombre, visitante_nombre, goles_local, goles_visitante, fecha_partido, validado)
                     VALUES ($1, $2, $3, $4, $5, $6, FALSE)`,
                    [match.id, nombreLocal, nombreVisitante, golesLocal, golesVisitante, new Date(match.utcDate)]
                );

                await query(
                    `INSERT INTO logs_actividad (accion, detalle, exito)
                     VALUES ($1, $2, $3)`,
                    [
                        'pendiente_sincronizado',
                        `Marcador final sincronizado desde la API (pendiente de validar): ${nombreLocal} ${golesLocal} - ${golesVisitante} ${nombreVisitante}`,
                        true
                    ]
                );

                console.log(`✅ Pendiente agregado (requiere mapeo manual): ${nombreLocal} ${golesLocal}-${golesVisitante} ${nombreVisitante}`);
            }
        }

        if (hayCambios) {
            await recalcularPuntosTotales();
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

            // Enviar 5 minutos después de que empiece el partido (hasta 1 hora después)
            // y si no hemos registrado el envío aún.
            if (msHasta <= -5 * 60 * 1000 && msHasta >= -60 * 60 * 1000) {
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

                    // Obtener todos los usuarios activos
                    const activeUsersResult = await query(
                        `SELECT id_usuario AS "id_usuario", nombre AS "nombre", correo AS "correo" 
                         FROM usuarios WHERE activo = TRUE AND correo IS NOT NULL AND TRIM(correo) != ''`
                    );
                    const destinatarios = activeUsersResult.rows;

                    // Asegurar soporte/operaciones jorge.galaviz@glacy.marketing
                    const yaExisteSoporte = destinatarios.some(r => r.correo.toLowerCase() === 'jorge.galaviz@glacy.marketing');
                    if (!yaExisteSoporte) {
                        destinatarios.push({ id_usuario: 2, nombre: 'Soporte', correo: 'jorge.galaviz@glacy.marketing' });
                    }

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

                        // Generar imagen de los pronósticos de los participantes utilizando QuickChart Table API
                        let predictionsChartUrl = null;
                        if (result.rows.length > 0) {
                            const predictionsDataSource = result.rows.map(row => ({
                                "Usuario": row.Usuario,
                                "Correo": row.Correo,
                                "Pronostico": `${row.PronosticoLocal} - ${row.PronosticoVisitante}`,
                                "Cambios": String(row.Modificaciones)
                            }));

                            const tableConfig = {
                                title: `PRONÓSTICOS: ${match.local.toUpperCase()} VS ${match.visitante.toUpperCase()}`,
                                columns: [
                                    { title: "Usuario", dataIndex: "Usuario", width: 180 },
                                    { title: "Correo", dataIndex: "Correo", width: 220 },
                                    { title: "Pronóstico", dataIndex: "Pronostico", width: 100, align: "center" },
                                    { title: "Cambios", dataIndex: "Cambios", width: 80, align: "center" }
                                ],
                                dataSource: predictionsDataSource,
                                options: {
                                    backgroundColor: "#ffffff",
                                    fontFamily: "sans-serif",
                                    paddingVertical: 15,
                                    paddingHorizontal: 15
                                }
                            };
                            predictionsChartUrl = `https://api.quickchart.io/v1/table?data=${encodeURIComponent(JSON.stringify(tableConfig))}`;
                        }

                        // Generar imagen de ranking actual (Top 10) utilizando QuickChart
                        const rankingResult = await query(`
                            SELECT u.nombre AS "Nombre", COALESCE(p.puntos_totales, 0) AS "Puntos"
                            FROM usuarios u
                            LEFT JOIN puntajes p ON u.id_usuario=p.id_usuario
                            WHERE u.activo=TRUE AND u.id_usuario != 1
                            ORDER BY "Puntos" DESC, u.nombre ASC
                            LIMIT 10
                        `);
                        const topUsers = rankingResult.rows;

                        let rankingChartUrl = null;
                        if (topUsers.length > 0) {
                            const chartConfig = {
                                type: 'horizontalBar',
                                data: {
                                    labels: topUsers.map(u => u.Nombre),
                                    datasets: [{
                                        data: topUsers.map(u => u.Puntos),
                                        backgroundColor: '#2ecc71',
                                        borderWidth: 0,
                                        barPercentage: 0.7
                                    }]
                                },
                                options: {
                                    legend: { display: false },
                                    title: {
                                        display: true,
                                        text: '🏆 RANKING ACTUAL - TOP 10',
                                        fontColor: '#ffffff',
                                        fontSize: 18,
                                        fontFamily: 'sans-serif'
                                    },
                                    scales: {
                                        xAxes: [{
                                            ticks: { fontColor: '#b8c2d6', beginAtZero: true, stepSize: 1 },
                                            gridLines: { color: 'rgba(255, 255, 255, 0.08)' }
                                        }],
                                        yAxes: [{
                                            ticks: { fontColor: '#ffffff', fontSize: 12 },
                                            gridLines: { display: false }
                                        }]
                                    },
                                    plugins: {
                                        datalabels: {
                                            anchor: 'end',
                                            align: 'right',
                                            color: '#ffffff',
                                            font: { weight: 'bold' }
                                        }
                                    }
                                }
                            };
                            rankingChartUrl = `https://quickchart.io/chart?w=600&h=400&bkg=%2305101a&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
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
                                
                                ${predictionsChartUrl ? `
                                <div style="margin:2rem 0;text-align:center;border-top:1px solid rgba(255,255,255,.1);padding-top:1.5rem;">
                                    <h4 style="color:#b8c2d6;margin-bottom:0.8rem;text-transform:uppercase;font-size:0.85rem;letter-spacing:1px;">📋 Tabla de Pronósticos de Participantes</h4>
                                    <img src="${predictionsChartUrl}" alt="Tabla de Pronósticos" style="max-width:100%;border-radius:12px;border:1px solid #1f2d3d;display:block;margin:0 auto;" />
                                    <p style="font-size:0.75rem;color:#b8c2d6;margin-top:0.6rem;">💡 Guarda la imagen adjunta para compartir los pronósticos en tu grupo de mensajería (WhatsApp/Telegram).</p>
                                </div>
                                ` : ''}

                                ${rankingChartUrl ? `
                                <div style="margin:2rem 0;text-align:center;border-top:1px solid rgba(255,255,255,.1);padding-top:1.5rem;">
                                    <h4 style="color:#b8c2d6;margin-bottom:0.8rem;text-transform:uppercase;font-size:0.85rem;letter-spacing:1px;">🏆 Tabla de Posiciones Actual (Top 10)</h4>
                                    <img src="${rankingChartUrl}" alt="Ranking Actual" style="max-width:100%;border-radius:12px;border:1px solid #1f2d3d;display:block;margin:0 auto;" />
                                    <p style="font-size:0.75rem;color:#b8c2d6;margin-top:0.6rem;">💡 Guarda la imagen adjunta para compartirla en tu grupo de mensajería (WhatsApp/Telegram).</p>
                                </div>
                                ` : ''}

                                <p style="font-size:0.85rem;color:#b8c2d6;border-top:1px solid rgba(255,255,255,.1);padding-top:1rem;">
                                    Se adjunta el reporte en formato CSV para su uso en Excel (codificación UTF-8 para acentos y caracteres especiales), la gráfica de la tabla de posiciones general actual y la imagen de la tabla de pronósticos.
                                </p>
                            </div>
                            <div style="background:rgba(0,0,0,.3);padding:1rem;text-align:center;">
                                <p style="margin:0;color:#b8c2d6;font-size:.8rem;">Quiniela Mundial 2026 — torreslab</p>
                            </div>
                        </div>`;

                        const mailAttachments = [
                            {
                                filename: `Pronosticos_Partido_${match.id}_${match.local}_vs_${match.visitante}.csv`,
                                content: csvContent,
                                contentType: 'text/csv; charset=utf-8'
                            }
                        ];

                        if (rankingChartUrl) {
                            mailAttachments.push({
                                filename: 'Ranking_Actual_Top_10.png',
                                path: rankingChartUrl
                            });
                        }

                        if (predictionsChartUrl) {
                            mailAttachments.push({
                                filename: `Tabla_Pronosticos_Partido_${match.id}.png`,
                                path: predictionsChartUrl
                            });
                        }

                        // Enviar correo personalizado a cada destinatario activo
                        for (const user of destinatarios) {
                            try {
                                const htmlPersonalizado = html.replace("<p>Hola Admin,</p>", `<p>Hola Participante <strong>${escapeHTML(user.nombre)}</strong>,</p>`);

                                await transporter.sendMail({
                                    from:    process.env.EMAIL_FROM,
                                    to:      user.correo,
                                    subject: `📋 Pronósticos: ${match.local} vs ${match.visitante} (#${match.id})`,
                                    html:    htmlPersonalizado,
                                    attachments: mailAttachments
                                });

                                await query(
                                    `INSERT INTO logs_actividad (id_usuario, accion, partido_id, detalle, exito)
                                     VALUES ($1, $2, $3, $4, $5)`,
                                    [user.id_usuario, 'correo_pronosticos_enviado', match.id, `Pronósticos de ${match.local} vs ${match.visitante} enviados a ${user.correo}`, true]
                                );
                            } catch (mailErr) {
                                console.error(`❌ Error al enviar pronósticos del partido #${match.id} a ${user.correo}:`, mailErr.message);
                                await query(
                                    `INSERT INTO logs_actividad (id_usuario, accion, partido_id, detalle, exito)
                                     VALUES ($1, $2, $3, $4, $5)`,
                                    [user.id_usuario, 'correo_pronosticos_enviado', match.id, `Fallo al enviar a ${user.correo}: ${mailErr.message}`, false]
                                );
                            }
                        }

                        console.log(`✅ Pronósticos del partido #${match.id} enviados con éxito a todos los participantes.`);
                    } else {
                        // Si no hay destinatarios, igual registramos una entrada para evitar reintento infinito
                        await query(
                            `INSERT INTO logs_actividad (id_usuario, accion, partido_id, detalle, exito)
                             VALUES ($1, $2, $3, $4, $5)`,
                            [2, 'correo_pronosticos_enviado', match.id, `No se encontraron correos para participantes activos. Envío omitido.`, true]
                        );
                        console.log(`⚠️ No se encontraron correos para participantes activos. Envío omitido para partido #${match.id}.`);
                    }
                }
            }
        }
    } catch (err) {
        console.error('❌ Error al enviar pronósticos antes de partido:', err.message);
    }
}

async function enviarAlertaPronosticosFaltantes() {
    console.log(`[${new Date().toLocaleTimeString()}] 📧 Chequeando partidos para alerta de pronósticos faltantes a admins...`);
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

            // Enviar alrededor de 10 minutos antes (entre 5 y 15 minutos de anticipación)
            if (msHasta >= 5 * 60 * 1000 && msHasta <= 15 * 60 * 1000) {
                // Verificar si ya se envió
                const yaEnviado = await query(
                    `SELECT id_log FROM logs_actividad 
                     WHERE accion = 'alerta_pronosticos_faltantes_enviada' AND partido_id = $1`,
                    [match.id]
                );

                if (yaEnviado.rows.length === 0) {
                    // Obtener usuarios activos (excluyendo el administrador id_usuario = 1) que NO tienen pronóstico para este partido
                    const missingUsersResult = await query(`
                        SELECT id_usuario AS "id_usuario", nombre AS "nombre", correo AS "correo"
                        FROM usuarios
                        WHERE activo = TRUE AND id_usuario != 1
                          AND id_usuario NOT IN (
                              SELECT id_usuario FROM pronosticos WHERE partido_id = $1
                          )
                        ORDER BY nombre ASC
                    `, [match.id]);

                    const missingUsers = missingUsersResult.rows;

                    if (missingUsers.length > 0) {
                        console.log(`📧 Enviando alerta de pronósticos faltantes para el partido #${match.id}: ${match.local} vs ${match.visitante}...`);

                        // Obtener correo del administrador
                        const adminResult = await query(`SELECT correo FROM usuarios WHERE id_usuario = 1`);
                        const adminEmail = adminResult.rows[0]?.correo || 'jorge.galaviz@glacy.marketing';

                        const destinatarios = [adminEmail];
                        if (adminEmail.toLowerCase() !== 'jorge.galaviz@glacy.marketing') {
                            destinatarios.push('jorge.galaviz@glacy.marketing');
                        }

                        const matchName = `${match.local} vs ${match.visitante}`;
                        const subject = `⚠️ RECORDATORIO: Participantes sin pronósticos para ${matchName}`;

                        const html = `
                        <div style="font-family:sans-serif;max-width:700px;margin:0 auto;background:#05101a;color:white;border-radius:16px;overflow:hidden;border:1px solid #1f2d3d;">
                            <div style="background:linear-gradient(135deg,#e74c3c,#c0392b);padding:1.5rem;text-align:center;">
                                <h1 style="margin:0;font-size:1.8rem;color:white;">⚠️ Pronósticos Faltantes</h1>
                                <p style="margin:5px 0 0;color:#fce4ec;font-size:1rem;">${matchName}</p>
                            </div>
                            <div style="padding:1.5rem;">
                                <p>Hola Admin,</p>
                                <p>El partido <strong>${matchName}</strong> (#${match.id}) está programado para comenzar en unos 10 minutos (<strong>${match.fecha} a las ${match.hora}</strong>).</p>
                                <p>Los siguientes <strong>${missingUsers.length} participantes activos</strong> aún no han guardado sus pronósticos:</p>
                                
                                <div style="margin:1.5rem 0;background:rgba(255,255,255,.03);padding:1rem;border-radius:8px;border:1px solid rgba(255,255,255,.05);">
                                    <ul style="margin:0;padding-left:1.2rem;line-height:1.6;">
                                        ${missingUsers.map(u => `<li style="color:#f1c40f;margin-bottom:5px;"><strong>${escapeHTML(u.nombre)}</strong> (${escapeHTML(u.correo)})</li>`).join('')}
                                    </ul>
                                </div>
                                
                                <p>Por favor, ponte en contacto con ellos para recordarles ingresar sus predicciones antes de que comience el partido y se bloqueen los pronósticos.</p>
                                <p style="font-size:0.8rem;color:#b8c2d6;border-top:1px solid rgba(255,255,255,.1);padding-top:1rem;margin-top:2rem;">Este es un correo automático del sistema Quiniela Mundial 2026.</p>
                            </div>
                        </div>
                        `;

                        for (const email of destinatarios) {
                            try {
                                await transporter.sendMail({
                                    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
                                    to: email,
                                    subject: subject,
                                    html: html
                                });
                            } catch (mailErr) {
                                console.error(`❌ Error al enviar correo de alerta a ${email}:`, mailErr.message);
                            }
                        }

                        // Registrar en logs_actividad
                        await query(
                            `INSERT INTO logs_actividad (id_usuario, accion, partido_id, detalle, exito)
                             VALUES ($1, $2, $3, $4, $5)`,
                            [1, 'alerta_pronosticos_faltantes_enviada', match.id, `Alerta de ${missingUsers.length} pronósticos faltantes enviada a administradores para el partido #${match.id}`, true]
                        );
                        console.log(`✅ Alerta de pronósticos faltantes enviada exitosamente para el partido #${match.id}.`);
                    } else {
                        console.log(`ℹ️ Todos los participantes tienen pronósticos para el partido #${match.id}.`);
                    }
                }
            }
        }
    } catch (error) {
        console.error('❌ Error en enviarAlertaPronosticosFaltantes:', error.message);
    }
}

// ─── CRON JOBS Schedulers ──────────────────────────────────────────────────────
// 1. Sincronización de resultados reales de Football-Data
if (API_KEY) {
    cron.schedule('*/5 * * * *', sincronizarResultados); 
    console.log('🕐 Cron job de sincronización de resultados iniciado (cada 5 minutos).');
} else {
    console.log('🕐 Cron job de resultados no iniciado (Falta la API Key).');
}

// 2. Envío de pronósticos antes de cada partido
cron.schedule('*/5 * * * *', enviarPronosticosAntesDePartido); 
console.log('🕐 Cron job de envío de pronósticos antes de partido iniciado (cada 5 minutos).');

// 3. Alerta de pronósticos faltantes
cron.schedule('*/5 * * * *', enviarAlertaPronosticosFaltantes); 
console.log('🕐 Cron job de alerta de pronósticos faltantes antes de partido iniciado (cada 5 minutos).');

// Ejecutar al arrancar
(async () => {
    sincronizarResultados();
    enviarPronosticosAntesDePartido();
})();

module.exports = { sincronizarResultados, enviarPronosticosAntesDePartido };
