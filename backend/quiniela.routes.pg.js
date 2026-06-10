const express    = require('express');
const router     = express.Router();
const { z }      = require('zod');
const nodemailer = require('nodemailer');
const { pool }   = require('./db.pg');          // ← pg pool
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');

let partidos = [];
try {
    const dataPath = path.join(__dirname, 'data', 'partidos.json');
    partidos = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
} catch (err) {
    console.error('Error al cargar partidos.json en el backend:', err);
}

// ─── HELPER QUERY ─────────────────────────────────────────────────────────────
// Convierte llamadas estilo mssql a pg transparentemente
async function query(text, params = []) {
    const client = await pool.connect();
    try {
        const res = await client.query(text, params);
        return res.rows;
    } finally {
        client.release();
    }
}

// ─── LOG ACTIVIDAD ────────────────────────────────────────────────────────────
async function registrarLogActividad({ idUsuario, accion, partidoId, detalle, exito, errorMessage }) {
    try {
        await query(
            `INSERT INTO logs_actividad (id_usuario,accion,partido_id,detalle,exito,error_message)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [idUsuario || null, accion, partidoId || null, detalle || null, exito ?? true, errorMessage || null]
        );
    } catch (err) {
        console.error('❌ Error al registrar log:', err);
    }
}

// ─── SELLAR PRONÓSTICO ────────────────────────────────────────────────────────
async function sellarPronostico(idUsuario, partidoId, golesLocal, golesVisitante) {
    const fecha = new Date();
    const data  = `${idUsuario}|${partidoId}|${golesLocal}|${golesVisitante}|${fecha.toISOString()}`;
    const hash  = crypto.createHmac('sha256', process.env.ADMIN_SECRET || 'default-admin-secret-2026-torreslab')
                        .update(data).digest('hex');
    await query(
        `UPDATE pronosticos
         SET fecha_registro      = CASE WHEN fecha_registro IS NULL THEN $3 ELSE fecha_registro END,
             fecha_actualizacion = $3,
             hash_integridad     = $4,
             modificado_por      = NULL
         WHERE id_usuario = $1 AND partido_id = $2`,
        [idUsuario, partidoId, fecha, hash]
    );
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function validarTokenAdmin(req, res, next) {
    const token = req.headers['x-admin-token'] || req.query.adminToken;
    if (!token) return res.status(401).json({ ok: false, message: 'No autorizado.' });
    const secret        = process.env.ADMIN_SECRET || 'default-admin-secret-2026-torreslab';
    const expectedToken = crypto.createHmac('sha256', secret).update('1').digest('hex');
    if (token !== expectedToken) return res.status(401).json({ ok: false, message: 'Acceso denegado.' });
    next();
}

function validarTokenUsuario(req, res, next) {
    let idUsuario = req.params.idUsuario || req.body.idUsuario || req.query.idUsuario;
    if (!idUsuario) return res.status(400).json({ ok: false, message: 'Falta ID de usuario.' });
    idUsuario = parseInt(idUsuario);
    const token = req.headers['x-user-token'];
    if (!token) return res.status(401).json({ ok: false, message: 'No autorizado. Falta token.' });
    const secret        = process.env.ADMIN_SECRET || 'default-admin-secret-2026-torreslab';
    const expectedToken = crypto.createHmac('sha256', secret).update(String(idUsuario)).digest('hex');
    if (token !== expectedToken) return res.status(403).json({ ok: false, message: 'Token inválido.' });
    next();
}

router.use('/admin', validarTokenAdmin);

// ─── NODEMAILER ───────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

async function enviarCorreoResultado({ correo, nombre, local, visitante, golesLocal, golesVisitante, proLocal, proVisitante, puntos, estado, asunto, htmlPersonalizado }) {
    const emojis = { 'Exacto':'🎯', 'Acierto':'✅', 'Falló':'❌', 'Pendiente':'⏳' };
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
    await transporter.sendMail({
        from:    process.env.EMAIL_FROM,
        to:      correo,
        subject: asunto || `${emoji} Resultado: ${local} ${golesLocal}-${golesVisitante} ${visitante} | Quiniela 2026`,
        html
    });
}

// ─── SCHEMAS ──────────────────────────────────────────────────────────────────
const quinielaSchema = z.object({
    idUsuario:   z.number().int().positive(),
    pronosticos: z.array(z.object({
        partidoId:      z.number().int().min(1),
        golesLocal:     z.number().int().min(0).max(50),
        golesVisitante: z.number().int().min(0).max(50)
    })).nonempty()
});

const resultadoRealSchema = z.object({
    partidoId:      z.number().int().min(1),
    golesLocal:     z.number().int().min(0).max(50),
    golesVisitante: z.number().int().min(0).max(50)
});

const campeonSchema = z.object({
    idUsuario:        z.number().int().positive(),
    seleccionCampeon: z.string().min(2).max(100).trim(),
    golesLocal:       z.number().int().min(0).max(50),
    golesVisitante:   z.number().int().min(0).max(50)
});

// ─── GUARDAR QUINIELA ─────────────────────────────────────────────────────────
router.post('/guardar-quiniela', validarTokenUsuario, async (req, res) => {
    let idUsuario;
    try {
        const body = req.body;
        idUsuario  = body.idUsuario;
        const { pronosticos } = body;

        const sub = await query(
            `SELECT id_suscripcion FROM suscripciones WHERE id_usuario=$1 AND activa=true`,
            [idUsuario]
        );
        if (sub.length === 0) {
            const errMsg = '⛔ No tienes suscripción activa.';
            await registrarLogActividad({ idUsuario, accion:'guardar_quiniela', detalle:'Sin suscripción activa', exito:false, errorMessage:errMsg });
            return res.status(403).json({ ok: false, message: errMsg });
        }

        let errores = [], guardados = 0;

        for (const pro of pronosticos) {
            const partido = partidos.find(p => p.id === pro.partidoId);
            if (!partido) {
                const errMsg = `Partido #${pro.partidoId} no encontrado.`;
                errores.push(errMsg);
                await registrarLogActividad({ idUsuario, accion:'guardar_quiniela', partidoId:pro.partidoId, detalle:`Pronóstico: ${pro.golesLocal}-${pro.golesVisitante}`, exito:false, errorMessage:errMsg });
                continue;
            }

            const horaLimpia   = partido.hora.replace(' hrs', '');
            const fechaPartido = new Date(`${partido.fecha} ${horaLimpia}:00 GMT-0600`);
            if (fechaPartido.getTime() - Date.now() <= 0) {
                const errMsg = 'El partido ya comenzó.';
                errores.push(`Partido #${pro.partidoId} (${partido.local} vs ${partido.visitante}) ${errMsg}`);
                await registrarLogActividad({ idUsuario, accion:'guardar_quiniela', partidoId:pro.partidoId, detalle:`Pronóstico: ${pro.golesLocal}-${pro.golesVisitante}`, exito:false, errorMessage:errMsg });
                continue;
            }

            const desbloq = await query(
                `SELECT id_desbloqueo, modificaciones_usadas FROM partidos_desbloqueados
                 WHERE id_usuario=$1 AND partido_id=$2`,
                [idUsuario, pro.partidoId]
            );

            let modUsadas = 0, idDesbloqueo = null;
            if (desbloq.length > 0) {
                modUsadas    = desbloq[0].modificaciones_usadas;
                idDesbloqueo = desbloq[0].id_desbloqueo;
            }

            if (modUsadas >= 3) {
                const errMsg = 'Agotaste tus 3 modificaciones.';
                errores.push(`Partido #${pro.partidoId}: ${errMsg}`);
                await registrarLogActividad({ idUsuario, accion:'guardar_quiniela', partidoId:pro.partidoId, detalle:`Pronóstico: ${pro.golesLocal}-${pro.golesVisitante}`, exito:false, errorMessage:errMsg });
                continue;
            }

            // Guardar pronóstico — UPSERT en pg
            await query(
                `INSERT INTO pronosticos (id_usuario, partido_id, goles_local, goles_visitante)
                 VALUES ($1,$2,$3,$4)
                 ON CONFLICT (id_usuario, partido_id)
                 DO UPDATE SET goles_local=$3, goles_visitante=$4`,
                [idUsuario, pro.partidoId, pro.golesLocal, pro.golesVisitante]
            );

            if (idDesbloqueo) {
                await query(
                    `UPDATE partidos_desbloqueados SET modificaciones_usadas=modificaciones_usadas+1
                     WHERE id_desbloqueo=$1`,
                    [idDesbloqueo]
                );
            } else {
                await query(
                    `INSERT INTO partidos_desbloqueados (id_usuario,partido_id,modificaciones_usadas,goles_gastados)
                     VALUES ($1,$2,1,0)`,
                    [idUsuario, pro.partidoId]
                );
            }

            await sellarPronostico(idUsuario, pro.partidoId, pro.golesLocal, pro.golesVisitante);
            await registrarLogActividad({ idUsuario, accion:'guardar_quiniela', partidoId:pro.partidoId, detalle:`Pronóstico: ${pro.golesLocal}-${pro.golesVisitante}`, exito:true });
            guardados++;
        }

        // Crear quiniela si no existe
        await query(
            `INSERT INTO quinielas (id_usuario, estatus) VALUES ($1,'Borrador')
             ON CONFLICT (id_usuario) DO NOTHING`,
            [idUsuario]
        );

        const desb = await query(
            `SELECT partido_id AS "PartidoId", modificaciones_usadas AS "ModificacionesUsadas",
                    goles_gastados AS "GolesGastados"
             FROM partidos_desbloqueados WHERE id_usuario=$1`,
            [idUsuario]
        );

        const msg = errores.length > 0 ? `⚠️ No se pudo guardar: ${errores.join(' | ')}` : `✅ Pronóstico guardado correctamente.`;
        return res.json({ ok: guardados > 0, message: msg, partidosDesbloqueados: desb });

    } catch (error) {
        console.error(error);
        await registrarLogActividad({ idUsuario, accion:'guardar_quiniela', exito:false, errorMessage:error.message });
        return res.status(400).json({ ok: false, message: 'Error al procesar.' });
    }
});

// ─── OBTENER QUINIELA ─────────────────────────────────────────────────────────
router.get('/obtener-quiniela/:idUsuario', validarTokenUsuario, async (req, res) => {
    try {
        const rows = await query(
            `SELECT partido_id AS "PartidoId", goles_local AS "GolesLocal", goles_visitante AS "GolesVisitante"
             FROM pronosticos WHERE id_usuario=$1`,
            [parseInt(req.params.idUsuario)]
        );
        return res.json({ ok: true, pronosticos: rows });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error al recuperar datos.' });
    }
});

// ─── MIS DATOS ────────────────────────────────────────────────────────────────
router.get('/mis-datos/:idUsuario', validarTokenUsuario, async (req, res) => {
    try {
        const idUsuario = parseInt(req.params.idUsuario);

        const sub = await query(
            `SELECT s.goles_restantes, p.nombre AS "Paquete", p.max_partidos AS "MaxPartidos", p.goles AS "GolesIniciales"
             FROM suscripciones s INNER JOIN paquetes p ON s.id_paquete=p.id_paquete
             WHERE s.id_usuario=$1 AND s.activa=true`,
            [idUsuario]
        );

        const desb = await query(
            `SELECT partido_id AS "PartidoId", modificaciones_usadas AS "ModificacionesUsadas",
                    goles_gastados AS "GolesGastados"
             FROM partidos_desbloqueados WHERE id_usuario=$1`,
            [idUsuario]
        );

        return res.json({ ok: true, suscripcion: sub[0] || null, partidosDesbloqueados: desb });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error al obtener datos.' });
    }
});

// ─── DESBLOQUEAR PARTIDO (DEPRECATED) ────────────────────────────────────────
router.post('/desbloquear-partido', async (req, res) => {
    return res.json({ ok: true, message: 'Desbloqueo automático activo.' });
});

// ─── GUARDAR RESULTADO OFICIAL ────────────────────────────────────────────────
router.post('/guardar-resultado', validarTokenAdmin, async (req, res) => {
    try {
        const { partidoId, golesLocal, golesVisitante, local, visitante } = req.body;
        resultadoRealSchema.parse({ partidoId, golesLocal, golesVisitante });

        await query(
            `INSERT INTO resultados_reales (partido_id, goles_local, goles_visitante)
             VALUES ($1,$2,$3)
             ON CONFLICT (partido_id)
             DO UPDATE SET goles_local=$2, goles_visitante=$3`,
            [partidoId, golesLocal, golesVisitante]
        );

        res.json({ ok: true, message: 'Resultado guardado. Enviando notificaciones...' });

        const pros = await query(
            `SELECT p.id_usuario, p.goles_local AS "ProLocal", p.goles_visitante AS "ProVisitante",
                    u.nombre AS "Nombre", u.correo AS "Correo"
             FROM pronosticos p INNER JOIN usuarios u ON p.id_usuario=u.id_usuario
             WHERE p.partido_id=$1 AND u.correo IS NOT NULL AND u.correo!=''`,
            [partidoId]
        );

        for (const pro of pros) {
            let puntos=0, estado='Falló';
            if (pro.ProLocal===golesLocal && pro.ProVisitante===golesVisitante) { puntos=5; estado='Exacto'; }
            else if (pro.ProLocal===pro.ProVisitante && golesLocal===golesVisitante) { puntos=1; estado='Acierto'; }
            else if ((pro.ProLocal>pro.ProVisitante&&golesLocal>golesVisitante)||(pro.ProLocal<pro.ProVisitante&&golesLocal<golesVisitante)) { puntos=3; estado='Acierto'; }
            enviarCorreoResultado({ correo:pro.Correo, nombre:pro.Nombre, local:local||'Local', visitante:visitante||'Visitante', golesLocal, golesVisitante, proLocal:pro.ProLocal, proVisitante:pro.ProVisitante, puntos, estado }).catch(console.error);
        }
    } catch (error) {
        console.error(error);
        return res.status(400).json({ ok: false, message: 'Error al guardar resultado.' });
    }
});

// ─── OBTENER RESULTADOS ───────────────────────────────────────────────────────
router.get('/obtener-resultados', async (req, res) => {
    try {
        const rows = await query(
            `SELECT partido_id AS "PartidoId", goles_local AS "GolesLocal", goles_visitante AS "GolesVisitante"
             FROM resultados_reales`
        );
        return res.json({ ok: true, resultados: rows });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── CALCULAR PUNTOS ──────────────────────────────────────────────────────────
router.post('/calcular-puntos', validarTokenAdmin, async (req, res) => {
    try {
        const pros = await query(
            `SELECT p.id_usuario, p.goles_local AS "ProLocal", p.goles_visitante AS "ProVisitante",
                    r.goles_local AS "RealLocal", r.goles_visitante AS "RealVisitante"
             FROM pronosticos p INNER JOIN resultados_reales r ON p.partido_id=r.partido_id`
        );

        const todosUsers = await query(`SELECT id_usuario FROM usuarios WHERE activo=true`);
        const mapaPuntos = {}, mapaAciertos = {};
        todosUsers.forEach(u => { mapaPuntos[u.id_usuario]=0; mapaAciertos[u.id_usuario]=0; });

        pros.forEach(row => {
            const id = row.id_usuario;
            if (row.ProLocal===row.RealLocal && row.ProVisitante===row.RealVisitante) { mapaPuntos[id]+=5; mapaAciertos[id]+=1; }
            else if (row.ProLocal===row.ProVisitante && row.RealLocal===row.RealVisitante) { mapaPuntos[id]+=1; mapaAciertos[id]+=1; }
            else if ((row.ProLocal>row.ProVisitante&&row.RealLocal>row.RealVisitante)||(row.ProLocal<row.ProVisitante&&row.RealLocal<row.RealVisitante)) { mapaPuntos[id]+=3; mapaAciertos[id]+=1; }
        });

        const campeon = await query(
            `SELECT * FROM resultado_campeon ORDER BY id_resultado DESC LIMIT 1`
        );
        if (campeon.length > 0) {
            const { seleccion_campeon, goles_local:cRL, goles_visitante:cRV } = campeon[0];
            const prosCampeon = await query(`SELECT * FROM pronosticos_campeon`);
            prosCampeon.forEach(pc => {
                if (!mapaPuntos[pc.id_usuario]) mapaPuntos[pc.id_usuario]=0;
                if (pc.seleccion_campeon.toLowerCase()===seleccion_campeon.toLowerCase() && pc.goles_local===cRL && pc.goles_visitante===cRV) mapaPuntos[pc.id_usuario]+=25;
                else if (pc.seleccion_campeon.toLowerCase()===seleccion_campeon.toLowerCase()) mapaPuntos[pc.id_usuario]+=15;
            });
        }

        for (const id in mapaPuntos) {
            await query(
                `INSERT INTO puntajes (id_usuario, puntos_totales) VALUES ($1,$2)
                 ON CONFLICT (id_usuario) DO UPDATE SET puntos_totales=$2`,
                [parseInt(id), mapaPuntos[id]]
            );
        }

        return res.json({ ok: true, message: '✅ Puntos recalculados.' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al calcular.' });
    }
});

// ─── TABLA GENERAL ────────────────────────────────────────────────────────────
router.get('/tabla-general', async (req, res) => {
    try {
        const rows = await query(
            `SELECT u.id_usuario AS "IdUsuario", u.nombre AS "Nombre", u.foto_url AS "FotoUrl",
                    COALESCE(p.puntos_totales,0) AS "Puntos",
                    DENSE_RANK() OVER (ORDER BY COALESCE(p.puntos_totales,0) DESC) AS "PosicionReal",
                    (SELECT COUNT(*) FROM pronosticos pr WHERE pr.id_usuario=u.id_usuario) AS "Predicciones",
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
             WHERE u.activo=true AND u.id_usuario != 1
             ORDER BY "Puntos" DESC, "Aciertos" DESC, u.nombre ASC`
        );
        return res.json({ ok: true, ranking: rows });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── MIS RESULTADOS ───────────────────────────────────────────────────────────
router.get('/mis-resultados/:idUsuario', validarTokenUsuario, async (req, res) => {
    try {
        const idUsuario = parseInt(req.params.idUsuario);

        const result = await query(
            `SELECT p.partido_id, p.goles_local AS "ProLocal", p.goles_visitante AS "ProVisitante",
                    r.goles_local AS "RealLocal", r.goles_visitante AS "RealVisitante"
             FROM pronosticos p LEFT JOIN resultados_reales r ON p.partido_id=r.partido_id
             WHERE p.id_usuario=$1`,
            [idUsuario]
        );

        const rankingQ = await query(
            `SELECT id_usuario, DENSE_RANK() OVER (ORDER BY COALESCE(puntos_totales,0) DESC) AS posicion
             FROM puntajes`
        );
        const miPos = rankingQ.find(u => u.id_usuario === idUsuario);

        let exactos=0, correctos=0, fallados=0, pendientes=0, puntos=0;
        const historial = result.map(row => {
            let pts=0, estado='Pendiente';
            if (row.RealLocal===null) { pendientes++; }
            else if (row.ProLocal===row.RealLocal&&row.ProVisitante===row.RealVisitante) { exactos++; pts=5; estado='Exacto'; }
            else if (row.ProLocal===row.ProVisitante&&row.RealLocal===row.RealVisitante) { correctos++; pts=1; estado='Acierto'; }
            else if ((row.ProLocal>row.ProVisitante&&row.RealLocal>row.RealVisitante)||(row.ProLocal<row.ProVisitante&&row.RealLocal<row.RealVisitante)) { correctos++; pts=3; estado='Acierto'; }
            else { fallados++; estado='Falló'; }
            puntos+=pts;
            return { partidoId:row.partido_id, pronostico:`${row.ProLocal} - ${row.ProVisitante}`, resultadoReal:row.RealLocal!==null?`${row.RealLocal} - ${row.RealVisitante}`:'Pendiente', puntos:pts, estado };
        });

        const completados = exactos+correctos+fallados;
        return res.json({
            ok: true,
            posicion: miPos ? `${miPos.posicion}° lugar` : '1° lugar',
            puntosTotales: puntos,
            aciertos: exactos+correctos,
            partidosJugados: completados,
            resumen: { marcadoresExactos:exactos, ganadoresCorrectos:correctos, fallados, pendientes },
            efectividad: `${completados>0?Math.round(((exactos+correctos)/completados)*100):0}%`,
            historial
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── CAMPEÓN ──────────────────────────────────────────────────────────────────
router.post('/campeon', validarTokenUsuario, async (req, res) => {
    let idUsuario=null, seleccion=null, gl=null, gv=null;
    try {
        const DEADLINE = new Date('2026-06-11T13:00:00 GMT-0600').getTime();
        const body = req.body;
        idUsuario = body?.idUsuario; seleccion = body?.seleccionCampeon; gl = body?.golesLocal; gv = body?.golesVisitante;

        if (Date.now() >= DEADLINE) {
            const errMsg = '⛔ El pronóstico de campeón ya está bloqueado.';
            await registrarLogActividad({ idUsuario, accion:'guardar_campeon', detalle:`Intento: ${seleccion} (${gl}-${gv})`, exito:false, errorMessage:errMsg });
            return res.status(403).json({ ok: false, message: errMsg });
        }

        const { idUsuario:valId, seleccionCampeon, golesLocal, golesVisitante } = campeonSchema.parse(req.body);

        await query(
            `INSERT INTO pronosticos_campeon (id_usuario, seleccion_campeon, goles_local, goles_visitante)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (id_usuario)
             DO UPDATE SET seleccion_campeon=$2, goles_local=$3, goles_visitante=$4, fecha_actualizacion=NOW()`,
            [valId, seleccionCampeon, golesLocal, golesVisitante]
        );

        await registrarLogActividad({ idUsuario:valId, accion:'guardar_campeon', detalle:`Campeón: ${seleccionCampeon} (${golesLocal}-${golesVisitante})`, exito:true });
        return res.json({ ok: true, message: '🏆 Pronóstico de campeón guardado.' });
    } catch (error) {
        await registrarLogActividad({ idUsuario, accion:'guardar_campeon', detalle:`Intento: ${seleccion} (${gl}-${gv})`, exito:false, errorMessage:error.message });
        return res.status(400).json({ ok: false, message: 'Error.' });
    }
});

router.get('/campeon/:idUsuario', validarTokenUsuario, async (req, res) => {
    try {
        const rows = await query(
            `SELECT seleccion_campeon AS "SeleccionCampeon", goles_local AS "GolesLocal", goles_visitante AS "GolesVisitante"
             FROM pronosticos_campeon WHERE id_usuario=$1`,
            [parseInt(req.params.idUsuario)]
        );
        return res.json({ ok: true, campeon: rows[0] || null });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── PAQUETES ────────────────────────────────────────────────────────────────
router.get('/paquetes', async (req, res) => {
    try {
        const rows = await query(
            `SELECT id_paquete AS "IdPaquete", nombre AS "Nombre", precio AS "Precio",
                    goles AS "Goles", max_partidos AS "MaxPartidos"
             FROM paquetes WHERE nombre='Premium'`
        );
        return res.json({ ok: true, paquetes: rows });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: ACTIVAR SUSCRIPCIÓN ───────────────────────────────────────────────
router.post('/admin/activar-suscripcion', async (req, res) => {
    try {
        const { idUsuario, idPaquete, notas } = req.body;
        if (!idUsuario || !idPaquete) return res.status(400).json({ ok: false, message: 'Datos incompletos.' });

        const paq = await query(
            `SELECT goles, nombre, precio FROM paquetes WHERE id_paquete=$1`,
            [idPaquete]
        );
        if (paq.length === 0) return res.status(404).json({ ok: false, message: 'Paquete no encontrado.' });

        const { goles, nombre, precio } = paq[0];

        await query(`UPDATE suscripciones SET activa=false WHERE id_usuario=$1 AND activa=true`, [idUsuario]);
        await query(
            `INSERT INTO suscripciones (id_usuario,id_paquete,goles_restantes,notas) VALUES ($1,$2,$3,$4)`,
            [idUsuario, idPaquete, goles, notas || null]
        );
        await query(
            `INSERT INTO bolsa (id_usuario,monto,concepto) VALUES ($1,$2,$3)`,
            [idUsuario, precio, `Paquete ${nombre}`]
        );

        return res.json({ ok: true, message: `✅ Paquete ${nombre} activado.` });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: USUARIOS CON SUSCRIPCIONES ───────────────────────────────────────
router.get('/admin/usuarios-suscripciones', async (req, res) => {
    try {
        const rows = await query(
            `SELECT u.id_usuario AS "IdUsuario", u.nombre AS "Nombre", u.correo AS "Correo", u.foto_url AS "FotoUrl",
                    p.nombre AS "Paquete", p.id_paquete AS "IdPaquete",
                    s.goles_restantes AS "GolesRestantes", p.goles AS "GolesIniciales",
                    p.max_partidos AS "MaxPartidos", s.fecha_activacion AS "FechaActivacion", s.notas AS "Notas",
                    CASE WHEN s.id_suscripcion IS NOT NULL THEN 1 ELSE 0 END AS "TieneSuscripcion",
                    (SELECT COUNT(*) FROM partidos_desbloqueados pd WHERE pd.id_usuario=u.id_usuario) AS "PartidosDesbloqueados"
             FROM usuarios u
             LEFT JOIN suscripciones s ON s.id_usuario=u.id_usuario AND s.activa=true
             LEFT JOIN paquetes p ON p.id_paquete=s.id_paquete
             WHERE u.activo=true
             ORDER BY u.nombre ASC`
        );
        return res.json({ ok: true, usuarios: rows });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: REGISTRAR RECARGA ─────────────────────────────────────────────────
router.post('/admin/registrar-recarga', async (req, res) => {
    try {
        const { idUsuario, goles, monto, nota } = req.body;
        if (!idUsuario || !goles || !monto) return res.status(400).json({ ok: false, message: 'Datos incompletos.' });

        await query(
            `UPDATE suscripciones SET goles_restantes=goles_restantes+$1
             WHERE id_usuario=$2 AND activa=true`,
            [goles, idUsuario]
        );
        await query(
            `INSERT INTO bolsa (id_usuario,monto,concepto) VALUES ($1,$2,$3)`,
            [idUsuario, parseFloat(monto), nota || `Recarga ${goles} goles`]
        );

        return res.json({ ok: true, message: `✅ ${goles} Goles agregados.` });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: CAMPEÓN REAL ─────────────────────────────────────────────────────
router.post('/admin/campeon-real', async (req, res) => {
    try {
        const { seleccionCampeon, golesLocal, golesVisitante } = req.body;
        await query(
            `INSERT INTO resultado_campeon (seleccion_campeon,goles_local,goles_visitante) VALUES ($1,$2,$3)`,
            [seleccionCampeon, golesLocal, golesVisitante]
        );
        return res.json({ ok: true, message: '🏆 Campeón real registrado.' });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── HELPER CONFIG BOLSA ─────────────────────────────────────────────────────
async function getConfigBolsa() {
    const rows = await query(`SELECT clave, valor FROM config_bolsa`);
    const cfg  = {};
    rows.forEach(r => { cfg[r.clave] = parseFloat(r.valor); });
    return {
        pctAdmin:   cfg.PctAdmin   ?? 15,
        pctPremio1: cfg.PctPremio1 ?? 50,
        pctPremio2: cfg.PctPremio2 ?? 30,
        pctPremio3: cfg.PctPremio3 ?? 20,
    };
}

// ─── ADMIN: BOLSA ────────────────────────────────────────────────────────────
router.get('/admin/bolsa', async (req, res) => {
    try {
        const [insRows, cfg] = await Promise.all([
            query(`SELECT COALESCE(SUM(b.monto),0) AS total_recaudado,
                          COUNT(DISTINCT s.id_usuario) AS total_participantes
                   FROM suscripciones s INNER JOIN bolsa b ON b.id_usuario=s.id_usuario
                   WHERE s.activa=true`),
            getConfigBolsa()
        ]);

        const totalRecaudado     = parseFloat(insRows[0].total_recaudado) || 0;
        const totalParticipantes = parseInt(insRows[0].total_participantes) || 0;
        const bolsaPremios       = totalRecaudado * ((100 - cfg.pctAdmin) / 100);
        const cuotaAdmin         = totalRecaudado * (cfg.pctAdmin / 100);
        const premio1            = bolsaPremios * (cfg.pctPremio1 / 100);
        const premio2            = bolsaPremios * (cfg.pctPremio2 / 100);
        const premio3            = bolsaPremios * (cfg.pctPremio3 / 100);

        const ranking = await query(
            `SELECT id_usuario AS "IdUsuario", nombre AS "Nombre",
                    COALESCE(puntos_totales,0) AS "Puntos",
                    DENSE_RANK() OVER (ORDER BY COALESCE(puntos_totales,0) DESC) AS "Posicion"
             FROM usuarios u LEFT JOIN puntajes p USING(id_usuario)
             WHERE u.activo=true
             ORDER BY "Puntos" DESC LIMIT 5`
        );

        const pos1 = ranking.filter(u => u.Posicion === 1);
        const pos2 = ranking.filter(u => u.Posicion === 2);
        const pos3 = ranking.filter(u => u.Posicion === 3);

        const combinar = (arr, premios) => {
            const t = premios.reduce((a, b) => a + b, 0);
            return arr.map(u => ({ ...u, montoPremio: t/arr.length, porcentaje: ((t/bolsaPremios)*100/arr.length).toFixed(2) }));
        };

        let distribucion = [];
        if      (pos1.length > 1) distribucion = [...combinar(pos1,[premio1,premio2]),...combinar(pos2.length?pos2:pos3,[premio3])];
        else if (pos2.length > 1) distribucion = [...combinar(pos1,[premio1]),...combinar(pos2,[premio2,premio3])];
        else if (pos3.length > 1) distribucion = [...combinar(pos1,[premio1]),...combinar(pos2,[premio2]),...combinar(pos3,[premio3])];
        else                      distribucion = [
            ...(pos1[0]?[{...pos1[0],montoPremio:premio1,porcentaje:cfg.pctPremio1.toFixed(2)}]:[]),
            ...(pos2[0]?[{...pos2[0],montoPremio:premio2,porcentaje:cfg.pctPremio2.toFixed(2)}]:[]),
            ...(pos3[0]?[{...pos3[0],montoPremio:premio3,porcentaje:cfg.pctPremio3.toFixed(2)}]:[]),
        ];

        return res.json({ ok:true, totalRecaudado, totalParticipantes, bolsaPremios, cuotaAdmin, premio1, premio2, premio3, distribucion, ranking, config:cfg });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: GUARDAR CONFIG BOLSA ─────────────────────────────────────────────
router.post('/admin/config-bolsa', async (req, res) => {
    try {
        const { pctAdmin, pctPremio1, pctPremio2, pctPremio3 } = req.body;
        const vals = [pctAdmin, pctPremio1, pctPremio2, pctPremio3];
        if (vals.some(v => v === undefined || v === null || isNaN(v)))
            return res.status(400).json({ ok: false, message: 'Todos los porcentajes son requeridos.' });
        if (vals.some(v => v < 0 || v > 100))
            return res.status(400).json({ ok: false, message: 'Los porcentajes deben estar entre 0 y 100.' });
        if (pctAdmin > 50)
            return res.status(400).json({ ok: false, message: '⛔ La cuota admin no puede superar el 50%.' });
        const suma = parseFloat(pctPremio1)+parseFloat(pctPremio2)+parseFloat(pctPremio3);
        if (Math.abs(suma - 100) > 0.01)
            return res.status(400).json({ ok: false, message: `⛔ Los premios deben sumar 100% (actualmente ${suma.toFixed(2)}%).` });

        const updates = [['PctAdmin',pctAdmin],['PctPremio1',pctPremio1],['PctPremio2',pctPremio2],['PctPremio3',pctPremio3]];
        for (const [clave, valor] of updates) {
            await query(
                `INSERT INTO config_bolsa (clave, valor) VALUES ($1,$2)
                 ON CONFLICT (clave) DO UPDATE SET valor=$2, fecha_actualizacion=NOW()`,
                [clave, parseFloat(valor)]
            );
        }

        return res.json({ ok: true, message: '✅ Porcentajes actualizados correctamente.' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al guardar configuración.' });
    }
});

// ─── PÚBLICO: BOLSA PARA USUARIOS ────────────────────────────────────────────
router.get('/bolsa-premios', async (req, res) => {
    try {
        const [insRows, cfg] = await Promise.all([
            query(`SELECT COALESCE(SUM(b.monto),0) AS total_recaudado,
                          COUNT(DISTINCT s.id_usuario) AS total_participantes
                   FROM suscripciones s INNER JOIN bolsa b ON b.id_usuario=s.id_usuario
                   WHERE s.activa=true`),
            getConfigBolsa()
        ]);

        const totalRecaudado     = parseFloat(insRows[0].total_recaudado) || 0;
        const totalParticipantes = parseInt(insRows[0].total_participantes) || 0;
        const bolsaPremios       = totalRecaudado * ((100 - cfg.pctAdmin) / 100);
        const premio1            = bolsaPremios * (cfg.pctPremio1 / 100);
        const premio2            = bolsaPremios * (cfg.pctPremio2 / 100);
        const premio3            = bolsaPremios * (cfg.pctPremio3 / 100);

        const ranking = await query(
            `SELECT u.nombre AS "Nombre", u.foto_url AS "FotoUrl",
                    COALESCE(p.puntos_totales,0) AS "Puntos",
                    DENSE_RANK() OVER (ORDER BY COALESCE(p.puntos_totales,0) DESC) AS "Posicion"
             FROM usuarios u LEFT JOIN puntajes p ON u.id_usuario=p.id_usuario
             WHERE u.activo=true AND u.id_usuario <> 1
             ORDER BY "Puntos" DESC LIMIT 3`
        );

        return res.json({ ok:true, totalRecaudado, totalParticipantes, bolsaPremios, premio1, premio2, premio3,
            pctPremio1:cfg.pctPremio1, pctPremio2:cfg.pctPremio2, pctPremio3:cfg.pctPremio3, ranking });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ESTADO QUINIELA ──────────────────────────────────────────────────────────
router.get('/estado-quiniela', async (req, res) => {
    try {
        const rows = await query(`SELECT clave, valor FROM config_quiniela`);
        const estado = {};
        rows.forEach(r => { estado[r.clave] = r.valor; });

        let ganadores = [];
        if (estado.GanadoresRevelados === '1') {
            ganadores = await query(
                `SELECT g.posicion AS "Posicion", g.puntos AS "Puntos", g.monto_premio AS "MontoPremio",
                        g.porcentaje_premio AS "PorcentajePremio", u.nombre AS "Nombre", u.foto_url AS "FotoUrl"
                 FROM ganadores_finales g INNER JOIN usuarios u ON g.id_usuario=u.id_usuario
                 ORDER BY g.posicion ASC, g.monto_premio DESC`
            );
        }
        return res.json({ ok: true, ...estado, ganadores });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: REVELAR GANADORES ─────────────────────────────────────────────────
router.post('/admin/revelar-ganadores', async (req, res) => {
    try {
        const config = await query(`SELECT valor FROM config_quiniela WHERE clave='GanadoresRevelados'`);
        if (config[0]?.valor === '1') return res.status(409).json({ ok: false, message: '⚠️ Ganadores ya revelados.' });

        const bolsaR = await query(`SELECT COALESCE(SUM(monto),0) AS total FROM bolsa`);
        const cfg    = await getConfigBolsa();
        const totalRecaudado = parseFloat(bolsaR[0].total) || 0;
        const bolsaPremios   = totalRecaudado * ((100 - cfg.pctAdmin) / 100);
        const premio1=bolsaPremios*(cfg.pctPremio1/100), premio2=bolsaPremios*(cfg.pctPremio2/100), premio3=bolsaPremios*(cfg.pctPremio3/100);

        const ranking = await query(
            `SELECT u.id_usuario, u.nombre, COALESCE(p.puntos_totales,0) AS puntos,
                    DENSE_RANK() OVER (ORDER BY COALESCE(p.puntos_totales,0) DESC) AS posicion
             FROM usuarios u LEFT JOIN puntajes p ON u.id_usuario=p.id_usuario
             WHERE u.activo=true AND u.id_usuario<>1`
        );

        const groups={};
        ranking.forEach(u=>{ if(!groups[u.puntos]) groups[u.puntos]=[]; groups[u.puntos].push(u); });
        const sortedPoints=Object.keys(groups).map(Number).sort((a,b)=>b-a);
        const prizes=[premio1,premio2,premio3];
        let distribucion=[], prizeIdx=0;
        for (const pts of sortedPoints) {
            if (prizeIdx>=prizes.length) break;
            const gUsers=groups[pts], L=gUsers.length;
            const gPrizes=prizes.slice(prizeIdx,prizeIdx+L);
            prizeIdx+=L;
            if (!gPrizes.length) break;
            const sumP=gPrizes.reduce((a,b)=>a+b,0);
            gUsers.forEach(u=>distribucion.push({...u,montoPremio:sumP/L,porcentaje:((sumP/bolsaPremios)*100/L).toFixed(2)}));
        }

        for (const g of distribucion) {
            await query(
                `INSERT INTO ganadores_finales (id_usuario,posicion,puntos,porcentaje_premio,monto_premio)
                 VALUES ($1,$2,$3,$4,$5)`,
                [g.id_usuario, g.posicion, g.puntos, parseFloat(g.porcentaje), g.montoPremio]
            );
        }

        await query(`UPDATE config_quiniela SET valor='1' WHERE clave='GanadoresRevelados'`);

        const todos = await query(
            `SELECT u.id_usuario, u.nombre, u.correo, COALESCE(p.puntos_totales,0) AS puntos,
                    DENSE_RANK() OVER (ORDER BY COALESCE(p.puntos_totales,0) DESC) AS posicion
             FROM usuarios u LEFT JOIN puntajes p ON u.id_usuario=p.id_usuario
             WHERE u.activo=true AND u.correo IS NOT NULL AND u.correo!=''`
        );

        const fmt=n=>`$${Number(n).toLocaleString('es-MX',{minimumFractionDigits:2})} MXN`;
        const medallas={1:'🥇',2:'🥈',3:'🥉'};
        const tablaHTML=distribucion.map(g=>`<tr><td>${medallas[g.posicion]}</td><td>${g.nombre}</td><td>${g.puntos} pts</td><td>${fmt(g.montoPremio)}</td></tr>`).join('');

        for (const u of todos) {
            const gi=distribucion.find(g=>g.id_usuario===u.id_usuario);
            const html=`<div style="font-family:sans-serif;max-width:600px;background:#05101a;color:white;border-radius:16px;overflow:hidden;"><div style="background:linear-gradient(135deg,#f1c40f,#d4ac0d);padding:2rem;text-align:center;"><h1 style="color:#000;">🏆 ¡El Mundial ha terminado!</h1></div>${gi?`<div style="padding:1.5rem;text-align:center;"><p style="font-size:3rem;">${medallas[gi.posicion]}</p><h2 style="color:#2ecc71;">¡Felicidades ${u.nombre}!</h2><p>Premio: <strong style="color:#f1c40f;">${fmt(gi.montoPremio)}</strong></p></div>`:`<div style="padding:1.5rem;text-align:center;"><p>Hola ${u.nombre}, terminaste en ${u.posicion}° con ${u.puntos} pts.</p></div>`}<div style="padding:1rem;"><table style="width:100%;"><thead><tr><th>Pos</th><th>Nombre</th><th>Puntos</th><th>Premio</th></tr></thead><tbody>${tablaHTML}</tbody></table></div><div style="padding:1rem;text-align:center;"><small>Quiniela Mundial 2026 — torreslab</small></div></div>`;
            enviarCorreoResultado({ correo:u.correo, nombre:u.nombre, asunto:'🏆 Resultados Quiniela Mundial 2026', htmlPersonalizado:html }).catch(console.error);
        }

        return res.json({ ok:true, message:'🏆 Ganadores revelados y correos enviados.', distribucion });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: PENDIENTES ────────────────────────────────────────────────────────
router.get('/admin/pendientes', async (req, res) => {
    try {
        const rows = await query(
            `SELECT id_pendiente AS "IdPendiente", fixture_id AS "FixtureId",
                    local_nombre AS "LocalNombre", visitante_nombre AS "VisitanteNombre",
                    goles_local AS "GolesLocal", goles_visitante AS "GolesVisitante",
                    fecha_partido AS "FechaPartido", validado AS "Validado", partido_id AS "PartidoId"
             FROM resultados_pendientes WHERE validado=false ORDER BY fecha_partido ASC`
        );
        return res.json({ ok: true, pendientes: rows });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

router.post('/admin/validar-pendiente', async (req, res) => {
    try {
        const { idPendiente, partidoId } = req.body;
        const pendiente = await query(
            `SELECT * FROM resultados_pendientes WHERE id_pendiente=$1`,
            [idPendiente]
        );
        if (pendiente.length === 0) return res.status(404).json({ ok: false, message: 'No encontrado.' });

        const { goles_local:GolesLocal, goles_visitante:GolesVisitante, local_nombre:LocalNombre, visitante_nombre:VisitanteNombre } = pendiente[0];

        await query(
            `INSERT INTO resultados_reales (partido_id,goles_local,goles_visitante) VALUES ($1,$2,$3)
             ON CONFLICT (partido_id) DO UPDATE SET goles_local=$2, goles_visitante=$3`,
            [partidoId, GolesLocal, GolesVisitante]
        );
        await query(
            `UPDATE resultados_pendientes SET validado=true, fecha_validacion=NOW(), partido_id=$1
             WHERE id_pendiente=$2`,
            [partidoId, idPendiente]
        );

        const pros = await query(
            `SELECT p.id_usuario, p.goles_local AS "ProLocal", p.goles_visitante AS "ProVisitante",
                    u.nombre AS "Nombre", u.correo AS "Correo"
             FROM pronosticos p INNER JOIN usuarios u ON p.id_usuario=u.id_usuario
             WHERE p.partido_id=$1 AND u.correo IS NOT NULL`,
            [partidoId]
        );
        for (const pro of pros) {
            let puntos=0, estado='Falló';
            if (pro.ProLocal===GolesLocal&&pro.ProVisitante===GolesVisitante) { puntos=5; estado='Exacto'; }
            else if (pro.ProLocal===pro.ProVisitante&&GolesLocal===GolesVisitante) { puntos=1; estado='Acierto'; }
            else if ((pro.ProLocal>pro.ProVisitante&&GolesLocal>GolesVisitante)||(pro.ProLocal<pro.ProVisitante&&GolesLocal<GolesVisitante)) { puntos=3; estado='Acierto'; }
            enviarCorreoResultado({ correo:pro.Correo, nombre:pro.Nombre, local:LocalNombre, visitante:VisitanteNombre, golesLocal:GolesLocal, golesVisitante:GolesVisitante, proLocal:pro.ProLocal, proVisitante:pro.ProVisitante, puntos, estado }).catch(console.error);
        }

        return res.json({ ok: true, message: '✅ Resultado validado y correos enviados.' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

router.post('/admin/rechazar-pendiente', async (req, res) => {
    try {
        await query(`DELETE FROM resultados_pendientes WHERE id_pendiente=$1`, [req.body.idPendiente]);
        return res.json({ ok: true, message: 'Descartado.' });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: EXPORTAR PRONÓSTICOS ─────────────────────────────────────────────
router.get('/admin/exportar-pronosticos', async (req, res) => {
    try {
        const rows = await query(
            `SELECT u.nombre AS "Usuario", u.correo AS "Correo",
                    p.partido_id AS "Partido #",
                    p.goles_local AS "Pronóstico Local", p.goles_visitante AS "Pronóstico Visitante",
                    COALESCE(CAST(r.goles_local AS VARCHAR),'-') AS "Resultado Local",
                    COALESCE(CAST(r.goles_visitante AS VARCHAR),'-') AS "Resultado Visitante",
                    COALESCE(pd.modificaciones_usadas,0) AS "Modificaciones",
                    CASE
                        WHEN r.goles_local IS NULL THEN 'Pendiente'
                        WHEN p.goles_local=r.goles_local AND p.goles_visitante=r.goles_visitante THEN '5 — Exacto'
                        WHEN r.goles_local=r.goles_visitante AND p.goles_local=p.goles_visitante THEN '1 — Empate correcto'
                        WHEN (p.goles_local>p.goles_visitante AND r.goles_local>r.goles_visitante)
                          OR (p.goles_local<p.goles_visitante AND r.goles_local<r.goles_visitante) THEN '3 — Ganador correcto'
                        ELSE '0 — Falló'
                    END AS "Puntos",
                    COALESCE(pt.puntos_totales,0) AS "Puntos Totales"
             FROM pronosticos p
             INNER JOIN usuarios u ON p.id_usuario=u.id_usuario
             LEFT JOIN resultados_reales r ON p.partido_id=r.partido_id
             LEFT JOIN partidos_desbloqueados pd ON pd.id_usuario=p.id_usuario AND pd.partido_id=p.partido_id
             LEFT JOIN puntajes pt ON pt.id_usuario=u.id_usuario
             WHERE u.activo=true
             ORDER BY u.nombre ASC, p.partido_id ASC`
        );
        return res.json({ ok: true, pronosticos: rows });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al exportar.' });
    }
});

// ─── ADMIN: LOGS ─────────────────────────────────────────────────────────────
router.get('/admin/logs', async (req, res) => {
    try {
        const rows = await query(
            `SELECT l.id_log AS "IdLog", l.id_usuario AS "IdUsuario", u.nombre AS "NombreUsuario",
                    l.accion AS "Accion", l.partido_id AS "PartidoId", l.detalle AS "Detalle",
                    l.fecha AS "Fecha", l.exito AS "Exito", l.error_message AS "ErrorMessage"
             FROM logs_actividad l
             LEFT JOIN usuarios u ON l.id_usuario=u.id_usuario
             ORDER BY l.fecha DESC LIMIT 100`
        );
        return res.json({ ok: true, logs: rows });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: SINCRONIZAR MANUAL ───────────────────────────────────────────────
router.post('/admin/sincronizar', async (req, res) => {
    try {
        const { sincronizarResultados } = require('./sync-resultados');
        await sincronizarResultados();
        return res.json({ ok: true, message: '✅ Sincronización completada.' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al sincronizar.' });
    }
});

// ─── STANDINGS (API-Sports) ──────────────────────────────────────────────────
router.get('/standings', async (req, res) => {
    try {
        const API_KEY   = process.env.APISPORTS_KEY;
        const LEAGUE_ID = 1, SEASON = 2026;
        if (!API_KEY) return res.status(500).json({ ok: false, message: 'API Key no configurada.' });

        const response = await fetch(
            `https://v3.football.api-sports.io/standings?league=${LEAGUE_ID}&season=${SEASON}`,
            { headers: { 'x-apisports-key': API_KEY } }
        );
        const data = await response.json();
        if (!data.response || data.response.length === 0) return res.json({ ok: true, grupos: {} });

        const grupos = {};
        const league = data.response[0]?.league;
        if (!league) return res.json({ ok: true, grupos: {} });

        league.standings.forEach(standing => {
            standing.forEach(equipo => {
                const letra = equipo.group.replace('Group ', '').trim();
                if (!grupos[letra]) grupos[letra] = [];
                grupos[letra].push({
                    posicion: equipo.rank, nombre: equipo.team.name, logo: equipo.team.logo,
                    jugados: equipo.all.played, ganados: equipo.all.win, empates: equipo.all.draw,
                    perdidos: equipo.all.lose, golesFavor: equipo.all.goals.for,
                    golesContra: equipo.all.goals.against, diferencia: equipo.goalsDiff, puntos: equipo.points
                });
            });
        });

        return res.json({ ok: true, grupos });
    } catch (error) {
        console.error('Error standings:', error.message);
        return res.status(500).json({ ok: false, message: 'Error al obtener standings.' });
    }
});

// ─── MIS PUNTOS POR GRUPO ────────────────────────────────────────────────────
router.get('/mis-puntos-grupo/:idUsuario', validarTokenUsuario, async (req, res) => {
    try {
        const idUsuario = parseInt(req.params.idUsuario);
        const result = await query(
            `SELECT p.partido_id, p.goles_local AS "ProLocal", p.goles_visitante AS "ProVisitante",
                    r.goles_local AS "RealLocal", r.goles_visitante AS "RealVisitante"
             FROM pronosticos p
             INNER JOIN resultados_reales r ON p.partido_id=r.partido_id
             WHERE p.id_usuario=$1`,
            [idUsuario]
        );

        const puntosPorGrupo = {};
        result.forEach(row => {
            const partido = partidos.find(p => p.id === row.partido_id);
            if (!partido || !partido.grupo) return;
            const grupo = partido.grupo;
            if (!puntosPorGrupo[grupo]) puntosPorGrupo[grupo] = 0;
            if (row.ProLocal===row.RealLocal && row.ProVisitante===row.RealVisitante) puntosPorGrupo[grupo]+=5;
            else if (row.RealLocal===row.RealVisitante && row.ProLocal===row.ProVisitante) puntosPorGrupo[grupo]+=1;
            else if ((row.ProLocal>row.ProVisitante&&row.RealLocal>row.RealVisitante)||(row.ProLocal<row.ProVisitante&&row.RealLocal<row.RealVisitante)) puntosPorGrupo[grupo]+=3;
        });

        return res.json({ ok: true, puntosPorGrupo });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── PRONÓSTICOS PÚBLICOS POR PARTIDO ────────────────────────────────────────
router.get('/pronosticos-partido/:partidoId', validarTokenUsuario, async (req, res) => {
    try {
        const partidoId = parseInt(req.params.partidoId);

        const revelado = await query(
            `SELECT revelado FROM partidos_revelados WHERE partido_id=$1`,
            [partidoId]
        );
        const estaRevelado = revelado[0]?.revelado === true;

        const tokenAdmin    = req.headers['x-admin-token'] || req.query.adminToken;
        const secret        = process.env.ADMIN_SECRET || 'default-admin-secret-2026-torreslab';
        const expectedAdmin = crypto.createHmac('sha256', secret).update('1').digest('hex');
        const esAdmin       = tokenAdmin === expectedAdmin;

        if (!estaRevelado && !esAdmin) {
            return res.json({ ok: true, revelado: false, pronosticos: [] });
        }

        const rows = await query(
            `SELECT u.nombre AS "Nombre", p.goles_local AS "GolesLocal", p.goles_visitante AS "GolesVisitante",
                    p.fecha_registro AS "FechaRegistro", p.hash_integridad AS "HashIntegridad",
                    CASE WHEN p.modificado_por IS NOT NULL THEN 1 ELSE 0 END AS "Sospechoso",
                    p.modificado_por AS "ModificadoPor"
             FROM pronosticos p
             INNER JOIN usuarios u ON u.id_usuario=p.id_usuario
             WHERE p.partido_id=$1
             ORDER BY u.nombre ASC`,
            [partidoId]
        );

        return res.json({ ok: true, revelado: true, pronosticos: rows });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al obtener pronósticos.' });
    }
});

// ─── ADMIN: REVELAR PRONÓSTICOS DE UN PARTIDO ────────────────────────────────
router.post('/admin/revelar-partido', validarTokenAdmin, async (req, res) => {
    try {
        const { partidoId } = req.body;
        if (!partidoId) return res.status(400).json({ ok: false, message: 'Falta partidoId.' });

        await query(
            `INSERT INTO partidos_revelados (partido_id, revelado, fecha_revelado, revelado_por)
             VALUES ($1, true, NOW(), 'admin')
             ON CONFLICT (partido_id)
             DO UPDATE SET revelado=true, fecha_revelado=NOW(), revelado_por='admin'`,
            [partidoId]
        );

        await registrarLogActividad({ accion:'revelar_partido', partidoId, detalle:`Partido ${partidoId} revelado`, exito:true });
        return res.json({ ok: true, message: `✅ Pronósticos del partido ${partidoId} revelados.` });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al revelar.' });
    }
});

module.exports = router;