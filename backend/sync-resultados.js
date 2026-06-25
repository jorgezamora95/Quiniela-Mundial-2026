// sync-resultados.js — SQL Server version
// Cron job: sincroniza resultados desde Football-Data.org cada 5 minutos

const cron       = require('node-cron');
const { sql, poolPromise } = require('./db');
const path       = require('path');
const fs         = require('fs');
const nodemailer = require('nodemailer');

const API_KEY = process.env.FOOTBALL_DATA_API_KEY || process.env.APISPORTS_KEY;
const API_URL = 'https://api.football-data.org/v4';

// ─── NODEMAILER ───────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const traductoresEquipos = {
    "mexico":"mexico","south africa":"sudafrica","south korea":"corea del sur",
    "korea republic":"corea del sur","korea, south":"corea del sur","czechia":"chequia",
    "czech republic":"chequia","canada":"canada","bosnia and herzegovina":"bosnia y herzegovina",
    "bosnia-herzegovina":"bosnia y herzegovina","usa":"estados unidos","united states":"estados unidos",
    "qatar":"catar","switzerland":"suiza","brazil":"brasil","morocco":"marruecos","haiti":"haiti",
    "scotland":"escocia","turkey":"turquia","türkiye":"turquia","germany":"alemania",
    "curacao":"curazao","curaçao":"curazao","netherlands":"paises bajos","japan":"japon",
    "ivory coast":"costa de marfil","côte d'ivoire":"costa de marfil","sweden":"suecia",
    "tunisia":"tunez","spain":"espana","cape verde":"cabo verde","cape verde islands":"cabo verde",
    "cabo verde":"cabo verde","belgium":"belgica","egypt":"egipto","saudi arabia":"arabia saudita",
    "iran":"iran","new zealand":"nueva zelanda","france":"francia","iraq":"irak","norway":"noruega",
    "algeria":"argelia","jordan":"jordania","dr congo":"rd congo","congo dr":"rd congo",
    "democratic republic of the congo":"rd congo","england":"inglaterra","croatia":"croacia",
    "panama":"panama","uzbekistan":"uzbekistan","colombia":"colombia"
};

function normalizarTexto(str) {
    if (!str) return '';
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();
}

function obtenerNombreNormalizado(nombre) {
    if (!nombre) return "";
    const n = nombre.toLowerCase().trim();
    return normalizarTexto(traductoresEquipos[n] || n);
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
              .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

// ─── LOG ACTIVIDAD ────────────────────────────────────────────────────────────
async function log(pool, { idUsuario, accion, partidoId, detalle, exito, errorMessage }) {
    try {
        await pool.request()
            .input('IdUsuario',    sql.Int,          idUsuario || null)
            .input('Accion',       sql.NVarChar(100), accion)
            .input('PartidoId',    sql.Int,          partidoId || null)
            .input('Detalle',      sql.NVarChar(500), detalle || null)
            .input('Exito',        sql.Bit,          exito ?? true)
            .input('ErrorMessage', sql.NVarChar(500), errorMessage || null)
            .query(`INSERT INTO dbo.LogsActividad (IdUsuario,Accion,PartidoId,Detalle,Exito,ErrorMessage)
                    VALUES (@IdUsuario,@Accion,@PartidoId,@Detalle,@Exito,@ErrorMessage)`);
    } catch (err) { console.error('❌ Log error:', err.message); }
}

// ─── ENVIAR CORREO ────────────────────────────────────────────────────────────
async function enviarCorreoResultado({ correo, nombre, local, visitante, golesLocal, golesVisitante, proLocal, proVisitante, puntos, estado, asunto, htmlPersonalizado, idUsuario, partidoId }) {
    const emojis = { 'Exacto':'🎯','Acierto':'✅','Falló':'❌','Pendiente':'⏳' };
    const emoji  = emojis[estado] || '⚽';
    const html   = htmlPersonalizado || `
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
    const pool = await poolPromise;
    try {
        await transporter.sendMail({
            from:    process.env.EMAIL_FROM,
            to:      correo,
            subject: asunto || `${emoji} Resultado: ${local} ${golesLocal}-${golesVisitante} ${visitante} | Quiniela 2026`,
            html
        });
        await log(pool, { idUsuario, accion:'correo_resultado_enviado', partidoId, detalle:`Resultado enviado a ${correo}: ${puntos} pts (${estado})`, exito:true });
    } catch (err) {
        console.error('❌ Error correo resultado:', err.message);
    }
}

// ─── RECALCULAR POSICIONES ANTERIORES ────────────────────────────────────────
async function guardarPosicionesActualesComoAnteriores(pool) {
    try {
        const result = await pool.request().query(`
            SELECT u.IdUsuario, COALESCE(p.PuntosTotales,0) AS Puntos,
                   (SELECT COUNT(*) FROM dbo.Pronosticos pr
                    INNER JOIN dbo.ResultadosReales rr ON pr.PartidoId=rr.PartidoId
                    WHERE pr.IdUsuario=u.IdUsuario AND (
                        (pr.GolesLocal=rr.GolesLocal AND pr.GolesVisitante=rr.GolesVisitante) OR
                        (pr.GolesLocal>pr.GolesVisitante AND rr.GolesLocal>rr.GolesVisitante) OR
                        (pr.GolesLocal<pr.GolesVisitante AND rr.GolesLocal<rr.GolesVisitante) OR
                        (pr.GolesLocal=pr.GolesVisitante AND rr.GolesLocal=rr.GolesVisitante)
                    )) AS Aciertos
            FROM dbo.Usuarios u LEFT JOIN dbo.Puntajes p ON u.IdUsuario=p.IdUsuario
            WHERE u.Activo=1 AND u.IdUsuario != 1
            ORDER BY Puntos DESC, Aciertos DESC, u.Nombre ASC
        `);

        const rows = result.recordset;
        let rank = 1;
        for (let i = 0; i < rows.length; i++) {
            if (i > 0 && (rows[i].Puntos !== rows[i-1].Puntos || rows[i].Aciertos !== rows[i-1].Aciertos)) rank = i+1;
            await pool.request()
                .input('IdUsuario',        sql.Int, rows[i].IdUsuario)
                .input('PosicionAnterior', sql.Int, rank)
                .query(`
                    IF EXISTS (SELECT 1 FROM dbo.Puntajes WHERE IdUsuario=@IdUsuario)
                        UPDATE dbo.Puntajes SET PosicionAnterior=@PosicionAnterior WHERE IdUsuario=@IdUsuario
                    ELSE
                        INSERT INTO dbo.Puntajes (IdUsuario,PuntosTotales,PosicionAnterior) VALUES (@IdUsuario,0,@PosicionAnterior)
                `);
        }
        console.log('✅ Posiciones guardadas como anteriores.');
    } catch (err) { console.error('❌ Error posiciones anteriores:', err.message); }
}

// ─── RECALCULAR PUNTOS ────────────────────────────────────────────────────────
async function recalcularPuntosTotales(pool) {
    try {
        console.log('🔄 Recalculando puntos totales...');
        await guardarPosicionesActualesComoAnteriores(pool);

        const pros = await pool.request().query(`
            SELECT p.IdUsuario, p.GolesLocal AS ProLocal, p.GolesVisitante AS ProVisitante,
                   r.GolesLocal AS RealLocal, r.GolesVisitante AS RealVisitante
            FROM dbo.Pronosticos p INNER JOIN dbo.ResultadosReales r ON p.PartidoId=r.PartidoId
        `);

        const todosUsers = await pool.request().query(`SELECT IdUsuario FROM dbo.Usuarios WHERE Activo=1`);
        const mapaPuntos = {};
        todosUsers.recordset.forEach(u => { mapaPuntos[u.IdUsuario] = 0; });

        pros.recordset.forEach(row => {
            const id = row.IdUsuario;
            if (row.ProLocal===row.RealLocal && row.ProVisitante===row.RealVisitante) mapaPuntos[id]+=5;
            else if (row.ProLocal===row.ProVisitante && row.RealLocal===row.RealVisitante) mapaPuntos[id]+=1;
            else if ((row.ProLocal>row.ProVisitante&&row.RealLocal>row.RealVisitante)||(row.ProLocal<row.ProVisitante&&row.RealLocal<row.RealVisitante)) mapaPuntos[id]+=3;
        });

        const campeon = await pool.request().query(`SELECT TOP 1 * FROM dbo.ResultadoCampeon ORDER BY IdResultado DESC`);
        if (campeon.recordset.length > 0) {
            const { SeleccionCampeon, GolesLocal:cRL, GolesVisitante:cRV } = campeon.recordset[0];
            const prosCampeon = await pool.request().query(`SELECT * FROM dbo.PronosticosCampeon`);
            prosCampeon.recordset.forEach(pc => {
                if (!mapaPuntos[pc.IdUsuario]) mapaPuntos[pc.IdUsuario]=0;
                if (pc.SeleccionCampeon.toLowerCase()===SeleccionCampeon.toLowerCase() && pc.GolesLocal===cRL && pc.GolesVisitante===cRV) mapaPuntos[pc.IdUsuario]+=25;
                else if (pc.SeleccionCampeon.toLowerCase()===SeleccionCampeon.toLowerCase()) mapaPuntos[pc.IdUsuario]+=15;
            });
        }

        for (const id in mapaPuntos) {
            await pool.request()
                .input('IdUsuario',     sql.Int, parseInt(id))
                .input('PuntosTotales', sql.Int, mapaPuntos[id])
                .query(`
                    IF EXISTS (SELECT 1 FROM dbo.Puntajes WHERE IdUsuario=@IdUsuario)
                        UPDATE dbo.Puntajes SET PuntosTotales=@PuntosTotales WHERE IdUsuario=@IdUsuario
                    ELSE
                        INSERT INTO dbo.Puntajes (IdUsuario,PuntosTotales) VALUES (@IdUsuario,@PuntosTotales)
                `);
        }
        console.log('✅ Puntos recalculados.');
    } catch (err) { console.error('❌ Error recalcular puntos:', err.message); }
}

// ─── CARGAR PARTIDOS ──────────────────────────────────────────────────────────
function cargarTodosLosPartidos() {
    let todos = [];
    const paths = [
        path.join(__dirname,'data','partidos.json'),
        path.join(__dirname,'data','eliminatorios.json')
    ];
    paths.forEach(p => { if (fs.existsSync(p)) todos = todos.concat(JSON.parse(fs.readFileSync(p,'utf8'))); });
    return todos;
}

// ─── SINCRONIZAR RESULTADOS ───────────────────────────────────────────────────
async function sincronizarResultados() {
    console.log(`[${new Date().toLocaleTimeString()}] 🔄 Sincronizando desde Football-Data.org...`);
    if (!API_KEY) { console.warn('⚠️ Sin API Key. Sincronización omitida.'); return; }

    try {
        const pool             = await poolPromise;
        const todosLosPartidos = cargarTodosLosPartidos();

        const dateNow  = new Date();
        const dateAyer = new Date(); dateAyer.setDate(dateNow.getDate()-1);
        const dateFrom = dateAyer.toISOString().split('T')[0];
        const dateTo   = dateNow.toISOString().split('T')[0];

        const response = await fetch(
            `${API_URL}/competitions/WC/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
            { headers: { 'X-Auth-Token': API_KEY } }
        );
        const data = await response.json();

        if (data.errors || data.message) { console.error('API Error:', data.message || data.errors); return; }
        if (!data.matches || data.matches.length === 0) { console.log('Sin partidos en rango.'); return; }

        let hayCambios = false;

        for (const match of data.matches) {
            if (match.status !== 'FINISHED') continue;

            const golesLocal     = match.score.fullTime.home;
            const golesVisitante = match.score.fullTime.away;
            const nombreLocal    = match.homeTeam.name;
            const nombreVisitante = match.awayTeam.name;
            const localAPI       = obtenerNombreNormalizado(nombreLocal);
            const visitanteAPI   = obtenerNombreNormalizado(nombreVisitante);

            let esInvertido = false;
            const partido = todosLosPartidos.find(p => {
                const lJ = normalizarTexto(p.local), vJ = normalizarTexto(p.visitante);
                if ((lJ.includes(localAPI)||localAPI.includes(lJ)) && (vJ.includes(visitanteAPI)||visitanteAPI.includes(vJ))) { esInvertido=false; return true; }
                if ((lJ.includes(visitanteAPI)||visitanteAPI.includes(lJ)) && (vJ.includes(localAPI)||localAPI.includes(vJ))) { esInvertido=true; return true; }
                return false;
            });

            if (partido) {
                const partidoId  = partido.id;
                const glFinal    = esInvertido ? golesVisitante : golesLocal;
                const gvFinal    = esInvertido ? golesLocal     : golesVisitante;

                // Verificar si ya existe en ResultadosReales
                const yaReal = await pool.request()
                    .input('PartidoId', sql.Int, partidoId)
                    .query(`SELECT PartidoId FROM dbo.ResultadosReales WHERE PartidoId=@PartidoId`);
                if (yaReal.recordset.length > 0) {
                    console.log(`Partido #${partidoId} ya validado. Omitiendo.`);
                    continue;
                }

                console.log(`⚡ Auto-validando #${partidoId}: ${partido.local} vs ${partido.visitante} (${glFinal}-${gvFinal})`);

                // Insertar resultado real
                await pool.request()
                    .input('PartidoId',      sql.Int, partidoId)
                    .input('GolesLocal',     sql.Int, glFinal)
                    .input('GolesVisitante', sql.Int, gvFinal)
                    .query(`
                        IF EXISTS (SELECT 1 FROM dbo.ResultadosReales WHERE PartidoId=@PartidoId)
                            UPDATE dbo.ResultadosReales SET GolesLocal=@GolesLocal, GolesVisitante=@GolesVisitante WHERE PartidoId=@PartidoId
                        ELSE
                            INSERT INTO dbo.ResultadosReales (PartidoId,GolesLocal,GolesVisitante) VALUES (@PartidoId,@GolesLocal,@GolesVisitante)
                    `);

                // Registrar en pendientes como ya validado
                const yaPendiente = await pool.request()
                    .input('FixtureId', sql.Int, match.id)
                    .query(`SELECT IdPendiente FROM dbo.ResultadosPendientes WHERE FixtureId=@FixtureId`);

                if (yaPendiente.recordset.length > 0) {
                    await pool.request()
                        .input('PartidoId',      sql.Int, partidoId)
                        .input('GolesLocal',     sql.Int, glFinal)
                        .input('GolesVisitante', sql.Int, gvFinal)
                        .input('FixtureId',      sql.Int, match.id)
                        .query(`UPDATE dbo.ResultadosPendientes SET Validado=1, FechaValidacion=GETDATE(), PartidoId=@PartidoId, GolesLocal=@GolesLocal, GolesVisitante=@GolesVisitante WHERE FixtureId=@FixtureId`);
                } else {
                    await pool.request()
                        .input('FixtureId',        sql.Int,          match.id)
                        .input('LocalNombre',      sql.NVarChar(100), nombreLocal)
                        .input('VisitanteNombre',  sql.NVarChar(100), nombreVisitante)
                        .input('GolesLocal',       sql.Int,          golesLocal)
                        .input('GolesVisitante',   sql.Int,          golesVisitante)
                        .input('FechaPartido',     sql.DateTime,     new Date(match.utcDate))
                        .input('PartidoId',        sql.Int,          partidoId)
                        .query(`INSERT INTO dbo.ResultadosPendientes (FixtureId,LocalNombre,VisitanteNombre,GolesLocal,GolesVisitante,FechaPartido,Validado,FechaValidacion,PartidoId)
                                VALUES (@FixtureId,@LocalNombre,@VisitanteNombre,@GolesLocal,@GolesVisitante,@FechaPartido,1,GETDATE(),@PartidoId)`);
                }

                await log(pool, { idUsuario:1, accion:'marcador_final_registrado', partidoId, detalle:`${partido.local} ${glFinal} - ${gvFinal} ${partido.visitante} (Auto-validado)`, exito:true });

                // Enviar correos de resultado
                const pros = await pool.request()
                    .input('PartidoId', sql.Int, partidoId)
                    .query(`
                        SELECT p.IdUsuario, p.GolesLocal AS ProLocal, p.GolesVisitante AS ProVisitante, u.Nombre, u.Correo
                        FROM dbo.Pronosticos p INNER JOIN dbo.Usuarios u ON p.IdUsuario=u.IdUsuario
                        WHERE p.PartidoId=@PartidoId AND u.Correo IS NOT NULL AND u.Correo!=''
                    `);
                for (const pro of pros.recordset) {
                    let puntos=0, estado='Falló';
                    if (pro.ProLocal===glFinal && pro.ProVisitante===gvFinal) { puntos=5; estado='Exacto'; }
                    else if (pro.ProLocal===pro.ProVisitante && glFinal===gvFinal) { puntos=1; estado='Acierto'; }
                    else if ((pro.ProLocal>pro.ProVisitante&&glFinal>gvFinal)||(pro.ProLocal<pro.ProVisitante&&glFinal<gvFinal)) { puntos=3; estado='Acierto'; }
                    await enviarCorreoResultado({ correo:pro.Correo, nombre:pro.Nombre, local:partido.local, visitante:partido.visitante, golesLocal:glFinal, golesVisitante:gvFinal, proLocal:pro.ProLocal, proVisitante:pro.ProVisitante, puntos, estado, idUsuario:pro.IdUsuario, partidoId });
                }

                hayCambios = true;

            } else {
                // Fallback: guardar como pendiente manual
                const yaExiste = await pool.request()
                    .input('LocalNombre',     sql.NVarChar(100), nombreLocal)
                    .input('VisitanteNombre', sql.NVarChar(100), nombreVisitante)
                    .query(`SELECT IdPendiente FROM dbo.ResultadosPendientes WHERE LocalNombre=@LocalNombre AND VisitanteNombre=@VisitanteNombre`);
                if (yaExiste.recordset.length > 0) { console.log(`Ya existe pendiente: ${nombreLocal} vs ${nombreVisitante}`); continue; }

                await pool.request()
                    .input('FixtureId',       sql.Int,          match.id)
                    .input('LocalNombre',     sql.NVarChar(100), nombreLocal)
                    .input('VisitanteNombre', sql.NVarChar(100), nombreVisitante)
                    .input('GolesLocal',      sql.Int,          golesLocal)
                    .input('GolesVisitante',  sql.Int,          golesVisitante)
                    .input('FechaPartido',    sql.DateTime,     new Date(match.utcDate))
                    .query(`INSERT INTO dbo.ResultadosPendientes (FixtureId,LocalNombre,VisitanteNombre,GolesLocal,GolesVisitante,FechaPartido,Validado)
                            VALUES (@FixtureId,@LocalNombre,@VisitanteNombre,@GolesLocal,@GolesVisitante,@FechaPartido,0)`);

                await log(pool, { accion:'pendiente_sincronizado', detalle:`Requiere mapeo manual: ${nombreLocal} ${golesLocal}-${golesVisitante} ${nombreVisitante}`, exito:true });
                console.log(`✅ Pendiente manual: ${nombreLocal} ${golesLocal}-${golesVisitante} ${nombreVisitante}`);
            }
        }

        if (hayCambios) await recalcularPuntosTotales(pool);

    } catch (err) { console.error('Error sincronizar:', err.message); }
}

// ─── ENVIAR PRONÓSTICOS ANTES DEL PARTIDO ────────────────────────────────────
async function enviarPronosticosAntesDePartido() {
    console.log(`[${new Date().toLocaleTimeString()}] 📧 Chequeando envío pronósticos al admin...`);
    try {
        const pool             = await poolPromise;
        const todosLosPartidos = cargarTodosLosPartidos();
        const ahora            = Date.now();

        for (const match of todosLosPartidos) {
            if (!match.id || !match.fecha || !match.hora) continue;
            const horaLimpia   = match.hora.replace(' hrs','');
            const fechaPartido = new Date(`${match.fecha} ${horaLimpia}:00 GMT-0600`);
            const msHasta      = fechaPartido.getTime() - ahora;

            // 5 minutos después de iniciado, hasta 60 minutos
            if (msHasta > -5*60*1000 || msHasta < -60*60*1000) continue;

            const yaEnviado = await pool.request()
                .input('PartidoId', sql.Int, match.id)
                .query(`SELECT TOP 1 IdLog FROM dbo.LogsActividad WHERE Accion='correo_pronosticos_enviado' AND PartidoId=@PartidoId`);
            if (yaEnviado.recordset.length > 0) continue;

            console.log(`📧 Enviando pronósticos del partido #${match.id}: ${match.local} vs ${match.visitante}...`);

            const result = await pool.request()
                .input('PartidoId', sql.Int, match.id)
                .query(`
                    SELECT u.Nombre AS [Usuario], u.Correo, p.PartidoId, p.GolesLocal AS PronosticoLocal,
                           p.GolesVisitante AS PronosticoVisitante, ISNULL(pd.ModificacionesUsadas,0) AS Modificaciones
                    FROM dbo.Pronosticos p
                    INNER JOIN dbo.Usuarios u ON p.IdUsuario=u.IdUsuario
                    LEFT JOIN dbo.PartidosDesbloqueados pd ON pd.IdUsuario=p.IdUsuario AND pd.PartidoId=p.PartidoId
                    WHERE p.PartidoId=@PartidoId AND u.Activo=1
                    ORDER BY u.Nombre ASC
                `);

            // Destinatarios: todos los usuarios activos con correo
            const destResult = await pool.request().query(`
                SELECT IdUsuario AS id_usuario, Nombre AS nombre, Correo AS correo
                FROM dbo.Usuarios WHERE Activo=1 AND Correo IS NOT NULL AND LEN(TRIM(Correo))>0
            `);
            const destinatarios = destResult.recordset;

            // Asegurar correo soporte
            const soporte = 'jorge.galaviz@glacy.marketing';
            if (!destinatarios.some(r => r.correo.toLowerCase() === soporte))
                destinatarios.push({ id_usuario:2, nombre:'Soporte', correo:soporte });

            // Generar CSV
            let csv = "\uFEFFUsuario,Correo,Partido #,Partido,Pronóstico Local,Pronóstico Visitante,Modificaciones\n";
            const esc = s => `"${String(s||'').replace(/"/g,'""')}"`;
            for (const row of result.recordset) {
                csv += `${esc(row.Usuario)},${esc(row.Correo)},${row.PartidoId},${esc(`${match.local} vs ${match.visitante}`)},${row.PronosticoLocal},${row.PronosticoVisitante},${row.Modificaciones}\n`;
            }

            // Ranking top 10 para gráfica
            const rankRes = await pool.request().query(`
                SELECT TOP 10 u.Nombre, COALESCE(p.PuntosTotales,0) AS Puntos
                FROM dbo.Usuarios u LEFT JOIN dbo.Puntajes p ON u.IdUsuario=p.IdUsuario
                WHERE u.Activo=1 AND u.IdUsuario!=1
                ORDER BY Puntos DESC, u.Nombre ASC
            `);
            const topUsers = rankRes.recordset;

            // QuickChart ranking
            let rankingChartUrl = null;
            if (topUsers.length > 0) {
                const chartConfig = {
                    type:'horizontalBar',
                    data:{ labels:topUsers.map(u=>u.Nombre), datasets:[{ data:topUsers.map(u=>u.Puntos), backgroundColor:'#2ecc71', borderWidth:0, barPercentage:0.7 }] },
                    options:{ legend:{display:false}, title:{display:true,text:'🏆 RANKING ACTUAL - TOP 10',fontColor:'#ffffff',fontSize:18}, scales:{ xAxes:[{ticks:{fontColor:'#b8c2d6',beginAtZero:true},gridLines:{color:'rgba(255,255,255,.08)'}}], yAxes:[{ticks:{fontColor:'#ffffff',fontSize:12},gridLines:{display:false}}] } }
                };
                rankingChartUrl = `https://quickchart.io/chart?w=600&h=400&bkg=%2305101a&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
            }

            // QuickChart tabla pronósticos
            let predictionsChartUrl = null;
            if (result.recordset.length > 0) {
                const tableConfig = {
                    title:`PRONÓSTICOS: ${match.local.toUpperCase()} VS ${match.visitante.toUpperCase()}`,
                    columns:[
                        {title:"Usuario",dataIndex:"Usuario",width:180},
                        {title:"Correo",dataIndex:"Correo",width:220},
                        {title:"Pronóstico",dataIndex:"Pronostico",width:100,align:"center"},
                        {title:"Cambios",dataIndex:"Cambios",width:80,align:"center"}
                    ],
                    dataSource:result.recordset.map(r=>({ Usuario:r.Usuario, Correo:r.Correo, Pronostico:`${r.PronosticoLocal} - ${r.PronosticoVisitante}`, Cambios:String(r.Modificaciones) })),
                    options:{ backgroundColor:"#ffffff", fontFamily:"sans-serif", paddingVertical:15, paddingHorizontal:15 }
                };
                predictionsChartUrl = `https://api.quickchart.io/v1/table?data=${encodeURIComponent(JSON.stringify(tableConfig))}`;
            }

            const attachments = [{ filename:`Pronosticos_Partido_${match.id}.csv`, content:csv, contentType:'text/csv; charset=utf-8' }];
            if (rankingChartUrl)     attachments.push({ filename:'Ranking_Top_10.png',      path:rankingChartUrl });
            if (predictionsChartUrl) attachments.push({ filename:`Pronosticos_Partido_${match.id}.png`, path:predictionsChartUrl });

            for (const user of destinatarios) {
                const html = `
                <div style="font-family:sans-serif;max-width:700px;margin:0 auto;background:#05101a;color:white;border-radius:16px;overflow:hidden;border:1px solid #1f2d3d;">
                    <div style="background:linear-gradient(135deg,#16883f,#0b5229);padding:1.5rem;text-align:center;">
                        <h1 style="margin:0;font-size:1.8rem;">⚽ Pronósticos del Partido</h1>
                        <p style="margin:5px 0 0;color:#e8f5e9;">${match.local} vs ${match.visitante}</p>
                    </div>
                    <div style="padding:1.5rem;">
                        <p>Hola <strong>${escapeHTML(user.nombre)}</strong>,</p>
                        <p>A continuación los pronósticos para <strong>${match.local} vs ${match.visitante}</strong> (#${match.id}) — <strong>${match.fecha} ${match.hora}</strong>.</p>
                        <table style="width:100%;border-collapse:collapse;color:white;font-size:.9rem;">
                            <thead><tr style="background:rgba(255,255,255,.08);"><th style="padding:10px;">Usuario</th><th style="padding:10px;text-align:center;">Pronóstico</th><th style="padding:10px;text-align:center;">Cambios</th></tr></thead>
                            <tbody>
                                ${result.recordset.length===0 ? '<tr><td colspan="3" style="padding:20px;text-align:center;color:#b8c2d6;">Sin pronósticos aún.</td></tr>' :
                                  result.recordset.map((row,i) => `<tr style="background:${i%2===0?'rgba(255,255,255,.02)':'rgba(255,255,255,.05)'};border-bottom:1px solid rgba(255,255,255,.05);">
                                    <td style="padding:10px;">${escapeHTML(row.Usuario)}</td>
                                    <td style="padding:10px;text-align:center;font-weight:bold;color:#2ecc71;">${row.PronosticoLocal} - ${row.PronosticoVisitante}</td>
                                    <td style="padding:10px;text-align:center;color:#f1c40f;">${row.Modificaciones}</td>
                                  </tr>`).join('')}
                            </tbody>
                        </table>
                        ${rankingChartUrl ? `<div style="margin:2rem 0;text-align:center;"><img src="${rankingChartUrl}" style="max-width:100%;border-radius:12px;" /></div>` : ''}
                    </div>
                    <div style="background:rgba(0,0,0,.3);padding:1rem;text-align:center;"><small style="color:#b8c2d6;">Quiniela Mundial 2026 — torreslab</small></div>
                </div>`;
                try {
                    await transporter.sendMail({ from:process.env.EMAIL_FROM, to:user.correo, subject:`📋 Pronósticos: ${match.local} vs ${match.visitante} (#${match.id})`, html, attachments });
                    await log(pool, { idUsuario:user.id_usuario, accion:'correo_pronosticos_enviado', partidoId:match.id, detalle:`Pronósticos enviados a ${user.correo}`, exito:true });
                } catch (err) {
                    console.error(`❌ Error correo pronósticos a ${user.correo}:`, err.message);
                    await log(pool, { idUsuario:user.id_usuario, accion:'correo_pronosticos_enviado', partidoId:match.id, detalle:`Fallo a ${user.correo}: ${err.message}`, exito:false, errorMessage:err.message });
                }
            }
            console.log(`✅ Pronósticos del partido #${match.id} enviados.`);
        }
    } catch (err) { console.error('❌ Error enviarPronosticosAntesDePartido:', err.message); }
}

// ─── ALERTA PRONÓSTICOS FALTANTES ────────────────────────────────────────────
async function enviarAlertaPronosticosFaltantes() {
    console.log(`[${new Date().toLocaleTimeString()}] 📧 Chequeando pronósticos faltantes...`);
    try {
        const pool             = await poolPromise;
        const todosLosPartidos = cargarTodosLosPartidos();
        const ahora            = Date.now();

        for (const match of todosLosPartidos) {
            if (!match.id || !match.fecha || !match.hora) continue;
            const horaLimpia   = match.hora.replace(' hrs','');
            const fechaPartido = new Date(`${match.fecha} ${horaLimpia}:00 GMT-0600`);
            const msHasta      = fechaPartido.getTime() - ahora;

            // Entre 5 y 15 minutos antes
            if (msHasta < 5*60*1000 || msHasta > 15*60*1000) continue;

            const yaEnviado = await pool.request()
                .input('PartidoId', sql.Int, match.id)
                .query(`SELECT TOP 1 IdLog FROM dbo.LogsActividad WHERE Accion='alerta_pronosticos_faltantes_enviada' AND PartidoId=@PartidoId`);
            if (yaEnviado.recordset.length > 0) continue;

            // Usuarios sin pronóstico
            const missingRes = await pool.request()
                .input('PartidoId', sql.Int, match.id)
                .query(`
                    SELECT IdUsuario AS id_usuario, Nombre AS nombre, Correo AS correo
                    FROM dbo.Usuarios
                    WHERE Activo=1 AND IdUsuario!=1
                      AND IdUsuario NOT IN (SELECT IdUsuario FROM dbo.Pronosticos WHERE PartidoId=@PartidoId)
                    ORDER BY Nombre ASC
                `);
            const faltantes = missingRes.recordset;
            if (faltantes.length === 0) { console.log(`ℹ️ Todos tienen pronóstico para #${match.id}.`); continue; }

            console.log(`📧 Alerta: ${faltantes.length} sin pronóstico para #${match.id}...`);

            // Destinatarios admin
            const adminsRes = await pool.request().query(`
                SELECT Correo FROM dbo.Usuarios WHERE IdUsuario IN (1,2,3) AND Activo=1 AND Correo IS NOT NULL AND LEN(TRIM(Correo))>0
            `);
            const destEmails = adminsRes.recordset.map(r=>r.Correo);
            const soporte    = 'jorge.galaviz@glacy.marketing';
            if (!destEmails.some(e=>e.toLowerCase()===soporte)) destEmails.push(soporte);

            const html = `
            <div style="font-family:sans-serif;max-width:700px;margin:0 auto;background:#05101a;color:white;border-radius:16px;overflow:hidden;">
                <div style="background:linear-gradient(135deg,#e74c3c,#c0392b);padding:1.5rem;text-align:center;">
                    <h1 style="margin:0;color:white;">⚠️ Pronósticos Faltantes</h1>
                    <p style="margin:5px 0 0;color:#fce4ec;">${match.local} vs ${match.visitante}</p>
                </div>
                <div style="padding:1.5rem;">
                    <p>El partido <strong>${match.local} vs ${match.visitante}</strong> (#${match.id}) comienza en ~10 minutos (<strong>${match.fecha} ${match.hora}</strong>).</p>
                    <p><strong>${faltantes.length} participantes</strong> sin pronóstico:</p>
                    <ul style="color:#f1c40f;">
                        ${faltantes.map(u=>`<li><strong>${escapeHTML(u.nombre)}</strong> (${escapeHTML(u.correo)})</li>`).join('')}
                    </ul>
                </div>
                <div style="background:rgba(0,0,0,.3);padding:1rem;text-align:center;"><small style="color:#b8c2d6;">Quiniela Mundial 2026 — torreslab</small></div>
            </div>`;

            for (const email of destEmails) {
                try {
                    await transporter.sendMail({ from:process.env.EMAIL_FROM, to:email, subject:`⚠️ Pronósticos faltantes: ${match.local} vs ${match.visitante}`, html });
                } catch (err) { console.error(`❌ Error alerta a ${email}:`, err.message); }
            }

            await log(pool, { idUsuario:1, accion:'alerta_pronosticos_faltantes_enviada', partidoId:match.id, detalle:`Alerta ${faltantes.length} faltantes para #${match.id}`, exito:true });
            console.log(`✅ Alerta enviada para partido #${match.id}.`);
        }
    } catch (err) { console.error('❌ Error alertas faltantes:', err.message); }
}

// ─── CRON JOBS ────────────────────────────────────────────────────────────────
if (API_KEY) {
    cron.schedule('*/5 * * * *', sincronizarResultados);
    console.log('🕐 Cron sincronización iniciado (cada 5 min).');
} else {
    console.log('⚠️ Sin API Key — cron de sincronización no iniciado.');
}

cron.schedule('*/5 * * * *', enviarPronosticosAntesDePartido);
console.log('🕐 Cron pronósticos antes de partido iniciado (cada 5 min).');

// cron.schedule('*/5 * * * *', enviarAlertaPronosticosFaltantes);
console.log('🕐 Cron alertas faltantes iniciado (cada 5 min).');

// Ejecutar al arrancar
(async () => {
    await sincronizarResultados();
    await enviarPronosticosAntesDePartido();
})();

module.exports = { sincronizarResultados, enviarPronosticosAntesDePartido };