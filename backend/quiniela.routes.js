const express    = require('express');
const router     = express.Router();
const { z }      = require('zod');
const nodemailer = require('nodemailer');
const { query }  = require('./db');
const path       = require('path');
const fs         = require('fs');

let partidos = [];
try {
    const dataPath = path.join(__dirname, 'data', 'partidos.json');
    partidos = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
} catch (err) {
    console.error('Error al cargar partidos.json en el backend:', err);
}

async function registrarLogActividad({ idUsuario, accion, partidoId, detalle, exito, errorMessage }) {
    try {
        await query(
            `INSERT INTO logs_actividad (id_usuario, accion, partido_id, detalle, exito, error_message)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [idUsuario || null, accion, partidoId || null, detalle || null, exito ?? true, errorMessage || null]
        );
    } catch (err) {
        console.error('❌ Error al registrar log de actividad:', err);
    }
}

const crypto = require('crypto');

function validarTokenAdmin(req, res, next) {
    const token = req.headers['x-admin-token'] || req.query.adminToken;
    if (!token) {
        return res.status(401).json({ ok: false, message: 'No autorizado.' });
    }

    const secret = process.env.ADMIN_SECRET || "default-admin-secret-2026-torreslab";
    const expectedToken = crypto.createHmac('sha256', secret).update('1').digest('hex');

    if (token !== expectedToken) {
        return res.status(401).json({ ok: false, message: 'Acceso denegado.' });
    }

    next();
}

function validarTokenUsuario(req, res, next) {
    let idUsuario = req.params.idUsuario || req.body.idUsuario || req.query.idUsuario;
    if (!idUsuario) {
        return res.status(400).json({ ok: false, message: 'Falta ID de usuario para validación.' });
    }

    idUsuario = parseInt(idUsuario);

    const token = req.headers['x-user-token'];
    if (!token) {
        return res.status(401).json({ ok: false, message: 'No autorizado. Falta token de sesión.' });
    }

    const secret = process.env.ADMIN_SECRET || "default-admin-secret-2026-torreslab";
    const expectedToken = crypto.createHmac('sha256', secret).update(String(idUsuario)).digest('hex');

    if (token !== expectedToken) {
        return res.status(403).json({ ok: false, message: 'Acceso denegado. Token inválido.' });
    }

    next();
}

// Proteger todas las rutas administrativas
router.use('/admin', validarTokenAdmin);

// ─── NODEMAILER ───────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

async function enviarCorreoResultado({ correo, nombre, local, visitante, golesLocal, golesVisitante, proLocal, proVisitante, puntos, estado, asunto, htmlPersonalizado }) {
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

function calcularCostoGoles(ms) {
    if (ms <= 0)              return null;
    if (ms <= 30*60*1000)    return 5;
    if (ms <= 59*60*1000)    return 3;
    return 1;
}

// ─── GUARDAR QUINIELA ─────────────────────────────────────────────────────────
router.post('/guardar-quiniela', validarTokenUsuario, async (req, res) => {
    try {
        const { idUsuario, pronosticos } = req.body;

        const sub = await query(
            `SELECT s.id_suscripcion
             FROM suscripciones s
             WHERE s.id_usuario=$1 AND s.activa=TRUE`,
            [idUsuario]
        );
        if (sub.rows.length === 0) {
            const errMsg = '⛔ No tienes suscripción activa.';
            await registrarLogActividad({
                idUsuario,
                accion: 'guardar_quiniela',
                detalle: 'Intento de guardar quiniela sin suscripción activa',
                exito: false,
                errorMessage: errMsg
            });
            return res.status(403).json({ ok: false, message: errMsg });
        }

        let errores = [], guardados = 0;

        for (const pro of pronosticos) {
            // 1. Verificar fecha del partido
            const partido = partidos.find(p => p.id === pro.partidoId);
            if (!partido) {
                const errMsg = `Partido #${pro.partidoId} no encontrado.`;
                errores.push(errMsg);
                await registrarLogActividad({
                    idUsuario,
                    accion: 'guardar_quiniela',
                    partidoId: pro.partidoId,
                    detalle: `Intento Pronóstico: ${pro.golesLocal} - ${pro.golesVisitante}`,
                    exito: false,
                    errorMessage: errMsg
                });
                continue;
            }

            const horaLimpia   = partido.hora.replace(" hrs", "");
            const fechaPartido = new Date(`${partido.fecha} ${horaLimpia}:00 GMT-0600`);
            const msHasta      = fechaPartido.getTime() - Date.now();

            if (msHasta <= 0) {
                const errMsg = 'El partido ya comenzó y no se puede modificar.';
                errores.push(`Partido #${pro.partidoId} (${partido.local} vs ${partido.visitante}) ${errMsg}`);
                await registrarLogActividad({
                    idUsuario,
                    accion: 'guardar_quiniela',
                    partidoId: pro.partidoId,
                    detalle: `Intento Pronóstico: ${pro.golesLocal} - ${pro.golesVisitante}`,
                    exito: false,
                    errorMessage: errMsg
                });
                continue;
            }

            // 2. Verificar modificaciones
            const desbloq = await query(
                `SELECT id_desbloqueo, modificaciones_usadas
                 FROM partidos_desbloqueados WHERE id_usuario=$1 AND partido_id=$2`,
                [idUsuario, pro.partidoId]
            );

            let modUsadas = 0;
            let idDesbloqueo = null;
            if (desbloq.rows.length > 0) {
                modUsadas = desbloq.rows[0].modificaciones_usadas;
                idDesbloqueo = desbloq.rows[0].id_desbloqueo;
            }

            if (modUsadas >= 3) {
                const errMsg = 'Agotaste tus 3 modificaciones.';
                errores.push(`Partido #${pro.partidoId}: ${errMsg}`);
                await registrarLogActividad({
                    idUsuario,
                    accion: 'guardar_quiniela',
                    partidoId: pro.partidoId,
                    detalle: `Intento Pronóstico: ${pro.golesLocal} - ${pro.golesVisitante}`,
                    exito: false,
                    errorMessage: errMsg
                });
                continue;
            }

            // 3. Guardar pronóstico
            await query(
                `INSERT INTO pronosticos (id_usuario, partido_id, goles_local, goles_visitante)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (id_usuario, partido_id) DO UPDATE SET goles_local=$3, goles_visitante=$4`,
                [idUsuario, pro.partidoId, pro.golesLocal, pro.golesVisitante]
            );

            // 4. Incrementar modificaciones
            if (idDesbloqueo) {
                await query(
                    `UPDATE partidos_desbloqueados SET modificaciones_usadas=modificaciones_usadas+1 WHERE id_desbloqueo=$1`,
                    [idDesbloqueo]
                );
            } else {
                await query(
                    `INSERT INTO partidos_desbloqueados (id_usuario, partido_id, modificaciones_usadas, goles_gastados)
                     VALUES ($1, $2, 0, 0)`,
                    [idUsuario, pro.partidoId]
                );
            }

            await registrarLogActividad({
                idUsuario,
                accion: 'guardar_quiniela',
                partidoId: pro.partidoId,
                detalle: `Pronóstico guardado: ${pro.golesLocal} - ${pro.golesVisitante}`,
                exito: true
            });

            guardados++;
        }

        await query(
            `INSERT INTO quinielas (id_usuario, estatus) VALUES ($1, 'Borrador') ON CONFLICT (id_usuario) DO NOTHING`,
            [idUsuario]
        );

        const desb = await query(
            `SELECT partido_id AS "PartidoId", modificaciones_usadas AS "ModificacionesUsadas", goles_gastados AS "GolesGastados"
             FROM partidos_desbloqueados WHERE id_usuario=$1`,
            [idUsuario]
        );

        const msg = errores.length > 0
            ? `⚠️ No se pudo guardar: ${errores.join(' | ')}`
            : `✅ Pronóstico guardado correctamente.`;

        return res.json({ ok: guardados > 0, message: msg, partidosDesbloqueados: desb.rows });

    } catch (error) {
        console.error(error);
        await registrarLogActividad({
            idUsuario,
            accion: 'guardar_quiniela',
            exito: false,
            errorMessage: error.message || 'Error al procesar.'
        });
        return res.status(400).json({ ok: false, message: 'Error al procesar.' });
    }
});


// ─── OBTENER QUINIELA ─────────────────────────────────────────────────────────
router.get('/obtener-quiniela/:idUsuario', validarTokenUsuario, async (req, res) => {
    try {
        const idUsuario = parseInt(req.params.idUsuario);
        const result = await query(
            `SELECT partido_id AS "PartidoId", goles_local AS "GolesLocal", goles_visitante AS "GolesVisitante"
             FROM pronosticos WHERE id_usuario=$1`,
            [idUsuario]
        );
        return res.json({ ok: true, pronosticos: result.rows });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error al recuperar datos.' });
    }
});

// ─── MIS DATOS (suscripción + partidos desbloqueados) ────────────────────────
router.get('/mis-datos/:idUsuario', validarTokenUsuario, async (req, res) => {
    try {
        const idUsuario = parseInt(req.params.idUsuario);

        const sub = await query(
            `SELECT s.goles_restantes AS "GolesRestantes", p.nombre AS "Paquete",
                    p.max_partidos AS "MaxPartidos", p.goles AS "GolesIniciales"
             FROM suscripciones s INNER JOIN paquetes p ON s.id_paquete=p.id_paquete
             WHERE s.id_usuario=$1 AND s.activa=TRUE`,
            [idUsuario]
        );

        const desb = await query(
            `SELECT partido_id AS "PartidoId", modificaciones_usadas AS "ModificacionesUsadas", goles_gastados AS "GolesGastados"
             FROM partidos_desbloqueados WHERE id_usuario=$1`,
            [idUsuario]
        );

        return res.json({
            ok: true,
            suscripcion: sub.rows[0] || null,
            partidosDesbloqueados: desb.rows
        });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error al obtener datos.' });
    }
});

// ─── DESBLOQUEAR PARTIDO (DEPRECATED) ──────────────────────────────────────────
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
             VALUES ($1, $2, $3)
             ON CONFLICT (partido_id) DO UPDATE SET goles_local=$2, goles_visitante=$3`,
            [partidoId, golesLocal, golesVisitante]
        );

        res.json({ ok: true, message: 'Resultado oficial guardado. Enviando notificaciones...' });

        const pros = await query(
            `SELECT p.id_usuario, p.goles_local AS pro_local, p.goles_visitante AS pro_visitante,
                    u.nombre, u.correo
             FROM pronosticos p INNER JOIN usuarios u ON p.id_usuario=u.id_usuario
             WHERE p.partido_id=$1 AND u.correo IS NOT NULL AND u.correo!=''`,
            [partidoId]
        );

        for (const pro of pros.rows) {
            let puntos = 0, estado = 'Falló';
            if (pro.pro_local===golesLocal && pro.pro_visitante===golesVisitante) { 
                puntos=5; 
                estado='Exacto'; 
            }
            else if (pro.pro_local===pro.pro_visitante && golesLocal===golesVisitante) { 
                puntos=1; 
                estado='Acierto'; 
            }
            else if ((pro.pro_local>pro.pro_visitante&&golesLocal>golesVisitante)||(pro.pro_local<pro.pro_visitante&&golesLocal<golesVisitante)) { 
                puntos=3; 
                estado='Acierto'; 
            }
            enviarCorreoResultado({ correo:pro.correo, nombre:pro.nombre, local:local||'Local', visitante:visitante||'Visitante', golesLocal, golesVisitante, proLocal:pro.pro_local, proVisitante:pro.pro_visitante, puntos, estado }).catch(console.error);
        }
    } catch (error) {
        console.error(error);
        return res.status(400).json({ ok: false, message: 'Error al guardar resultado.' });
    }
});

// ─── OBTENER RESULTADOS ───────────────────────────────────────────────────────
router.get('/obtener-resultados', async (req, res) => {
    try {
        const result = await query(`SELECT partido_id AS "PartidoId", goles_local AS "GolesLocal", goles_visitante AS "GolesVisitante" FROM resultados_reales`);
        return res.json({ ok: true, resultados: result.rows });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── CALCULAR PUNTOS ──────────────────────────────────────────────────────────
router.post('/calcular-puntos', validarTokenAdmin, async (req, res) => {
    try {
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

        return res.json({ ok: true, message: '✅ Puntos recalculados.' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al calcular.' });
    }
});

// ─── TABLA GENERAL ────────────────────────────────────────────────────────────
router.get('/tabla-general', async (req, res) => {
    try {
        const result = await query(`
            SELECT u.id_usuario AS "IdUsuario", u.nombre AS "Nombre", u.foto_url AS "FotoUrl",
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
            WHERE u.activo=TRUE AND u.id_usuario != 1
            ORDER BY "Puntos" DESC, "Aciertos" DESC, u.nombre ASC
        `);
        return res.json({ ok: true, ranking: result.rows });
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
            `SELECT p.partido_id, p.goles_local AS pro_local, p.goles_visitante AS pro_visitante,
                    r.goles_local AS real_local, r.goles_visitante AS real_visitante
             FROM pronosticos p LEFT JOIN resultados_reales r ON p.partido_id=r.partido_id
             WHERE p.id_usuario=$1`,
            [idUsuario]
        );

        const rankingQ = await query(
            `SELECT id_usuario, DENSE_RANK() OVER (ORDER BY COALESCE(puntos_totales,0) DESC) AS posicion
             FROM puntajes`
        );
        const miPos = rankingQ.rows.find(u => u.id_usuario === idUsuario);

        let exactos=0, correctos=0, fallados=0, pendientes=0, puntos=0;
        const historial = result.rows.map(row => {
            let pts=0, estado='Pendiente';
            if (row.real_local===null) { pendientes++; }
            else if (row.pro_local===row.real_local&&row.pro_visitante===row.real_visitante) { exactos++; pts=5; estado='Exacto'; }
            else if (row.pro_local===row.pro_visitante&&row.real_local===row.real_visitante) { correctos++; pts=1; estado='Acierto'; }
            else if ((row.pro_local>row.pro_visitante&&row.real_local>row.real_visitante)||(row.pro_local<row.pro_visitante&&row.real_local<row.real_visitante)) { correctos++; pts=3; estado='Acierto'; }
            else { fallados++; estado='Falló'; }
            puntos+=pts;
            return { partidoId:row.partido_id, pronostico:`${row.pro_local} - ${row.pro_visitante}`, resultadoReal:row.real_local!==null?`${row.real_local} - ${row.real_visitante}`:'Pendiente', puntos:pts, estado };
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
    let idUsuario = null;
    let seleccion = null;
    let gl = null;
    let gv = null;
    try {
        const DEADLINE_CAMPEON = new Date("2026-06-11T13:00:00 GMT-0600").getTime();
        const body = req.body;
        idUsuario = body?.idUsuario;
        seleccion = body?.seleccionCampeon;
        gl = body?.golesLocal;
        gv = body?.golesVisitante;

        if (Date.now() >= DEADLINE_CAMPEON) {
            const errMsg = '⛔ El pronóstico de campeón ya está bloqueado.';
            await registrarLogActividad({
                idUsuario,
                accion: 'guardar_campeon',
                detalle: `Intento Campeón: ${seleccion} (${gl} - ${gv})`,
                exito: false,
                errorMessage: errMsg
            });
            return res.status(403).json({ ok: false, message: errMsg });
        }
        const { idUsuario: valId, seleccionCampeon, golesLocal, golesVisitante } = campeonSchema.parse(req.body);
        await query(
            `INSERT INTO pronosticos_campeon (id_usuario, seleccion_campeon, goles_local, goles_visitante)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (id_usuario) DO UPDATE SET seleccion_campeon=$2, goles_local=$3, goles_visitante=$4, fecha_actualizacion=NOW()`,
            [valId, seleccionCampeon, golesLocal, golesVisitante]
        );

        await registrarLogActividad({
            idUsuario: valId,
            accion: 'guardar_campeon',
            detalle: `Campeón: ${seleccionCampeon} (${golesLocal} - ${golesVisitante})`,
            exito: true
        });

        return res.json({ ok: true, message: '🏆 Pronóstico de campeón guardado.' });
    } catch (error) {
        await registrarLogActividad({
            idUsuario,
            accion: 'guardar_campeon',
            detalle: `Intento Campeón: ${seleccion} (${gl} - ${gv})`,
            exito: false,
            errorMessage: error.message || 'Error al registrar campeón.'
        });
        return res.status(400).json({ ok: false, message: 'Error.' });
    }
});

router.get('/campeon/:idUsuario', validarTokenUsuario, async (req, res) => {
    try {
        const result = await query(
            `SELECT seleccion_campeon AS "SeleccionCampeon", goles_local AS "GolesLocal", goles_visitante AS "GolesVisitante"
             FROM pronosticos_campeon WHERE id_usuario=$1`,
            [parseInt(req.params.idUsuario)]
        );
        return res.json({ ok: true, campeon: result.rows[0] || null });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── PAQUETES ────────────────────────────────────────────────────────────────
router.get('/paquetes', async (req, res) => {
    try {
        const result = await query(`SELECT id_paquete AS "IdPaquete", nombre AS "Nombre", precio AS "Precio", goles AS "Goles", max_partidos AS "MaxPartidos" FROM paquetes WHERE nombre='Premium'`);
        return res.json({ ok: true, paquetes: result.rows });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: ACTIVAR SUSCRIPCIÓN ───────────────────────────────────────────────
router.post('/admin/activar-suscripcion', async (req, res) => {
    try {
        const { idUsuario, idPaquete, notas } = req.body;
        if (!idUsuario || !idPaquete) return res.status(400).json({ ok: false, message: 'Datos incompletos.' });

        const paq = await query(`SELECT goles, nombre FROM paquetes WHERE id_paquete=$1`, [idPaquete]);
        if (paq.rows.length === 0) return res.status(404).json({ ok: false, message: 'Paquete no encontrado.' });

        const { goles, nombre } = paq.rows[0];
        await query(`UPDATE suscripciones SET activa=FALSE WHERE id_usuario=$1 AND activa=TRUE`, [idUsuario]);
        await query(
            `INSERT INTO suscripciones (id_usuario, id_paquete, goles_restantes, notas) VALUES ($1, $2, $3, $4)`,
            [idUsuario, idPaquete, goles, notas || null]
        );

        // Registrar en bolsa
        const paqPrecio = await query(`SELECT precio FROM paquetes WHERE id_paquete=$1`, [idPaquete]);
        await query(
            `INSERT INTO bolsa (id_usuario, monto, concepto) VALUES ($1, $2, $3)`,
            [idUsuario, paqPrecio.rows[0].precio, `Paquete ${nombre}`]
        );

        return res.json({ ok: true, message: `✅ Paquete ${nombre} activado con ${goles} goles.` });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: USUARIOS CON SUSCRIPCIONES ───────────────────────────────────────
router.get('/admin/usuarios-suscripciones', async (req, res) => {
    try {
        const result = await query(`
            SELECT u.id_usuario AS "IdUsuario", u.nombre AS "Nombre", u.correo AS "Correo", u.foto_url AS "FotoUrl",
                   p.nombre AS "Paquete", p.id_paquete AS "IdPaquete",
                   s.goles_restantes AS "GolesRestantes", p.goles AS "GolesIniciales",
                   p.max_partidos AS "MaxPartidos", s.fecha_activacion AS "FechaActivacion", s.notas AS "Notas",
                   CASE WHEN s.id_suscripcion IS NOT NULL THEN 1 ELSE 0 END AS "TieneSuscripcion",
                   (SELECT COUNT(*) FROM partidos_desbloqueados pd WHERE pd.id_usuario=u.id_usuario) AS "PartidosDesbloqueados"
            FROM usuarios u
            LEFT JOIN suscripciones s ON s.id_usuario=u.id_usuario AND s.activa=TRUE
            LEFT JOIN paquetes p ON p.id_paquete=s.id_paquete
            WHERE u.activo=TRUE
            ORDER BY u.nombre ASC
        `);
        return res.json({ ok: true, usuarios: result.rows });
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

        const result = await query(
            `UPDATE suscripciones SET goles_restantes=goles_restantes+$1 WHERE id_usuario=$2 AND activa=TRUE RETURNING id_suscripcion`,
            [goles, idUsuario]
        );
        if (result.rows.length === 0) return res.status(404).json({ ok: false, message: 'Sin suscripción activa.' });

        await query(
            `INSERT INTO bolsa (id_usuario, monto, concepto) VALUES ($1, $2, $3)`,
            [idUsuario, parseFloat(monto), nota || `Recarga ${goles} goles`]
        );

        return res.json({ ok: true, message: `✅ ${goles} Goles agregados y $${monto} MXN registrados.` });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: GUARDAR CAMPEÓN REAL ─────────────────────────────────────────────
router.post('/admin/campeon-real', async (req, res) => {
    try {
        const { seleccionCampeon, golesLocal, golesVisitante } = req.body;
        await query(
            `INSERT INTO resultado_campeon (seleccion_campeon, goles_local, goles_visitante) VALUES ($1, $2, $3)`,
            [seleccionCampeon, golesLocal, golesVisitante]
        );
        return res.json({ ok: true, message: '🏆 Campeón real registrado.' });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: BOLSA ────────────────────────────────────────────────────────────
router.get('/admin/bolsa', async (req, res) => {
    try {
        const insResult = await query(
            `SELECT COALESCE(SUM(b.monto),0) AS total_recaudado, COUNT(DISTINCT s.id_usuario) AS total_participantes
             FROM suscripciones s INNER JOIN bolsa b ON b.id_usuario=s.id_usuario WHERE s.activa=TRUE`
        );

        const totalRecaudado     = parseFloat(insResult.rows[0].total_recaudado) || 0;
        const totalParticipantes = parseInt(insResult.rows[0].total_participantes) || 0;
        const bolsaPremios       = totalRecaudado * 0.85;
        const cuotaAdmin         = totalRecaudado * 0.15;
        const premio1 = bolsaPremios * 0.50;
        const premio2 = bolsaPremios * 0.30;
        const premio3 = bolsaPremios * 0.20;

        const rankingResult = await query(`
            SELECT u.id_usuario AS "IdUsuario", u.nombre AS "Nombre",
                   COALESCE(p.puntos_totales,0) AS "Puntos",
                   DENSE_RANK() OVER (ORDER BY COALESCE(p.puntos_totales,0) DESC) AS "Posicion"
            FROM usuarios u LEFT JOIN puntajes p ON u.id_usuario=p.id_usuario
            WHERE u.activo=TRUE LIMIT 5
        `);

        const ranking = rankingResult.rows;
        const pos1 = ranking.filter(u => u.Posicion === 1);
        const pos2 = ranking.filter(u => u.Posicion === 2);
        const pos3 = ranking.filter(u => u.Posicion === 3);
        const combinar = (arr, premios) => { const t=premios.reduce((a,b)=>a+b,0); return arr.map(u=>({...u,montoPremio:t/arr.length,porcentaje:((t/bolsaPremios)*100/arr.length).toFixed(2)})); };

        let distribucion = [];
        if (pos1.length>1)      distribucion=[...combinar(pos1,[premio1,premio2]),...combinar(pos2.length?pos2:pos3,[premio3])];
        else if (pos2.length>1) distribucion=[...combinar(pos1,[premio1]),...combinar(pos2,[premio2,premio3])];
        else if (pos3.length>1) distribucion=[...combinar(pos1,[premio1]),...combinar(pos2,[premio2]),...combinar(pos3,[premio3])];
        else distribucion=[...(pos1[0]?[{...pos1[0],montoPremio:premio1,porcentaje:'50.00'}]:[]),...(pos2[0]?[{...pos2[0],montoPremio:premio2,porcentaje:'30.00'}]:[]),...(pos3[0]?[{...pos3[0],montoPremio:premio3,porcentaje:'20.00'}]:[])];

        return res.json({ ok:true, totalRecaudado, totalParticipantes, bolsaPremios, cuotaAdmin, premio1, premio2, premio3, distribucion, ranking });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ESTADO QUINIELA ──────────────────────────────────────────────────────────
router.get('/estado-quiniela', async (req, res) => {
    try {
        const config  = await query(`SELECT clave, valor FROM config_quiniela`);
        const estado  = {};
        config.rows.forEach(r => { estado[r.clave] = r.valor; });

        let ganadores = [];
        if (estado.GanadoresRevelados === '1') {
            const result = await query(
                `SELECT g.posicion AS "Posicion", g.puntos AS "Puntos", g.monto_premio AS "MontoPremio",
                        g.porcentaje_premio AS "PorcentajePremio", u.nombre AS "Nombre", u.foto_url AS "FotoUrl"
                 FROM ganadores_finales g INNER JOIN usuarios u ON g.id_usuario=u.id_usuario
                 ORDER BY g.posicion ASC, g.monto_premio DESC`
            );
            ganadores = result.rows;
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
        if (config.rows[0]?.valor === '1')
            return res.status(409).json({ ok: false, message: '⚠️ Los ganadores ya fueron revelados.' });

        const bolsaR  = await query(`SELECT COALESCE(SUM(monto),0) AS total FROM bolsa`);
        const totalRecaudado = parseFloat(bolsaR.rows[0].total) || 0;
        const bolsaPremios   = totalRecaudado * 0.85;
        const premio1 = bolsaPremios*0.50, premio2 = bolsaPremios*0.30, premio3 = bolsaPremios*0.20;

        const rankingResult = await query(`
            SELECT u.id_usuario AS "IdUsuario", u.nombre AS "Nombre",
                   COALESCE(p.puntos_totales,0) AS "Puntos",
                   DENSE_RANK() OVER (ORDER BY COALESCE(p.puntos_totales,0) DESC) AS "Posicion"
            FROM usuarios u LEFT JOIN puntajes p ON u.id_usuario=p.id_usuario WHERE u.activo=TRUE AND u.id_usuario <> 1
        `);

        const ranking = rankingResult.rows;
        const groups = {};
        ranking.forEach(u => {
            if (!groups[u.Puntos]) groups[u.Puntos] = [];
            groups[u.Puntos].push(u);
        });

        const sortedPoints = Object.keys(groups).map(Number).sort((a,b) => b - a);
        const prizes = [premio1, premio2, premio3];
        let distribucion = [];

        let prizeIdx = 0;
        for (const pts of sortedPoints) {
            if (prizeIdx >= prizes.length) break;
            const groupUsers = groups[pts];
            const L = groupUsers.length;
            const groupPrizes = prizes.slice(prizeIdx, prizeIdx + L);
            prizeIdx += L;

            if (groupPrizes.length === 0) break;

            const sumPrizes = groupPrizes.reduce((a,b) => a + b, 0);
            const prizePerUser = sumPrizes / L;
            const pctPerUser = ((sumPrizes / bolsaPremios) * 100 / L).toFixed(2);

            groupUsers.forEach(u => {
                distribucion.push({
                    IdUsuario: u.IdUsuario,
                    Nombre: u.Nombre,
                    Puntos: u.Puntos,
                    Posicion: u.Posicion,
                    montoPremio: prizePerUser,
                    porcentaje: pctPerUser
                });
            });
        }

        for (const g of distribucion) {
            await query(
                `INSERT INTO ganadores_finales (id_usuario,posicion,puntos,porcentaje_premio,monto_premio) VALUES ($1,$2,$3,$4,$5)`,
                [g.IdUsuario, g.Posicion, g.Puntos, parseFloat(g.porcentaje), g.montoPremio]
            );
        }

        await query(`UPDATE config_quiniela SET valor='1' WHERE clave='GanadoresRevelados'`);

        const todos = await query(
            `SELECT u.id_usuario, u.nombre, u.correo, COALESCE(p.puntos_totales,0) AS puntos,
                    DENSE_RANK() OVER (ORDER BY COALESCE(p.puntos_totales,0) DESC) AS posicion
             FROM usuarios u LEFT JOIN puntajes p ON u.id_usuario=p.id_usuario
             WHERE u.activo=TRUE AND u.correo IS NOT NULL AND u.correo!=''`
        );

        const fmt = n => `$${Number(n).toLocaleString('es-MX',{minimumFractionDigits:2})} MXN`;
        const medallas = {1:'🥇',2:'🥈',3:'🥉'};
        const tablaHTML = distribucion.map(g=>`<tr><td>${medallas[g.Posicion]}</td><td>${g.Nombre}</td><td>${g.Puntos} pts</td><td style="color:#2ecc71;">${fmt(g.montoPremio)}</td></tr>`).join('');

        for (const u of todos.rows) {
            const ganadorInfo = distribucion.find(g => g.IdUsuario === u.id_usuario);
            const html = `<div style="font-family:sans-serif;max-width:600px;background:#05101a;color:white;border-radius:16px;overflow:hidden;">
                <div style="background:linear-gradient(135deg,#f1c40f,#d4ac0d);padding:2rem;text-align:center;"><h1 style="color:#000;">🏆 ¡El Mundial ha terminado!</h1></div>
                ${ganadorInfo?`<div style="padding:1.5rem;text-align:center;"><p style="font-size:3rem;">${medallas[ganadorInfo.Posicion]}</p><h2 style="color:#2ecc71;">¡Felicidades ${u.nombre}!</h2><p>Premio: <strong style="color:#f1c40f;font-size:1.5rem;">${fmt(ganadorInfo.montoPremio)}</strong></p></div>`:`<div style="padding:1.5rem;text-align:center;"><p>Hola ${u.nombre}, terminaste en ${u.posicion}° con ${u.puntos} pts. ¡Gracias por participar!</p></div>`}
                <div style="padding:1rem;"><table style="width:100%;"><thead><tr><th>Pos</th><th>Nombre</th><th>Puntos</th><th>Premio</th></tr></thead><tbody>${tablaHTML}</tbody></table></div>
                <div style="padding:1rem;text-align:center;"><small>Quiniela Mundial 2026 — torreslab</small></div></div>`;
            enviarCorreoResultado({ correo:u.correo, nombre:u.nombre, asunto:'🏆 Resultados Quiniela Mundial 2026', htmlPersonalizado:html }).catch(console.error);
        }

        return res.json({ ok: true, message: `🏆 Ganadores revelados y correos enviados.`, distribucion });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: PENDIENTES ────────────────────────────────────────────────────────
router.get('/admin/pendientes', async (req, res) => {
    try {
        const result = await query(
            `SELECT id_pendiente AS "IdPendiente", fixture_id AS "FixtureId", local_nombre AS "LocalNombre",
                    visitante_nombre AS "VisitanteNombre", goles_local AS "GolesLocal", goles_visitante AS "GolesVisitante",
                    fecha_partido AS "FechaPartido", validado AS "Validado", partido_id AS "PartidoId"
             FROM resultados_pendientes WHERE validado=FALSE ORDER BY fecha_partido ASC`
        );
        return res.json({ ok: true, pendientes: result.rows });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

router.post('/admin/validar-pendiente', async (req, res) => {
    try {
        const { idPendiente, partidoId } = req.body;
        const pendiente = await query(`SELECT * FROM resultados_pendientes WHERE id_pendiente=$1`, [idPendiente]);
        if (pendiente.rows.length === 0) return res.status(404).json({ ok: false, message: 'No encontrado.' });

        const { goles_local, goles_visitante, local_nombre, visitante_nombre } = pendiente.rows[0];

        await query(
            `INSERT INTO resultados_reales (partido_id,goles_local,goles_visitante) VALUES ($1,$2,$3)
             ON CONFLICT (partido_id) DO UPDATE SET goles_local=$2, goles_visitante=$3`,
            [partidoId, goles_local, goles_visitante]
        );
        await query(
            `UPDATE resultados_pendientes SET validado=TRUE, fecha_validacion=NOW(), partido_id=$1 WHERE id_pendiente=$2`,
            [partidoId, idPendiente]
        );

        const pros = await query(
            `SELECT p.id_usuario, p.goles_local AS pro_local, p.goles_visitante AS pro_visitante, u.nombre, u.correo
             FROM pronosticos p INNER JOIN usuarios u ON p.id_usuario=u.id_usuario
             WHERE p.partido_id=$1 AND u.correo IS NOT NULL`,
            [partidoId]
        );
        for (const pro of pros.rows) {
            let puntos=0, estado='Falló';
            if (pro.pro_local===goles_local&&pro.pro_visitante===goles_visitante) { puntos=5; estado='Exacto'; }
            else if ((pro.pro_local>pro.pro_visitante&&goles_local>goles_visitante)||(pro.pro_local<pro.pro_visitante&&goles_local<goles_visitante)||(pro.pro_local===pro.pro_visitante&&goles_local===goles_visitante)) { puntos=3; estado='Acierto'; }
            enviarCorreoResultado({ correo:pro.correo, nombre:pro.nombre, local:local_nombre, visitante:visitante_nombre, golesLocal:goles_local, golesVisitante:goles_visitante, proLocal:pro.pro_local, proVisitante:pro.pro_visitante, puntos, estado }).catch(console.error);
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
        const result = await query(`
            SELECT 
                u.nombre AS "Usuario",
                u.correo AS "Correo",
                p.partido_id AS "Partido #",
                p.goles_local AS "Pronóstico Local",
                p.goles_visitante AS "Pronóstico Visitante",
                COALESCE(CAST(r.goles_local AS TEXT), '-') AS "Resultado Local",
                COALESCE(CAST(r.goles_visitante AS TEXT), '-') AS "Resultado Visitante",
                pd.modificaciones_usadas AS "Modificaciones",
                CASE
                    WHEN r.goles_local IS NULL THEN 'Pendiente'
                    WHEN p.goles_local = r.goles_local AND p.goles_visitante = r.goles_visitante THEN '5 — Exacto'
                    WHEN r.goles_local = r.goles_visitante AND p.goles_local = p.goles_visitante THEN '1 — Empate correcto'
                    WHEN (p.goles_local > p.goles_visitante AND r.goles_local > r.goles_visitante)
                      OR (p.goles_local < p.goles_visitante AND r.goles_local < r.goles_visitante) THEN '3 — Ganador correcto'
                    ELSE '0 — Falló'
                END AS "Puntos",
                COALESCE(pt.puntos_totales, 0) AS "Puntos Totales"
            FROM pronosticos p
            INNER JOIN usuarios u ON p.id_usuario = u.id_usuario
            LEFT JOIN resultados_reales r ON p.partido_id = r.partido_id
            LEFT JOIN partidos_desbloqueados pd ON pd.id_usuario = p.id_usuario AND pd.partido_id = p.partido_id
            LEFT JOIN puntajes pt ON pt.id_usuario = u.id_usuario
            WHERE u.activo = TRUE
            ORDER BY u.nombre ASC, p.partido_id ASC
        `);
        return res.json({ ok: true, pronosticos: result.rows });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al exportar.' });
    }
});
// ─── ADMIN: LOGS DE ACTIVIDAD ──────────────────────────────────────────────────
router.get('/admin/logs', async (req, res) => {
    try {
        const result = await query(`
            SELECT l.id_log AS "IdLog", l.id_usuario AS "IdUsuario", u.nombre AS "NombreUsuario",
                   l.accion AS "Accion", l.partido_id AS "PartidoId", l.detalle AS "Detalle",
                   l.fecha AS "Fecha", l.exito AS "Exito", l.error_message AS "ErrorMessage"
            FROM logs_actividad l
            LEFT JOIN usuarios u ON l.id_usuario=u.id_usuario
            ORDER BY l.fecha DESC LIMIT 100
        `);
        return res.json({ ok: true, logs: result.rows });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al obtener logs.' });
    }
});

router.post('/admin/sincronizar', async (req, res) => {
    try {
        const { sincronizarResultados } = require('./sync-resultados');
        await sincronizarResultados();
        return res.json({ ok: true, message: '✅ Sincronización manual completada con éxito.' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al sincronizar.' });
    }
});

module.exports = router;