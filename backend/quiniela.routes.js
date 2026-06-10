const express    = require('express');
const router     = express.Router();
const { z }      = require('zod');
const nodemailer = require('nodemailer');
const { sql, poolPromise } = require('./db');
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
        const pool = await poolPromise;
        await pool.request()
            .input('IdUsuario',    sql.Int,          idUsuario || null)
            .input('Accion',       sql.NVarChar(100), accion)
            .input('PartidoId',    sql.Int,          partidoId || null)
            .input('Detalle',      sql.NVarChar(500), detalle || null)
            .input('Exito',        sql.Bit,          exito ?? true)
            .input('ErrorMessage', sql.NVarChar(500), errorMessage || null)
            .query(`INSERT INTO dbo.LogsActividad (IdUsuario,Accion,PartidoId,Detalle,Exito,ErrorMessage) VALUES (@IdUsuario,@Accion,@PartidoId,@Detalle,@Exito,@ErrorMessage)`);
    } catch (err) {
        console.error('❌ Error al registrar log:', err);
    }
}


async function sellarPronostico(pool, idUsuario, partidoId, golesLocal, golesVisitante) {
    const fecha = new Date();
    const data  = `${idUsuario}|${partidoId}|${golesLocal}|${golesVisitante}|${fecha.toISOString()}`;
    const hash  = crypto.createHmac('sha256', process.env.ADMIN_SECRET || 'default-admin-secret-2026-torreslab')
                        .update(data).digest('hex');
    await pool.request()
        .input('IdUsuario', sql.Int,          idUsuario)
        .input('PartidoId', sql.Int,          partidoId)
        .input('Fecha',     sql.DateTime,     fecha)
        .input('Hash',      sql.NVarChar(64), hash)
        .query(`
            UPDATE dbo.Pronosticos
            SET FechaRegistro      = CASE WHEN FechaRegistro IS NULL THEN @Fecha ELSE FechaRegistro END,
                FechaActualizacion = @Fecha,
                HashIntegridad     = @Hash,
                ModificadoPor      = NULL
            WHERE IdUsuario = @IdUsuario AND PartidoId = @PartidoId
        `);
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
        const pool = await poolPromise;

        const sub = await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .query(`SELECT IdSuscripcion FROM dbo.Suscripciones WHERE IdUsuario=@IdUsuario AND Activa=1`);

        if (sub.recordset.length === 0) {
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

            const desbloq = await pool.request()
                .input('IdUsuario', sql.Int, idUsuario)
                .input('PartidoId', sql.Int, pro.partidoId)
                .query(`SELECT IdDesbloqueo, ModificacionesUsadas FROM dbo.PartidosDesbloqueados WHERE IdUsuario=@IdUsuario AND PartidoId=@PartidoId`);

            let modUsadas = 0, idDesbloqueo = null;
            if (desbloq.recordset.length > 0) {
                modUsadas    = desbloq.recordset[0].ModificacionesUsadas;
                idDesbloqueo = desbloq.recordset[0].IdDesbloqueo;
            }

            if (modUsadas >= 3) {
                const errMsg = 'Agotaste tus 3 modificaciones.';
                errores.push(`Partido #${pro.partidoId}: ${errMsg}`);
                await registrarLogActividad({ idUsuario, accion:'guardar_quiniela', partidoId:pro.partidoId, detalle:`Pronóstico: ${pro.golesLocal}-${pro.golesVisitante}`, exito:false, errorMessage:errMsg });
                continue;
            }

            // Guardar pronóstico
            await pool.request()
                .input('IdUsuario',      sql.Int, idUsuario)
                .input('PartidoId',      sql.Int, pro.partidoId)
                .input('GolesLocal',     sql.Int, pro.golesLocal)
                .input('GolesVisitante', sql.Int, pro.golesVisitante)
                .query(`
                    IF EXISTS (SELECT 1 FROM dbo.Pronosticos WHERE IdUsuario=@IdUsuario AND PartidoId=@PartidoId)
                        UPDATE dbo.Pronosticos SET GolesLocal=@GolesLocal, GolesVisitante=@GolesVisitante WHERE IdUsuario=@IdUsuario AND PartidoId=@PartidoId
                    ELSE
                        INSERT INTO dbo.Pronosticos (IdUsuario,PartidoId,GolesLocal,GolesVisitante) VALUES (@IdUsuario,@PartidoId,@GolesLocal,@GolesVisitante)
                `);

            if (idDesbloqueo) {
                await pool.request()
                    .input('IdDesbloqueo', sql.Int, idDesbloqueo)
                    .query(`UPDATE dbo.PartidosDesbloqueados SET ModificacionesUsadas=ModificacionesUsadas+1 WHERE IdDesbloqueo=@IdDesbloqueo`);
            } else {
                await pool.request()
                    .input('IdUsuario', sql.Int, idUsuario)
                    .input('PartidoId', sql.Int, pro.partidoId)
                    .query(`INSERT INTO dbo.PartidosDesbloqueados (IdUsuario,PartidoId,ModificacionesUsadas,GolesGastados) VALUES (@IdUsuario,@PartidoId,1,0)`);
            }
            await sellarPronostico(pool, idUsuario, pro.partidoId, pro.golesLocal, pro.golesVisitante);
            await registrarLogActividad({ idUsuario, accion:'guardar_quiniela', partidoId:pro.partidoId, detalle:`Pronóstico: ${pro.golesLocal}-${pro.golesVisitante}`, exito:true });
            guardados++;
        }

        await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .query(`IF NOT EXISTS (SELECT 1 FROM dbo.Quinielas WHERE IdUsuario=@IdUsuario) INSERT INTO dbo.Quinielas (IdUsuario,Estatus) VALUES (@IdUsuario,'Borrador')`);

        const desb = await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .query(`SELECT PartidoId AS "PartidoId", ModificacionesUsadas AS "ModificacionesUsadas", GolesGastados AS "GolesGastados" FROM dbo.PartidosDesbloqueados WHERE IdUsuario=@IdUsuario`);

        const msg = errores.length > 0 ? `⚠️ No se pudo guardar: ${errores.join(' | ')}` : `✅ Pronóstico guardado correctamente.`;
        return res.json({ ok: guardados > 0, message: msg, partidosDesbloqueados: desb.recordset });

    } catch (error) {
        console.error(error);
        await registrarLogActividad({ idUsuario, accion:'guardar_quiniela', exito:false, errorMessage:error.message });
        return res.status(400).json({ ok: false, message: 'Error al procesar.' });
    }
});

// ─── OBTENER QUINIELA ─────────────────────────────────────────────────────────
router.get('/obtener-quiniela/:idUsuario', validarTokenUsuario, async (req, res) => {
    try {
        const pool   = await poolPromise;
        const result = await pool.request()
            .input('IdUsuario', sql.Int, parseInt(req.params.idUsuario))
            .query(`SELECT PartidoId, GolesLocal, GolesVisitante FROM dbo.Pronosticos WHERE IdUsuario=@IdUsuario`);
        return res.json({ ok: true, pronosticos: result.recordset });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error al recuperar datos.' });
    }
});

// ─── MIS DATOS ────────────────────────────────────────────────────────────────
router.get('/mis-datos/:idUsuario', validarTokenUsuario, async (req, res) => {
    try {
        const idUsuario = parseInt(req.params.idUsuario);
        const pool      = await poolPromise;

        const sub = await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .query(`
                SELECT s.GolesRestantes, p.Nombre AS Paquete, p.MaxPartidos, p.Goles AS GolesIniciales
                FROM dbo.Suscripciones s INNER JOIN dbo.Paquetes p ON s.IdPaquete=p.IdPaquete
                WHERE s.IdUsuario=@IdUsuario AND s.Activa=1
            `);

        const desb = await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .query(`SELECT PartidoId AS "PartidoId", ModificacionesUsadas AS "ModificacionesUsadas", GolesGastados AS "GolesGastados" FROM dbo.PartidosDesbloqueados WHERE IdUsuario=@IdUsuario`);

        return res.json({ ok: true, suscripcion: sub.recordset[0] || null, partidosDesbloqueados: desb.recordset });
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
        const pool = await poolPromise;

        await pool.request()
            .input('PartidoId',      sql.Int, partidoId)
            .input('GolesLocal',     sql.Int, golesLocal)
            .input('GolesVisitante', sql.Int, golesVisitante)
            .query(`
                IF EXISTS (SELECT 1 FROM dbo.ResultadosReales WHERE PartidoId=@PartidoId)
                    UPDATE dbo.ResultadosReales SET GolesLocal=@GolesLocal, GolesVisitante=@GolesVisitante WHERE PartidoId=@PartidoId
                ELSE
                    INSERT INTO dbo.ResultadosReales (PartidoId,GolesLocal,GolesVisitante) VALUES (@PartidoId,@GolesLocal,@GolesVisitante)
            `);

        res.json({ ok: true, message: 'Resultado guardado. Enviando notificaciones...' });

        const pros = await pool.request()
            .input('PartidoId', sql.Int, partidoId)
            .query(`
                SELECT p.IdUsuario, p.GolesLocal AS ProLocal, p.GolesVisitante AS ProVisitante, u.Nombre, u.Correo
                FROM dbo.Pronosticos p INNER JOIN dbo.Usuarios u ON p.IdUsuario=u.IdUsuario
                WHERE p.PartidoId=@PartidoId AND u.Correo IS NOT NULL AND u.Correo!=''
            `);

        for (const pro of pros.recordset) {
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
        const pool   = await poolPromise;
        const result = await pool.request().query(`SELECT PartidoId, GolesLocal, GolesVisitante FROM dbo.ResultadosReales`);
        return res.json({ ok: true, resultados: result.recordset });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── CALCULAR PUNTOS ──────────────────────────────────────────────────────────
router.post('/calcular-puntos', validarTokenAdmin, async (req, res) => {
    try {
        const pool = await poolPromise;
        const pros = await pool.request().query(`
            SELECT p.IdUsuario, p.GolesLocal AS ProLocal, p.GolesVisitante AS ProVisitante,
                   r.GolesLocal AS RealLocal, r.GolesVisitante AS RealVisitante
            FROM dbo.Pronosticos p INNER JOIN dbo.ResultadosReales r ON p.PartidoId=r.PartidoId
        `);

        const todosUsers = await pool.request().query(`SELECT IdUsuario FROM dbo.Usuarios WHERE Activo=1`);
        const mapaPuntos = {}, mapaAciertos = {};
        todosUsers.recordset.forEach(u => { mapaPuntos[u.IdUsuario]=0; mapaAciertos[u.IdUsuario]=0; });

        pros.recordset.forEach(row => {
            const id = row.IdUsuario;
            if (row.ProLocal===row.RealLocal && row.ProVisitante===row.RealVisitante) { mapaPuntos[id]+=5; mapaAciertos[id]+=1; }
            else if (row.ProLocal===row.ProVisitante && row.RealLocal===row.RealVisitante) { mapaPuntos[id]+=1; mapaAciertos[id]+=1; }
            else if ((row.ProLocal>row.ProVisitante&&row.RealLocal>row.RealVisitante)||(row.ProLocal<row.ProVisitante&&row.RealLocal<row.RealVisitante)) { mapaPuntos[id]+=3; mapaAciertos[id]+=1; }
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

        return res.json({ ok: true, message: '✅ Puntos recalculados.' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al calcular.' });
    }
});

// ─── TABLA GENERAL ────────────────────────────────────────────────────────────
router.get('/tabla-general', async (req, res) => {
    try {
        const pool   = await poolPromise;
        const result = await pool.request().query(`
            SELECT u.IdUsuario, u.Nombre, u.FotoUrl,
                   COALESCE(p.PuntosTotales,0) AS Puntos,
                   DENSE_RANK() OVER (ORDER BY COALESCE(p.PuntosTotales,0) DESC) AS PosicionReal,
                   (SELECT COUNT(*) FROM dbo.Pronosticos pr WHERE pr.IdUsuario=u.IdUsuario) AS Predicciones,
                   (SELECT COUNT(*) FROM dbo.Pronosticos pr
                    INNER JOIN dbo.ResultadosReales rr ON pr.PartidoId=rr.PartidoId
                    WHERE pr.IdUsuario=u.IdUsuario AND (
                        (pr.GolesLocal=rr.GolesLocal AND pr.GolesVisitante=rr.GolesVisitante) OR
                        (pr.GolesLocal>pr.GolesVisitante AND rr.GolesLocal>rr.GolesVisitante) OR
                        (pr.GolesLocal<pr.GolesVisitante AND rr.GolesLocal<rr.GolesVisitante) OR
                        (pr.GolesLocal=pr.GolesVisitante AND rr.GolesLocal=rr.GolesVisitante)
                    )) AS Aciertos
            FROM dbo.Usuarios u
            LEFT JOIN dbo.Puntajes p ON u.IdUsuario=p.IdUsuario
            WHERE u.Activo=1 AND u.IdUsuario != 1
            ORDER BY Puntos DESC, Aciertos DESC, u.Nombre ASC
        `);
        return res.json({ ok: true, ranking: result.recordset });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── MIS RESULTADOS ───────────────────────────────────────────────────────────
router.get('/mis-resultados/:idUsuario', validarTokenUsuario, async (req, res) => {
    try {
        const idUsuario = parseInt(req.params.idUsuario);
        const pool      = await poolPromise;

        const result = await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .query(`
                SELECT p.PartidoId, p.GolesLocal AS ProLocal, p.GolesVisitante AS ProVisitante,
                       r.GolesLocal AS RealLocal, r.GolesVisitante AS RealVisitante
                FROM dbo.Pronosticos p LEFT JOIN dbo.ResultadosReales r ON p.PartidoId=r.PartidoId
                WHERE p.IdUsuario=@IdUsuario
            `);

        const rankingQ = await pool.request().query(`
            SELECT IdUsuario, DENSE_RANK() OVER (ORDER BY COALESCE(PuntosTotales,0) DESC) AS Posicion FROM dbo.Puntajes
        `);
        const miPos = rankingQ.recordset.find(u => u.IdUsuario === idUsuario);

        let exactos=0, correctos=0, fallados=0, pendientes=0, puntos=0;
        const historial = result.recordset.map(row => {
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
        const pool = await poolPromise;
        await pool.request()
            .input('IdUsuario',        sql.Int,          valId)
            .input('SeleccionCampeon', sql.NVarChar(100), seleccionCampeon)
            .input('GolesLocal',       sql.Int,          golesLocal)
            .input('GolesVisitante',   sql.Int,          golesVisitante)
            .query(`
                IF EXISTS (SELECT 1 FROM dbo.PronosticosCampeon WHERE IdUsuario=@IdUsuario)
                    UPDATE dbo.PronosticosCampeon SET SeleccionCampeon=@SeleccionCampeon, GolesLocal=@GolesLocal, GolesVisitante=@GolesVisitante, FechaActualizacion=GETDATE() WHERE IdUsuario=@IdUsuario
                ELSE
                    INSERT INTO dbo.PronosticosCampeon (IdUsuario,SeleccionCampeon,GolesLocal,GolesVisitante) VALUES (@IdUsuario,@SeleccionCampeon,@GolesLocal,@GolesVisitante)
            `);

        await registrarLogActividad({ idUsuario:valId, accion:'guardar_campeon', detalle:`Campeón: ${seleccionCampeon} (${golesLocal}-${golesVisitante})`, exito:true });
        return res.json({ ok: true, message: '🏆 Pronóstico de campeón guardado.' });
    } catch (error) {
        await registrarLogActividad({ idUsuario, accion:'guardar_campeon', detalle:`Intento: ${seleccion} (${gl}-${gv})`, exito:false, errorMessage:error.message });
        return res.status(400).json({ ok: false, message: 'Error.' });
    }
});

router.get('/campeon/:idUsuario', validarTokenUsuario, async (req, res) => {
    try {
        const pool   = await poolPromise;
        const result = await pool.request()
            .input('IdUsuario', sql.Int, parseInt(req.params.idUsuario))
            .query(`SELECT SeleccionCampeon, GolesLocal, GolesVisitante FROM dbo.PronosticosCampeon WHERE IdUsuario=@IdUsuario`);
        return res.json({ ok: true, campeon: result.recordset[0] || null });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── PAQUETES ────────────────────────────────────────────────────────────────
router.get('/paquetes', async (req, res) => {
    try {
        const pool   = await poolPromise;
        const result = await pool.request().query(`SELECT IdPaquete, Nombre, Precio, Goles, MaxPartidos FROM dbo.Paquetes WHERE Nombre='Premium'`);
        return res.json({ ok: true, paquetes: result.recordset });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: ACTIVAR SUSCRIPCIÓN ───────────────────────────────────────────────
router.post('/admin/activar-suscripcion', async (req, res) => {
    try {
        const { idUsuario, idPaquete, notas } = req.body;
        if (!idUsuario || !idPaquete) return res.status(400).json({ ok: false, message: 'Datos incompletos.' });
        const pool = await poolPromise;

        const paq = await pool.request()
            .input('IdPaquete', sql.Int, idPaquete)
            .query(`SELECT Goles, Nombre, Precio FROM dbo.Paquetes WHERE IdPaquete=@IdPaquete`);
        if (paq.recordset.length === 0) return res.status(404).json({ ok: false, message: 'Paquete no encontrado.' });

        const { Goles, Nombre, Precio } = paq.recordset[0];
        await pool.request().input('IdUsuario', sql.Int, idUsuario).query(`UPDATE dbo.Suscripciones SET Activa=0 WHERE IdUsuario=@IdUsuario AND Activa=1`);
        await pool.request()
            .input('IdUsuario',      sql.Int,          idUsuario)
            .input('IdPaquete',      sql.Int,          idPaquete)
            .input('GolesRestantes', sql.Int,          Goles)
            .input('Notas',          sql.NVarChar(255), notas || null)
            .query(`INSERT INTO dbo.Suscripciones (IdUsuario,IdPaquete,GolesRestantes,Notas) VALUES (@IdUsuario,@IdPaquete,@GolesRestantes,@Notas)`);

        await pool.request()
            .input('IdUsuario', sql.Int,          idUsuario)
            .input('Monto',     sql.Decimal(10,2), Precio)
            .input('Concepto',  sql.NVarChar(255), `Paquete ${Nombre}`)
            .query(`INSERT INTO dbo.Bolsa (IdUsuario,Monto,Concepto) VALUES (@IdUsuario,@Monto,@Concepto)`);

        return res.json({ ok: true, message: `✅ Paquete ${Nombre} activado.` });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: USUARIOS CON SUSCRIPCIONES ───────────────────────────────────────
router.get('/admin/usuarios-suscripciones', async (req, res) => {
    try {
        const pool   = await poolPromise;
        const result = await pool.request().query(`
            SELECT u.IdUsuario, u.Nombre, u.Correo, u.FotoUrl,
                   p.Nombre AS Paquete, p.IdPaquete,
                   s.GolesRestantes, p.Goles AS GolesIniciales,
                   p.MaxPartidos, s.FechaActivacion, s.Notas,
                   CASE WHEN s.IdSuscripcion IS NOT NULL THEN 1 ELSE 0 END AS TieneSuscripcion,
                   (SELECT COUNT(*) FROM dbo.PartidosDesbloqueados pd WHERE pd.IdUsuario=u.IdUsuario) AS PartidosDesbloqueados
            FROM dbo.Usuarios u
            LEFT JOIN dbo.Suscripciones s ON s.IdUsuario=u.IdUsuario AND s.Activa=1
            LEFT JOIN dbo.Paquetes p ON p.IdPaquete=s.IdPaquete
            WHERE u.Activo=1
            ORDER BY u.Nombre ASC
        `);
        return res.json({ ok: true, usuarios: result.recordset });
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
        const pool = await poolPromise;

        await pool.request()
            .input('Goles',     sql.Int, goles)
            .input('IdUsuario', sql.Int, idUsuario)
            .query(`UPDATE dbo.Suscripciones SET GolesRestantes=GolesRestantes+@Goles WHERE IdUsuario=@IdUsuario AND Activa=1`);

        await pool.request()
            .input('IdUsuario', sql.Int,          idUsuario)
            .input('Monto',     sql.Decimal(10,2), parseFloat(monto))
            .input('Concepto',  sql.NVarChar(255), nota || `Recarga ${goles} goles`)
            .query(`INSERT INTO dbo.Bolsa (IdUsuario,Monto,Concepto) VALUES (@IdUsuario,@Monto,@Concepto)`);

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
        const pool = await poolPromise;
        await pool.request()
            .input('SeleccionCampeon', sql.NVarChar(100), seleccionCampeon)
            .input('GolesLocal',       sql.Int,           golesLocal)
            .input('GolesVisitante',   sql.Int,           golesVisitante)
            .query(`INSERT INTO dbo.ResultadoCampeon (SeleccionCampeon,GolesLocal,GolesVisitante) VALUES (@SeleccionCampeon,@GolesLocal,@GolesVisitante)`);
        return res.json({ ok: true, message: '🏆 Campeón real registrado.' });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});
async function getConfigBolsa(pool) {
    const result = await pool.request()
        .query(`SELECT Clave, Valor FROM dbo.ConfigBolsa`);
    const cfg = {};
    result.recordset.forEach(r => { cfg[r.Clave] = parseFloat(r.Valor); });
    // Fallback a hardcoded si la tabla está vacía
    return {
        pctAdmin:   cfg.PctAdmin   ?? 15,
        pctPremio1: cfg.PctPremio1 ?? 50,
        pctPremio2: cfg.PctPremio2 ?? 30,
        pctPremio3: cfg.PctPremio3 ?? 20,
    };
}
 
// ─── ADMIN: BOLSA (reemplaza el existente) ───────────────────────────────────
router.get('/admin/bolsa', async (req, res) => {
    try {
        const pool = await poolPromise;
 
        const [insResult, cfg] = await Promise.all([
            pool.request().query(`
                SELECT COALESCE(SUM(b.Monto),0) AS TotalRecaudado,
                       COUNT(DISTINCT s.IdUsuario) AS TotalParticipantes
                FROM dbo.Suscripciones s
                INNER JOIN dbo.Bolsa b ON b.IdUsuario=s.IdUsuario
                WHERE s.Activa=1
            `),
            getConfigBolsa(pool)
        ]);
 
        const totalRecaudado     = parseFloat(insResult.recordset[0].TotalRecaudado) || 0;
        const totalParticipantes = parseInt(insResult.recordset[0].TotalParticipantes) || 0;
        const bolsaPremios       = totalRecaudado * ((100 - cfg.pctAdmin) / 100);
        const cuotaAdmin         = totalRecaudado * (cfg.pctAdmin / 100);
        const premio1            = bolsaPremios * (cfg.pctPremio1 / 100);
        const premio2            = bolsaPremios * (cfg.pctPremio2 / 100);
        const premio3            = bolsaPremios * (cfg.pctPremio3 / 100);
 
        const rankingResult = await pool.request().query(`
            SELECT TOP 5 u.IdUsuario, u.Nombre, COALESCE(p.PuntosTotales,0) AS Puntos,
                   DENSE_RANK() OVER (ORDER BY COALESCE(p.PuntosTotales,0) DESC) AS Posicion
            FROM dbo.Usuarios u LEFT JOIN dbo.Puntajes p ON u.IdUsuario=p.IdUsuario
            WHERE u.Activo=1 ORDER BY Puntos DESC
        `);
 
        const ranking = rankingResult.recordset;
        const pos1    = ranking.filter(u => u.Posicion === 1);
        const pos2    = ranking.filter(u => u.Posicion === 2);
        const pos3    = ranking.filter(u => u.Posicion === 3);
 
        const combinar = (arr, premios) => {
            const t = premios.reduce((a, b) => a + b, 0);
            return arr.map(u => ({
                ...u,
                montoPremio: t / arr.length,
                porcentaje: ((t / bolsaPremios) * 100 / arr.length).toFixed(2)
            }));
        };
 
        let distribucion = [];
        if      (pos1.length > 1) distribucion = [...combinar(pos1, [premio1, premio2]), ...combinar(pos2.length ? pos2 : pos3, [premio3])];
        else if (pos2.length > 1) distribucion = [...combinar(pos1, [premio1]), ...combinar(pos2, [premio2, premio3])];
        else if (pos3.length > 1) distribucion = [...combinar(pos1, [premio1]), ...combinar(pos2, [premio2]), ...combinar(pos3, [premio3])];
        else                      distribucion = [
            ...(pos1[0] ? [{ ...pos1[0], montoPremio: premio1, porcentaje: cfg.pctPremio1.toFixed(2) }] : []),
            ...(pos2[0] ? [{ ...pos2[0], montoPremio: premio2, porcentaje: cfg.pctPremio2.toFixed(2) }] : []),
            ...(pos3[0] ? [{ ...pos3[0], montoPremio: premio3, porcentaje: cfg.pctPremio3.toFixed(2) }] : []),
        ];
 
        return res.json({
            ok: true,
            totalRecaudado, totalParticipantes,
            bolsaPremios, cuotaAdmin,
            premio1, premio2, premio3,
            distribucion, ranking,
            config: cfg   // ← enviamos la config al frontend para mostrar en los inputs
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});
 
// ─── ADMIN: GUARDAR CONFIG BOLSA ─────────────────────────────────────────────
router.post('/admin/config-bolsa',  async (req, res) => {
    try {
        const { pctAdmin, pctPremio1, pctPremio2, pctPremio3 } = req.body;
 
        // Validaciones
        const vals = [pctAdmin, pctPremio1, pctPremio2, pctPremio3];
        if (vals.some(v => v === undefined || v === null || isNaN(v)))
            return res.status(400).json({ ok: false, message: 'Todos los porcentajes son requeridos.' });
        if (vals.some(v => v < 0 || v > 100))
            return res.status(400).json({ ok: false, message: 'Los porcentajes deben estar entre 0 y 100.' });
        if (pctAdmin > 50)
            return res.status(400).json({ ok: false, message: '⛔ La cuota admin no puede superar el 50%.' });
 
        const sumaPremios = parseFloat(pctPremio1) + parseFloat(pctPremio2) + parseFloat(pctPremio3);
        if (Math.abs(sumaPremios - 100) > 0.01)
            return res.status(400).json({ ok: false, message: `⛔ Los premios deben sumar 100% (actualmente ${sumaPremios.toFixed(2)}%).` });
 
        const pool = await poolPromise;
        const updates = [
            ['PctAdmin',   pctAdmin],
            ['PctPremio1', pctPremio1],
            ['PctPremio2', pctPremio2],
            ['PctPremio3', pctPremio3],
        ];
 
        for (const [clave, valor] of updates) {
            await pool.request()
                .input('Clave', sql.NVarChar(50),  clave)
                .input('Valor', sql.Decimal(5, 2),  parseFloat(valor))
                .query(`
                    MERGE dbo.ConfigBolsa AS target
                    USING (SELECT @Clave AS Clave) AS source ON target.Clave = source.Clave
                    WHEN MATCHED THEN
                        UPDATE SET Valor=@Valor, FechaActualizacion=GETDATE()
                    WHEN NOT MATCHED THEN
                        INSERT (Clave, Valor) VALUES (@Clave, @Valor);
                `);
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
        const pool = await poolPromise;
 
        const [insResult, cfg] = await Promise.all([
            pool.request().query(`
                SELECT COALESCE(SUM(b.Monto),0) AS TotalRecaudado,
                       COUNT(DISTINCT s.IdUsuario) AS TotalParticipantes
                FROM dbo.Suscripciones s
                INNER JOIN dbo.Bolsa b ON b.IdUsuario=s.IdUsuario
                WHERE s.Activa=1
            `),
            getConfigBolsa(pool)
        ]);
 
        const totalRecaudado     = parseFloat(insResult.recordset[0].TotalRecaudado) || 0;
        const totalParticipantes = parseInt(insResult.recordset[0].TotalParticipantes) || 0;
        const bolsaPremios       = totalRecaudado * ((100 - cfg.pctAdmin) / 100);
        const premio1            = bolsaPremios * (cfg.pctPremio1 / 100);
        const premio2            = bolsaPremios * (cfg.pctPremio2 / 100);
        const premio3            = bolsaPremios * (cfg.pctPremio3 / 100);
 
        // Top 3 actual (sin revelar montos exactos si no hay ganadores)
        const rankingResult = await pool.request().query(`
            SELECT TOP 3 u.Nombre, u.FotoUrl,
                   COALESCE(p.PuntosTotales,0) AS Puntos,
                   DENSE_RANK() OVER (ORDER BY COALESCE(p.PuntosTotales,0) DESC) AS Posicion
            FROM dbo.Usuarios u LEFT JOIN dbo.Puntajes p ON u.IdUsuario=p.IdUsuario
            WHERE u.Activo=1 AND u.IdUsuario <> 1
            ORDER BY Puntos DESC
        `);
 
        return res.json({
            ok: true,
            totalRecaudado,
            totalParticipantes,
            bolsaPremios,
            premio1, premio2, premio3,
            pctPremio1: cfg.pctPremio1,
            pctPremio2: cfg.pctPremio2,
            pctPremio3: cfg.pctPremio3,
            ranking: rankingResult.recordset
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});
// ─── ESTADO QUINIELA ──────────────────────────────────────────────────────────
router.get('/estado-quiniela', async (req, res) => {
    try {
        const pool   = await poolPromise;
        const config = await pool.request().query(`SELECT Clave, Valor FROM dbo.ConfigQuiniela`);
        const estado = {};
        config.recordset.forEach(r => { estado[r.Clave] = r.Valor; });

        let ganadores = [];
        if (estado.GanadoresRevelados === '1') {
            const result = await pool.request().query(`
                SELECT g.Posicion, g.Puntos, g.MontoPremio, g.PorcentajePremio, u.Nombre, u.FotoUrl
                FROM dbo.GanadoresFinales g INNER JOIN dbo.Usuarios u ON g.IdUsuario=u.IdUsuario
                ORDER BY g.Posicion ASC, g.MontoPremio DESC
            `);
            ganadores = result.recordset;
        }
        return res.json({ ok: true, ...estado, ganadores });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: REVELAR GANADORES ─────────────────────────────────────────────────
router.post('/admin/revelar-ganadores', async (req, res) => {
    try {
        const pool   = await poolPromise;
        const config = await pool.request().query(`SELECT Valor FROM dbo.ConfigQuiniela WHERE Clave='GanadoresRevelados'`);
        if (config.recordset[0]?.Valor === '1') return res.status(409).json({ ok: false, message: '⚠️ Ganadores ya revelados.' });

        const bolsaR = await pool.request().query(`SELECT COALESCE(SUM(Monto),0) AS Total FROM dbo.Bolsa`);
        const cfg    = await getConfigBolsa(pool);
        const totalRecaudado = parseFloat(bolsaR.recordset[0].Total) || 0;
        const bolsaPremios   = totalRecaudado * ((100 - cfg.pctAdmin) / 100);
        const premio1 = bolsaPremios * (cfg.pctPremio1 / 100);
        const premio2 = bolsaPremios * (cfg.pctPremio2 / 100);
        const premio3 = bolsaPremios * (cfg.pctPremio3 / 100);

        const rankingResult = await pool.request().query(`
            SELECT u.IdUsuario, u.Nombre, COALESCE(p.PuntosTotales,0) AS Puntos,
                   DENSE_RANK() OVER (ORDER BY COALESCE(p.PuntosTotales,0) DESC) AS Posicion
            FROM dbo.Usuarios u LEFT JOIN dbo.Puntajes p ON u.IdUsuario=p.IdUsuario
            WHERE u.Activo=1 AND u.IdUsuario<>1
        `);

        const ranking=rankingResult.recordset;
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
            await pool.request()
                .input('IdUsuario',        sql.Int,          g.IdUsuario)
                .input('Posicion',         sql.Int,          g.Posicion)
                .input('Puntos',           sql.Int,          g.Puntos)
                .input('PorcentajePremio', sql.Decimal(5,2),  parseFloat(g.porcentaje))
                .input('MontoPremio',      sql.Decimal(10,2), g.montoPremio)
                .query(`INSERT INTO dbo.GanadoresFinales (IdUsuario,Posicion,Puntos,PorcentajePremio,MontoPremio) VALUES (@IdUsuario,@Posicion,@Puntos,@PorcentajePremio,@MontoPremio)`);
        }

        await pool.request().query(`UPDATE dbo.ConfigQuiniela SET Valor='1' WHERE Clave='GanadoresRevelados'`);

        const todos = await pool.request().query(`
            SELECT u.IdUsuario, u.Nombre, u.Correo, COALESCE(p.PuntosTotales,0) AS Puntos,
                   DENSE_RANK() OVER (ORDER BY COALESCE(p.PuntosTotales,0) DESC) AS Posicion
            FROM dbo.Usuarios u LEFT JOIN dbo.Puntajes p ON u.IdUsuario=p.IdUsuario
            WHERE u.Activo=1 AND u.Correo IS NOT NULL AND u.Correo!=''
        `);

        const fmt=n=>`$${Number(n).toLocaleString('es-MX',{minimumFractionDigits:2})} MXN`;
        const medallas={1:'🥇',2:'🥈',3:'🥉'};
        const tablaHTML=distribucion.map(g=>`<tr><td>${medallas[g.Posicion]}</td><td>${g.Nombre}</td><td>${g.Puntos} pts</td><td>${fmt(g.montoPremio)}</td></tr>`).join('');

        for (const u of todos.recordset) {
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
        const pool   = await poolPromise;
        const result = await pool.request().query(`
            SELECT IdPendiente, FixtureId, LocalNombre, VisitanteNombre, GolesLocal, GolesVisitante, FechaPartido, Validado, PartidoId
            FROM dbo.ResultadosPendientes WHERE Validado=0 ORDER BY FechaPartido ASC
        `);
        return res.json({ ok: true, pendientes: result.recordset });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

router.post('/admin/validar-pendiente', async (req, res) => {
    try {
        const { idPendiente, partidoId } = req.body;
        const pool      = await poolPromise;
        const pendiente = await pool.request()
            .input('IdPendiente', sql.Int, idPendiente)
            .query(`SELECT * FROM dbo.ResultadosPendientes WHERE IdPendiente=@IdPendiente`);
        if (pendiente.recordset.length === 0) return res.status(404).json({ ok: false, message: 'No encontrado.' });

        const { GolesLocal, GolesVisitante, LocalNombre, VisitanteNombre } = pendiente.recordset[0];

        await pool.request()
            .input('PartidoId',      sql.Int, partidoId)
            .input('GolesLocal',     sql.Int, GolesLocal)
            .input('GolesVisitante', sql.Int, GolesVisitante)
            .query(`
                IF EXISTS (SELECT 1 FROM dbo.ResultadosReales WHERE PartidoId=@PartidoId)
                    UPDATE dbo.ResultadosReales SET GolesLocal=@GolesLocal, GolesVisitante=@GolesVisitante WHERE PartidoId=@PartidoId
                ELSE
                    INSERT INTO dbo.ResultadosReales (PartidoId,GolesLocal,GolesVisitante) VALUES (@PartidoId,@GolesLocal,@GolesVisitante)
            `);

        await pool.request()
            .input('PartidoId',   sql.Int, partidoId)
            .input('IdPendiente', sql.Int, idPendiente)
            .query(`UPDATE dbo.ResultadosPendientes SET Validado=1, FechaValidacion=GETDATE(), PartidoId=@PartidoId WHERE IdPendiente=@IdPendiente`);

        const pros = await pool.request()
            .input('PartidoId', sql.Int, partidoId)
            .query(`
                SELECT p.IdUsuario, p.GolesLocal AS ProLocal, p.GolesVisitante AS ProVisitante, u.Nombre, u.Correo
                FROM dbo.Pronosticos p INNER JOIN dbo.Usuarios u ON p.IdUsuario=u.IdUsuario
                WHERE p.PartidoId=@PartidoId AND u.Correo IS NOT NULL
            `);
        for (const pro of pros.recordset) {
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
        const pool = await poolPromise;
        await pool.request().input('IdPendiente', sql.Int, req.body.idPendiente).query(`DELETE FROM dbo.ResultadosPendientes WHERE IdPendiente=@IdPendiente`);
        return res.json({ ok: true, message: 'Descartado.' });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: EXPORTAR PRONÓSTICOS ─────────────────────────────────────────────
router.get('/admin/exportar-pronosticos', async (req, res) => {
    try {
        const pool   = await poolPromise;
        const result = await pool.request().query(`
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
            FROM dbo.Pronosticos p
            INNER JOIN dbo.Usuarios u ON p.IdUsuario=u.IdUsuario
            LEFT JOIN dbo.ResultadosReales r ON p.PartidoId=r.PartidoId
            LEFT JOIN dbo.PartidosDesbloqueados pd ON pd.IdUsuario=p.IdUsuario AND pd.PartidoId=p.PartidoId
            LEFT JOIN dbo.Puntajes pt ON pt.IdUsuario=u.IdUsuario
            WHERE u.Activo=1
            ORDER BY u.Nombre ASC, p.PartidoId ASC
        `);
        return res.json({ ok: true, pronosticos: result.recordset });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al exportar.' });
    }
});

// ─── ADMIN: LOGS ─────────────────────────────────────────────────────────────
router.get('/admin/logs', async (req, res) => {
    try {
        const pool   = await poolPromise;
        const result = await pool.request().query(`
            SELECT TOP 100 l.IdLog, l.IdUsuario, u.Nombre AS NombreUsuario,
                   l.Accion, l.PartidoId, l.Detalle, l.Fecha, l.Exito, l.ErrorMessage
            FROM dbo.LogsActividad l
            LEFT JOIN dbo.Usuarios u ON l.IdUsuario=u.IdUsuario
            ORDER BY l.Fecha DESC
        `);
        return res.json({ ok: true, logs: result.recordset });
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
        const pool      = await poolPromise;

        const result = await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .query(`
                SELECT p.PartidoId, p.GolesLocal AS ProLocal, p.GolesVisitante AS ProVisitante,
                       r.GolesLocal AS RealLocal, r.GolesVisitante AS RealVisitante
                FROM dbo.Pronosticos p
                INNER JOIN dbo.ResultadosReales r ON p.PartidoId=r.PartidoId
                WHERE p.IdUsuario=@IdUsuario
            `);

        const puntosPorGrupo = {};
        result.recordset.forEach(row => {
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

router.get('/pronosticos-partido/:partidoId', validarTokenUsuario, async (req, res) => {
    try {
        const partidoId = parseInt(req.params.partidoId);
        const pool      = await poolPromise;

        const revelado  = await pool.request()
            .input('PartidoId', sql.Int, partidoId)
            .query(`SELECT Revelado FROM dbo.PartidosRevelados WHERE PartidoId = @PartidoId`);

        const estaRevelado = revelado.recordset[0]?.Revelado === true;

        const tokenAdmin    = req.headers['x-admin-token'] || req.query.adminToken;
        const secret        = process.env.ADMIN_SECRET || 'default-admin-secret-2026-torreslab';
        const expectedAdmin = crypto.createHmac('sha256', secret).update('1').digest('hex');
        const esAdmin       = tokenAdmin === expectedAdmin;

        if (!estaRevelado && !esAdmin) {
            return res.json({ ok: true, revelado: false, pronosticos: [] });
        }

        const result = await pool.request()
            .input('PartidoId', sql.Int, partidoId)
            .query(`
                SELECT
                    u.Nombre,
                    p.GolesLocal,
                    p.GolesVisitante,
                    p.FechaRegistro,
                    p.HashIntegridad,
                    CASE WHEN p.ModificadoPor IS NOT NULL THEN 1 ELSE 0 END AS Sospechoso,
                    p.ModificadoPor
                FROM dbo.Pronosticos p
                INNER JOIN dbo.Usuarios u ON u.IdUsuario = p.IdUsuario
                WHERE p.PartidoId = @PartidoId
                ORDER BY u.Nombre ASC
            `);

        return res.json({ ok: true, revelado: true, pronosticos: result.recordset });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al obtener pronósticos.' });
    }
});

// ─── ADMIN: REVELAR PRONÓSTICOS DE UN PARTIDO ─────────────────────────────────
router.post('/admin/revelar-partido',validarTokenAdmin, async (req, res) => {
    try {
        const { partidoId } = req.body;
        if (!partidoId) return res.status(400).json({ ok: false, message: 'Falta partidoId.' });
        const pool = await poolPromise;

        await pool.request()
            .input('PartidoId', sql.Int,          partidoId)
            .input('Fecha',     sql.DateTime,     new Date())
            .input('Admin',     sql.NVarChar(100), 'admin')
            .query(`
                MERGE dbo.PartidosRevelados AS target
                USING (SELECT @PartidoId AS PartidoId) AS source ON target.PartidoId = source.PartidoId
                WHEN MATCHED THEN
                    UPDATE SET Revelado=1, FechaRevelado=@Fecha, ReveladoPor=@Admin
                WHEN NOT MATCHED THEN
                    INSERT (PartidoId, Revelado, FechaRevelado, ReveladoPor)
                    VALUES (@PartidoId, 1, @Fecha, @Admin);
            `);

        await registrarLogActividad({ accion:'revelar_partido', partidoId, detalle:`Partido ${partidoId} revelado`, exito:true });
        return res.json({ ok: true, message: `✅ Pronósticos del partido ${partidoId} revelados.` });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al revelar.' });
    }
});

module.exports = router;