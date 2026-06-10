const express    = require('express');
const router     = express.Router();
const { z }      = require('zod');
const nodemailer = require('nodemailer');
const { query } = require('./db');
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

function validarTokenAdmin(req, res, next) {
    const token  = req.headers['x-admin-token'] || req.query.adminToken;
    if (!token) return res.status(401).json({ ok: false, message: 'No autorizado.' });
    const secret        = process.env.ADMIN_SECRET || "default-admin-secret-2026-torreslab";
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
    const secret        = process.env.ADMIN_SECRET || "default-admin-secret-2026-torreslab";
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
            `SELECT id_suscripcion FROM suscripciones WHERE id_usuario=$1 AND activa=TRUE`,
            [idUsuario]
        );

        if (sub.rows.length === 0) {
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

            const horaLimpia   = partido.hora.replace(" hrs", "");
            const fechaPartido = new Date(`${partido.fecha} ${horaLimpia}:00 GMT-0600`);
            const msHasta      = fechaPartido.getTime() - Date.now();

            if (msHasta <= 0) {
                const errMsg = 'El partido ya comenzó.';
                errores.push(`Partido #${pro.partidoId} (${partido.local} vs ${partido.visitante}) ${errMsg}`);
                await registrarLogActividad({ idUsuario, accion:'guardar_quiniela', partidoId:pro.partidoId, detalle:`Pronóstico: ${pro.golesLocal}-${pro.golesVisitante}`, exito:false, errorMessage:errMsg });
                continue;
            }

            const desbloq = await query(
                `SELECT id_desbloqueo AS "IdDesbloqueo", modificaciones_usadas AS "ModificacionesUsadas"
                 FROM partidos_desbloqueados WHERE id_usuario=$1 AND partido_id=$2`,
                [idUsuario, pro.partidoId]
            );

            let modUsadas = 0, idDesbloqueo = null;
            if (desbloq.rows.length > 0) {
                modUsadas    = desbloq.rows[0].ModificacionesUsadas;
                idDesbloqueo = desbloq.rows[0].IdDesbloqueo;
            }

            if (modUsadas >= 3) {
                const errMsg = 'Agotaste tus 3 modificaciones.';
                errores.push(`Partido #${pro.partidoId}: ${errMsg}`);
                await registrarLogActividad({ idUsuario, accion:'guardar_quiniela', partidoId:pro.partidoId, detalle:`Pronóstico: ${pro.golesLocal}-${pro.golesVisitante}`, exito:false, errorMessage:errMsg });
                continue;
            }

            // Guardar pronóstico
            await query(
                `INSERT INTO pronosticos (id_usuario,partido_id,goles_local,goles_visitante)
                 VALUES ($1,$2,$3,$4)
                 ON CONFLICT (id_usuario,partido_id) DO UPDATE SET goles_local=$3, goles_visitante=$4`,
                [idUsuario, pro.partidoId, pro.golesLocal, pro.golesVisitante]
            );

            if (idDesbloqueo) {
                await query(
                    `UPDATE partidos_desbloqueados SET modificaciones_usadas=modificaciones_usadas+1 WHERE id_desbloqueo=$1`,
                    [idDesbloqueo]
                );
            } else {
                await query(
                    `INSERT INTO partidos_desbloqueados (id_usuario,partido_id,modificaciones_usadas,goles_gastados) VALUES ($1,$2,0,0)`,
                    [idUsuario, pro.partidoId]
                );
            }

            await registrarLogActividad({ idUsuario, accion:'guardar_quiniela', partidoId:pro.partidoId, detalle:`Pronóstico: ${pro.golesLocal}-${pro.golesVisitante}`, exito:true });
            guardados++;
        }

        await query(
            `INSERT INTO quinielas (id_usuario,estatus) VALUES ($1,'Borrador') ON CONFLICT (id_usuario) DO NOTHING`,
            [idUsuario]
        );

        const desb = await query(
            `SELECT partido_id AS "PartidoId", modificaciones_usadas AS "ModificacionesUsadas", goles_gastados AS "GolesGastados"
             FROM partidos_desbloqueados WHERE id_usuario=$1`,
            [idUsuario]
        );

        const msg = errores.length > 0 ? `⚠️ No se pudo guardar: ${errores.join(' | ')}` : `✅ Pronóstico guardado correctamente.`;
        return res.json({ ok: guardados > 0, message: msg, partidosDesbloqueados: desb.rows });

    } catch (error) {
        console.error(error);
        await registrarLogActividad({ idUsuario, accion:'guardar_quiniela', exito:false, errorMessage:error.message });
        return res.status(400).json({ ok: false, message: 'Error al procesar.' });
    }
});

// ─── OBTENER QUINIELA ─────────────────────────────────────────────────────────
router.get('/obtener-quiniela/:idUsuario', validarTokenUsuario, async (req, res) => {
    try {
        const result = await query(
            `SELECT partido_id AS "PartidoId", goles_local AS "GolesLocal", goles_visitante AS "GolesVisitante"
             FROM pronosticos WHERE id_usuario=$1`,
            [parseInt(req.params.idUsuario)]
        );
        return res.json({ ok: true, pronosticos: result.rows });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error al recuperar datos.' });
    }
});

// ─── MIS DATOS ────────────────────────────────────────────────────────────────
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

        return res.json({ ok: true, suscripcion: sub.rows[0] || null, partidosDesbloqueados: desb.rows });
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
            `INSERT INTO resultados_reales (partido_id,goles_local,goles_visitante)
             VALUES ($1,$2,$3) ON CONFLICT (partido_id) DO UPDATE SET goles_local=$2, goles_visitante=$3`,
            [partidoId, golesLocal, golesVisitante]
        );

        res.json({ ok: true, message: 'Resultado guardado. Enviando notificaciones...' });

        const pros = await query(
            `SELECT p.id_usuario AS "IdUsuario", p.goles_local AS "ProLocal", p.goles_visitante AS "ProVisitante",
                    u.nombre AS "Nombre", u.correo AS "Correo"
             FROM pronosticos p INNER JOIN usuarios u ON p.id_usuario=u.id_usuario
             WHERE p.partido_id=$1 AND u.correo IS NOT NULL AND u.correo!=''`,
            [partidoId]
        );

        for (const pro of pros.rows) {
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
        const result = await query().query(`SELECT PartidoId, GolesLocal, GolesVisitante FROM ResultadosReales`);
        return res.json({ ok: true, resultados: result.rows });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── CALCULAR PUNTOS ──────────────────────────────────────────────────────────
router.post('/calcular-puntos', validarTokenAdmin, async (req, res) => {
    try {
        const pros = await query().query(`
            SELECT p.IdUsuario, p.GolesLocal AS ProLocal, p.GolesVisitante AS ProVisitante,
                   r.GolesLocal AS RealLocal, r.GolesVisitante AS RealVisitante
            FROM Pronosticos p INNER JOIN ResultadosReales r ON p.PartidoId=r.PartidoId
        `);

        const todosUsers = await query().query(`SELECT IdUsuario FROM Usuarios WHERE Activo=1`);
        const mapaPuntos = {}, mapaAciertos = {};
        todosUsers.rows.forEach(u => { mapaPuntos[u.IdUsuario]=0; mapaAciertos[u.IdUsuario]=0; });

        pros.rows.forEach(row => {
            const id = row.IdUsuario;
            if (row.ProLocal===row.RealLocal && row.ProVisitante===row.RealVisitante) { mapaPuntos[id]+=5; mapaAciertos[id]+=1; }
            else if (row.ProLocal===row.ProVisitante && row.RealLocal===row.RealVisitante) { mapaPuntos[id]+=1; mapaAciertos[id]+=1; }
            else if ((row.ProLocal>row.ProVisitante&&row.RealLocal>row.RealVisitante)||(row.ProLocal<row.ProVisitante&&row.RealLocal<row.RealVisitante)) { mapaPuntos[id]+=3; mapaAciertos[id]+=1; }
        });

        const campeon = await query(`SELECT * FROM resultado_campeon ORDER BY id_resultado DESC LIMIT 1`);
        if (campeon.rows.length > 0) {
            const { seleccion_campeon: SeleccionCampeon, goles_local: cRL, goles_visitante: cRV } = campeon.rows[0];
            const prosCampeon = await query(`SELECT * FROM pronosticos_campeon`);
            prosCampeon.rows.forEach(pc => {
                if (!mapaPuntos[pc.IdUsuario]) mapaPuntos[pc.IdUsuario]=0;
                if (pc.SeleccionCampeon.toLowerCase()===SeleccionCampeon.toLowerCase() && pc.GolesLocal===cRL && pc.GolesVisitante===cRV) mapaPuntos[pc.IdUsuario]+=25;
                else if (pc.SeleccionCampeon.toLowerCase()===SeleccionCampeon.toLowerCase()) mapaPuntos[pc.IdUsuario]+=15;
            });
        }

        for (const id in mapaPuntos) {
            await query(
                `INSERT INTO puntajes (id_usuario,puntos_totales) VALUES ($1,$2)
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
        const result = await query().query(`
            SELECT u.IdUsuario, u.Nombre, u.FotoUrl,
                   COALESCE(p.PuntosTotales,0) AS Puntos,
                   DENSE_RANK() OVER (ORDER BY COALESCE(p.PuntosTotales,0) DESC) AS PosicionReal,
                   (SELECT COUNT(*) FROM Pronosticos pr WHERE pr.IdUsuario=u.IdUsuario) AS Predicciones,
                   (SELECT COUNT(*) FROM Pronosticos pr
                    INNER JOIN ResultadosReales rr ON pr.PartidoId=rr.PartidoId
                    WHERE pr.IdUsuario=u.IdUsuario AND (
                        (pr.GolesLocal=rr.GolesLocal AND pr.GolesVisitante=rr.GolesVisitante) OR
                        (pr.GolesLocal>pr.GolesVisitante AND rr.GolesLocal>rr.GolesVisitante) OR
                        (pr.GolesLocal<pr.GolesVisitante AND rr.GolesLocal<rr.GolesVisitante) OR
                        (pr.GolesLocal=pr.GolesVisitante AND rr.GolesLocal=rr.GolesVisitante)
                    )) AS Aciertos
            FROM Usuarios u
            LEFT JOIN Puntajes p ON u.IdUsuario=p.IdUsuario
            WHERE u.Activo=1 AND u.IdUsuario != 1
            ORDER BY Puntos DESC, Aciertos DESC, u.Nombre ASC
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
            `SELECT p.partido_id AS "PartidoId", p.goles_local AS "ProLocal", p.goles_visitante AS "ProVisitante",
                       r.goles_local AS "RealLocal", r.goles_visitante AS "RealVisitante"
             FROM pronosticos p LEFT JOIN resultados_reales r ON p.partido_id=r.partido_id
             WHERE p.id_usuario=$1`,
            [idUsuario]
        );

        const rankingQ = await query().query(`
            SELECT IdUsuario, DENSE_RANK() OVER (ORDER BY COALESCE(PuntosTotales,0) DESC) AS Posicion FROM puntajes
        `);
        const miPos = rankingQ.rows.find(u => u.IdUsuario === idUsuario);

        let exactos=0, correctos=0, fallados=0, pendientes=0, puntos=0;
        const historial = result.rows.map(row => {
            let pts=0, estado='Pendiente';
            if (row.RealLocal===null) { pendientes++; }
            else if (row.ProLocal===row.RealLocal&&row.ProVisitante===row.RealVisitante) { exactos++; pts=5; estado='Exacto'; }
            else if (row.ProLocal===row.ProVisitante&&row.RealLocal===row.RealVisitante) { correctos++; pts=1; estado='Acierto'; }
            else if ((row.ProLocal>row.ProVisitante&&row.RealLocal>row.RealVisitante)||(row.ProLocal<row.ProVisitante&&row.RealLocal<row.RealVisitante)) { correctos++; pts=3; estado='Acierto'; }
            else { fallados++; estado='Falló'; }
            puntos+=pts;
            return { partidoId:row.PartidoId, pronostico:`${row.ProLocal} - ${row.ProVisitante}`, resultadoReal:row.RealLocal!==null?`${row.RealLocal} - ${row.RealVisitante}`:'Pendiente', puntos:pts, estado };
        });

        const completados = exactos+correctos+fallados;
        return res.json({
            ok: true,
            posicion: miPos ? `${miPos.Posicion}° lugar` : '1° lugar',
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
        const DEADLINE = new Date("2026-06-11T13:00:00 GMT-0600").getTime();
        const body = req.body;
        idUsuario = body?.idUsuario; seleccion = body?.seleccionCampeon; gl = body?.golesLocal; gv = body?.golesVisitante;

        if (Date.now() >= DEADLINE) {
            const errMsg = '⛔ El pronóstico de campeón ya está bloqueado.';
            await registrarLogActividad({ idUsuario, accion:'guardar_campeon', detalle:`Intento: ${seleccion} (${gl}-${gv})`, exito:false, errorMessage:errMsg });
            return res.status(403).json({ ok: false, message: errMsg });
        }

        const { idUsuario:valId, seleccionCampeon, golesLocal, golesVisitante } = campeonSchema.parse(req.body);
        await query(
            `INSERT INTO pronosticos_campeon (id_usuario,seleccion_campeon,goles_local,goles_visitante)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (id_usuario) DO UPDATE SET seleccion_campeon=$2, goles_local=$3, goles_visitante=$4, fecha_actualizacion=NOW()`,
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
        const result = await query().query(`SELECT IdPaquete, Nombre, Precio, Goles, MaxPartidos FROM Paquetes WHERE Nombre='Premium'`);
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
        const paq = await query(
            `SELECT goles AS "Goles", nombre AS "Nombre", precio AS "Precio" FROM paquetes WHERE id_paquete=$1`,
            [idPaquete]
        );
        if (paq.rows.length === 0) return res.status(404).json({ ok: false, message: 'Paquete no encontrado.' });

        const { Goles, Nombre, Precio } = paq.rows[0];
        await query(`UPDATE suscripciones SET activa=FALSE WHERE id_usuario=$1 AND activa=TRUE`, [idUsuario]);
        await query(
            `INSERT INTO suscripciones (id_usuario,id_paquete,goles_restantes,notas) VALUES ($1,$2,$3,$4)`,
            [idUsuario, idPaquete, Goles, notas || null]
        );

        await query(
            `INSERT INTO bolsa (id_usuario,monto,concepto) VALUES ($1,$2,$3)`,
            [idUsuario, Precio, `Paquete ${Nombre}`]
        );

        return res.json({ ok: true, message: `✅ Paquete ${Nombre} activado.` });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: USUARIOS CON SUSCRIPCIONES ───────────────────────────────────────
router.get('/admin/usuarios-suscripciones', async (req, res) => {
    try {
        const result = await query().query(`
            SELECT u.IdUsuario, u.Nombre, u.Correo, u.FotoUrl,
                   p.Nombre AS Paquete, p.IdPaquete,
                   s.GolesRestantes, p.Goles AS GolesIniciales,
                   p.MaxPartidos, s.FechaActivacion, s.Notas,
                   CASE WHEN s.IdSuscripcion IS NOT NULL THEN 1 ELSE 0 END AS TieneSuscripcion,
                   (SELECT COUNT(*) FROM PartidosDesbloqueados pd WHERE pd.IdUsuario=u.IdUsuario) AS PartidosDesbloqueados
            FROM Usuarios u
            LEFT JOIN Suscripciones s ON s.IdUsuario=u.IdUsuario AND s.Activa=1
            LEFT JOIN Paquetes p ON p.IdPaquete=s.IdPaquete
            WHERE u.Activo=1
            ORDER BY u.Nombre ASC
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
        await query(
            `UPDATE suscripciones SET goles_restantes=goles_restantes+$1 WHERE id_usuario=$2 AND activa=TRUE`,
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

// ─── ADMIN: BOLSA ────────────────────────────────────────────────────────────
router.get('/admin/bolsa', async (req, res) => {
    try {
        const insResult = await query().query(`
            SELECT COALESCE(SUM(b.Monto),0) AS TotalRecaudado, COUNT(DISTINCT s.IdUsuario) AS TotalParticipantes
            FROM Suscripciones s INNER JOIN Bolsa b ON b.IdUsuario=s.IdUsuario WHERE s.Activa=1
        `);

        const totalRecaudado     = parseFloat(insResult.rows[0].TotalRecaudado) || 0;
        const totalParticipantes = parseInt(insResult.rows[0].TotalParticipantes) || 0;
        const bolsaPremios       = totalRecaudado * 0.85;
        const cuotaAdmin         = totalRecaudado * 0.15;
        const premio1=bolsaPremios*0.50, premio2=bolsaPremios*0.30, premio3=bolsaPremios*0.20;

        const rankingResult = await query().query(`
            SELECT TOP 5 u.IdUsuario, u.Nombre, COALESCE(p.PuntosTotales,0) AS Puntos,
                   DENSE_RANK() OVER (ORDER BY COALESCE(p.PuntosTotales,0) DESC) AS Posicion
            FROM Usuarios u LEFT JOIN Puntajes p ON u.IdUsuario=p.IdUsuario
            WHERE u.Activo=1 ORDER BY Puntos DESC
        `);

        const ranking=rankingResult.rows;
        const pos1=ranking.filter(u=>u.Posicion===1), pos2=ranking.filter(u=>u.Posicion===2), pos3=ranking.filter(u=>u.Posicion===3);
        const combinar=(arr,premios)=>{ const t=premios.reduce((a,b)=>a+b,0); return arr.map(u=>({...u,montoPremio:t/arr.length,porcentaje:((t/bolsaPremios)*100/arr.length).toFixed(2)})); };
        let distribucion=[];
        if(pos1.length>1) distribucion=[...combinar(pos1,[premio1,premio2]),...combinar(pos2.length?pos2:pos3,[premio3])];
        else if(pos2.length>1) distribucion=[...combinar(pos1,[premio1]),...combinar(pos2,[premio2,premio3])];
        else if(pos3.length>1) distribucion=[...combinar(pos1,[premio1]),...combinar(pos2,[premio2]),...combinar(pos3,[premio3])];
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
        const config = await query().query(`SELECT Clave, Valor FROM ConfigQuiniela`);
        const estado = {};
        config.rows.forEach(r => { estado[r.Clave] = r.Valor; });

        let ganadores = [];
        if (estado.GanadoresRevelados === '1') {
            const result = await query().query(`
                SELECT g.Posicion, g.Puntos, g.MontoPremio, g.PorcentajePremio, u.Nombre, u.FotoUrl
                FROM GanadoresFinales g INNER JOIN Usuarios u ON g.IdUsuario=u.IdUsuario
                ORDER BY g.Posicion ASC, g.MontoPremio DESC
            `);
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
        const config = await query().query(`SELECT Valor FROM ConfigQuiniela WHERE Clave='GanadoresRevelados'`);
        if (config.rows[0]?.Valor === '1') return res.status(409).json({ ok: false, message: '⚠️ Ganadores ya revelados.' });

        const bolsaR = await query().query(`SELECT COALESCE(SUM(Monto),0) AS Total FROM Bolsa`);
        const totalRecaudado = parseFloat(bolsaR.rows[0].Total) || 0;
        const bolsaPremios   = totalRecaudado*0.85;
        const premio1=bolsaPremios*0.50, premio2=bolsaPremios*0.30, premio3=bolsaPremios*0.20;

        const rankingResult = await query().query(`
            SELECT u.IdUsuario, u.Nombre, COALESCE(p.PuntosTotales,0) AS Puntos,
                   DENSE_RANK() OVER (ORDER BY COALESCE(p.PuntosTotales,0) DESC) AS Posicion
            FROM Usuarios u LEFT JOIN Puntajes p ON u.IdUsuario=p.IdUsuario
            WHERE u.Activo=1 AND u.IdUsuario<>1
        `);

        const ranking=rankingResult.rows;
        const groups={};
        ranking.forEach(u=>{ if(!groups[u.Puntos]) groups[u.Puntos]=[]; groups[u.Puntos].push(u); });
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
                `INSERT INTO ganadores_finales (id_usuario,posicion,puntos,porcentaje_premio,monto_premio) VALUES ($1,$2,$3,$4,$5)`,
                [g.IdUsuario, g.Posicion, g.Puntos, parseFloat(g.porcentaje), g.montoPremio]
            );
        }

        await query().query(`UPDATE ConfigQuiniela SET Valor='1' WHERE Clave='GanadoresRevelados'`);

        const todos = await query().query(`
            SELECT u.IdUsuario, u.Nombre, u.Correo, COALESCE(p.PuntosTotales,0) AS Puntos,
                   DENSE_RANK() OVER (ORDER BY COALESCE(p.PuntosTotales,0) DESC) AS Posicion
            FROM Usuarios u LEFT JOIN Puntajes p ON u.IdUsuario=p.IdUsuario
            WHERE u.Activo=1 AND u.Correo IS NOT NULL AND u.Correo!=''
        `);

        const fmt=n=>`$${Number(n).toLocaleString('es-MX',{minimumFractionDigits:2})} MXN`;
        const medallas={1:'🥇',2:'🥈',3:'🥉'};
        const tablaHTML=distribucion.map(g=>`<tr><td>${medallas[g.Posicion]}</td><td>${g.Nombre}</td><td>${g.Puntos} pts</td><td>${fmt(g.montoPremio)}</td></tr>`).join('');

        for (const u of todos.rows) {
            const gi=distribucion.find(g=>g.IdUsuario===u.IdUsuario);
            const html=`<div style="font-family:sans-serif;max-width:600px;background:#05101a;color:white;border-radius:16px;overflow:hidden;"><div style="background:linear-gradient(135deg,#f1c40f,#d4ac0d);padding:2rem;text-align:center;"><h1 style="color:#000;">🏆 ¡El Mundial ha terminado!</h1></div>${gi?`<div style="padding:1.5rem;text-align:center;"><p style="font-size:3rem;">${medallas[gi.Posicion]}</p><h2 style="color:#2ecc71;">¡Felicidades ${u.Nombre}!</h2><p>Premio: <strong style="color:#f1c40f;">${fmt(gi.montoPremio)}</strong></p></div>`:`<div style="padding:1.5rem;text-align:center;"><p>Hola ${u.Nombre}, terminaste en ${u.Posicion}° con ${u.Puntos} pts.</p></div>`}<div style="padding:1rem;"><table style="width:100%;"><thead><tr><th>Pos</th><th>Nombre</th><th>Puntos</th><th>Premio</th></tr></thead><tbody>${tablaHTML}</tbody></table></div><div style="padding:1rem;text-align:center;"><small>Quiniela Mundial 2026 — torreslab</small></div></div>`;
            enviarCorreoResultado({ correo:u.Correo, nombre:u.Nombre, asunto:'🏆 Resultados Quiniela Mundial 2026', htmlPersonalizado:html }).catch(console.error);
        }

        return res.json({ ok:true, message:`🏆 Ganadores revelados y correos enviados.`, distribucion });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: PENDIENTES ────────────────────────────────────────────────────────
router.get('/admin/pendientes', async (req, res) => {
    try {
        const result = await query().query(`
            SELECT IdPendiente, FixtureId, LocalNombre, VisitanteNombre, GolesLocal, GolesVisitante, FechaPartido, Validado, PartidoId
            FROM ResultadosPendientes WHERE Validado=0 ORDER BY FechaPartido ASC
        `);
        return res.json({ ok: true, pendientes: result.rows });
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
        if (pendiente.rows.length === 0) return res.status(404).json({ ok: false, message: 'No encontrado.' });

        const { GolesLocal, GolesVisitante, LocalNombre, VisitanteNombre } = pendiente.rows[0];

        await query(
            `INSERT INTO resultados_reales (partido_id,goles_local,goles_visitante)
             VALUES ($1,$2,$3) ON CONFLICT (partido_id) DO UPDATE SET goles_local=$2, goles_visitante=$3`,
            [partidoId, GolesLocal, GolesVisitante]
        );

        await query(
            `UPDATE resultados_pendientes SET validado=TRUE, fecha_validacion=NOW(), partido_id=$1 WHERE id_pendiente=$2`,
            [partidoId, idPendiente]
        );

        const pros = await query(
            `SELECT p.id_usuario AS "IdUsuario", p.goles_local AS "ProLocal", p.goles_visitante AS "ProVisitante",
                    u.nombre AS "Nombre", u.correo AS "Correo"
             FROM pronosticos p INNER JOIN usuarios u ON p.id_usuario=u.id_usuario
             WHERE p.partido_id=$1 AND u.correo IS NOT NULL`,
            [partidoId]
        );
        for (const pro of pros.rows) {
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
        const result = await query().query(`
            SELECT u.Nombre AS [Usuario], u.Correo AS [Correo],
                   p.PartidoId AS [Partido #],
                   p.GolesLocal AS [Pronóstico Local], p.GolesVisitante AS [Pronóstico Visitante],
                   ISNULL(CAST(r.GolesLocal AS NVARCHAR),'-') AS [Resultado Local],
                   ISNULL(CAST(r.GolesVisitante AS NVARCHAR),'-') AS [Resultado Visitante],
                   ISNULL(pd.ModificacionesUsadas,0) AS [Modificaciones],
                   CASE
                       WHEN r.GolesLocal IS NULL THEN 'Pendiente'
                       WHEN p.GolesLocal=r.GolesLocal AND p.GolesVisitante=r.GolesVisitante THEN '5 — Exacto'
                       WHEN r.GolesLocal=r.GolesVisitante AND p.GolesLocal=p.GolesVisitante THEN '1 — Empate correcto'
                       WHEN (p.GolesLocal>p.GolesVisitante AND r.GolesLocal>r.GolesVisitante)
                         OR (p.GolesLocal<p.GolesVisitante AND r.GolesLocal<r.GolesVisitante) THEN '3 — Ganador correcto'
                       ELSE '0 — Falló'
                   END AS [Puntos],
                   ISNULL(pt.PuntosTotales,0) AS [Puntos Totales]
            FROM Pronosticos p
            INNER JOIN Usuarios u ON p.IdUsuario=u.IdUsuario
            LEFT JOIN ResultadosReales r ON p.PartidoId=r.PartidoId
            LEFT JOIN PartidosDesbloqueados pd ON pd.IdUsuario=p.IdUsuario AND pd.PartidoId=p.PartidoId
            LEFT JOIN Puntajes pt ON pt.IdUsuario=u.IdUsuario
            WHERE u.Activo=1
            ORDER BY u.Nombre ASC, p.PartidoId ASC
        `);
        return res.json({ ok: true, pronosticos: result.rows });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al exportar.' });
    }
});

// ─── ADMIN: LOGS ─────────────────────────────────────────────────────────────
router.get('/admin/logs', async (req, res) => {
    try {
        const result = await query().query(`
            SELECT TOP 100 l.IdLog, l.IdUsuario, u.Nombre AS NombreUsuario,
                   l.Accion, l.PartidoId, l.Detalle, l.Fecha, l.Exito, l.ErrorMessage
            FROM LogsActividad l
            LEFT JOIN Usuarios u ON l.IdUsuario=u.IdUsuario
            ORDER BY l.Fecha DESC
        `);
        return res.json({ ok: true, logs: result.rows });
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
            `SELECT p.partido_id AS "PartidoId", p.goles_local AS "ProLocal", p.goles_visitante AS "ProVisitante",
                    r.goles_local AS "RealLocal", r.goles_visitante AS "RealVisitante"
             FROM pronosticos p
             INNER JOIN resultados_reales r ON p.partido_id=r.partido_id
             WHERE p.id_usuario=$1`,
            [idUsuario]
        );

        const puntosPorGrupo = {};
        result.rows.forEach(row => {
            const partido = partidos.find(p => p.id === row.PartidoId);
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

module.exports = router;