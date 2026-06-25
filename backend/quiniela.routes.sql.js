const express    = require('express');
const router     = express.Router();
const { z }      = require('zod');
const nodemailer = require('nodemailer');
const { sql, poolPromise } = require('./db.sql');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');

let partidos = [];
try {
    // Migración automática
    (async () => {
        try {
            const pool = await poolPromise;
            await pool.request().query(`
                IF NOT EXISTS (
                    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_NAME='Usuarios' AND COLUMN_NAME='UltimaConexion'
                )
                ALTER TABLE dbo.Usuarios ADD UltimaConexion DATETIME NULL
            `);
        } catch (err) {
            console.error('⚠️ Error migración UltimaConexion:', err.message);
        }
    })();

    const dataPath = path.join(__dirname, 'data', 'partidos.json');
    partidos = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
} catch (err) {
    console.error('Error al cargar partidos.json:', err);
}

// ─── LOG ACTIVIDAD ────────────────────────────────────────────────────────────
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
            .query(`INSERT INTO dbo.LogsActividad (IdUsuario,Accion,PartidoId,Detalle,Exito,ErrorMessage)
                    VALUES (@IdUsuario,@Accion,@PartidoId,@Detalle,@Exito,@ErrorMessage)`);
    } catch (err) {
        console.error('❌ Error al registrar log:', err);
    }
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

async function enviarCorreoResultado({ correo, nombre, local, visitante, golesLocal, golesVisitante, proLocal, proVisitante, puntos, estado, asunto, htmlPersonalizado, idUsuario, partidoId }) {
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
    try {
        await transporter.sendMail({
            from:    process.env.EMAIL_FROM,
            to:      correo,
            subject: asunto || `${emoji} Resultado: ${local} ${golesLocal}-${golesVisitante} ${visitante} | Quiniela 2026`,
            html
        });
        await registrarLogActividad({ idUsuario: idUsuario || null, accion:'enviar_correo_resultado', partidoId: partidoId || null, detalle:`Correo enviado a ${correo} (${estado})`, exito:true });
    } catch (err) {
        console.error(`❌ Error enviando correo a ${correo}:`, err);
        await registrarLogActividad({ idUsuario: idUsuario || null, accion:'enviar_correo_resultado', partidoId: partidoId || null, detalle:`Fallo correo a ${correo}: ${err.message}`, exito:false, errorMessage:err.message });
    }
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

            const horaLimpia   = partido.hora.replace(' hrs', '');
            const fechaPartido = new Date(`${partido.fecha} ${horaLimpia}:00 GMT-0600`);
            if (fechaPartido.getTime() - Date.now() <= 0) {
                const errMsg = 'El partido ya comenzó.';
                errores.push(`Partido #${pro.partidoId} (${partido.local} vs ${partido.visitante}) ${errMsg}`);
                await registrarLogActividad({ idUsuario, accion:'guardar_quiniela', partidoId:pro.partidoId, detalle:`Pronóstico: ${pro.golesLocal}-${pro.golesVisitante}`, exito:false, errorMessage:errMsg });
                continue;
            }

            // Verificar si el marcador cambió
            const existing = await pool.request()
                .input('IdUsuario', sql.Int, idUsuario)
                .input('PartidoId', sql.Int, pro.partidoId)
                .query(`SELECT GolesLocal, GolesVisitante FROM dbo.Pronosticos WHERE IdUsuario=@IdUsuario AND PartidoId=@PartidoId`);

            let scoreChanged = true;
            if (existing.recordset.length > 0) {
                const old = existing.recordset[0];
                if (old.GolesLocal === pro.golesLocal && old.GolesVisitante === pro.golesVisitante) scoreChanged = false;
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

            if (scoreChanged && modUsadas >= 3) {
                const errMsg = 'Agotaste tus 3 modificaciones.';
                errores.push(`Partido #${pro.partidoId}: ${errMsg}`);
                await registrarLogActividad({ idUsuario, accion:'guardar_quiniela', partidoId:pro.partidoId, detalle:`Pronóstico: ${pro.golesLocal}-${pro.golesVisitante}`, exito:false, errorMessage:errMsg });
                continue;
            }

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

            if (scoreChanged) {
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
            }

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

// ─── HEARTBEAT ────────────────────────────────────────────────────────────────
router.post('/heartbeat', async (req, res) => {
    try {
        const { idUsuario } = req.body;
        const pool = await poolPromise;

        if (idUsuario) {
            await pool.request()
                .input('IdUsuario', sql.Int, parseInt(idUsuario))
                .query(`UPDATE dbo.Usuarios SET UltimaConexion=GETDATE() WHERE IdUsuario=@IdUsuario`);
        }

        const activeUsers = await pool.request().query(`
            SELECT IdUsuario AS "idUsuario", Nombre AS "nombre", FotoUrl AS "fotoUrl"
            FROM dbo.Usuarios
            WHERE UltimaConexion >= DATEADD(MINUTE,-2,GETDATE()) AND Activo=1
            ORDER BY Nombre ASC
        `);

        return res.json({ ok: true, activeUsers: activeUsers.recordset });
    } catch (error) {
        console.error('Error heartbeat:', error);
        return res.status(500).json({ ok: false, message: 'Error.' });
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
            enviarCorreoResultado({ correo:pro.Correo, nombre:pro.Nombre, local:local||'Local', visitante:visitante||'Visitante', golesLocal, golesVisitante, proLocal:pro.ProLocal, proVisitante:pro.ProVisitante, puntos, estado, idUsuario:pro.IdUsuario, partidoId }).catch(console.error);
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
        const result = await pool.request()
            .query(`SELECT PartidoId, GolesLocal, GolesVisitante FROM dbo.ResultadosReales`);
        return res.json({ ok: true, resultados: result.recordset });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── HELPER: TABLA GENERAL ────────────────────────────────────────────────────
async function obtenerTablaGeneralRankings() {
    const pool   = await poolPromise;
    const result = await pool.request().query(`
        SELECT u.IdUsuario, u.Nombre, u.FotoUrl, u.Correo,
               COALESCE(p.PuntosTotales,0) AS Puntos,
               COALESCE(p.PosicionAnterior,1) AS PosicionAnterior,
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

    const rows = result.recordset;
    let rank = 1;
    for (let i = 0; i < rows.length; i++) {
        if (i > 0) {
            const prev = rows[i-1], curr = rows[i];
            if (curr.Puntos !== prev.Puntos || curr.Aciertos !== prev.Aciertos) rank = i+1;
        }
        rows[i].PosicionReal      = rank;
        rows[i].Posicion          = rank;
        rows[i].posicion          = rank;
        rows[i].id_usuario        = rows[i].IdUsuario;
        rows[i].nombre            = rows[i].Nombre;
        rows[i].correo            = rows[i].Correo;
        rows[i].puntos            = rows[i].Puntos;
    }
    return rows;
}

async function guardarPosicionesActualesComoAnteriores() {
    try {
        const ranking = await obtenerTablaGeneralRankings();
        const pool    = await poolPromise;
        for (const u of ranking) {
            await pool.request()
                .input('IdUsuario',        sql.Int, u.IdUsuario)
                .input('PosicionAnterior', sql.Int, u.PosicionReal)
                .query(`
                    IF EXISTS (SELECT 1 FROM dbo.Puntajes WHERE IdUsuario=@IdUsuario)
                        UPDATE dbo.Puntajes SET PosicionAnterior=@PosicionAnterior WHERE IdUsuario=@IdUsuario
                    ELSE
                        INSERT INTO dbo.Puntajes (IdUsuario,PuntosTotales,PosicionAnterior) VALUES (@IdUsuario,0,@PosicionAnterior)
                `);
        }
        console.log('✅ Posiciones guardadas como anteriores.');
    } catch (error) {
        console.error('❌ Error al guardar posiciones anteriores:', error);
    }
}

// ─── CALCULAR PUNTOS ──────────────────────────────────────────────────────────
router.post('/calcular-puntos', validarTokenAdmin, async (req, res) => {
    try {
        await guardarPosicionesActualesComoAnteriores();
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
        const ranking = await obtenerTablaGeneralRankings();
        return res.json({ ok: true, ranking });
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

        const ranking = await obtenerTablaGeneralRankings();
        const miPos   = ranking.find(u => u.IdUsuario === idUsuario);

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
        const DEADLINE = new Date('2026-06-11T11:00:00 GMT-0600').getTime();
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
        const result = await pool.request()
            .query(`SELECT IdPaquete, Nombre, Precio, Goles, MaxPartidos FROM dbo.Paquetes WHERE Nombre='Premium'`);
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

// ─── HELPER CONFIG BOLSA ─────────────────────────────────────────────────────
async function getConfigBolsa(pool) {
    const result = await pool.request().query(`SELECT Clave, Valor FROM dbo.ConfigBolsa`);
    const cfg = {};
    result.recordset.forEach(r => { cfg[r.Clave] = parseFloat(r.Valor); });
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
        const pool = await poolPromise;
        const [insResult, cfg] = await Promise.all([
            pool.request().query(`
                SELECT COALESCE(SUM(b.Monto),0) AS TotalRecaudado, COUNT(DISTINCT s.IdUsuario) AS TotalParticipantes
                FROM dbo.Suscripciones s INNER JOIN dbo.Bolsa b ON b.IdUsuario=s.IdUsuario WHERE s.Activa=1
            `),
            getConfigBolsa(pool)
        ]);

        const totalRecaudado     = parseFloat(insResult.recordset[0].TotalRecaudado) || 0;
        const totalParticipantes = parseInt(insResult.recordset[0].TotalParticipantes) || 0;
        const cuotaAdmin         = totalRecaudado * (cfg.pctAdmin / 100);
        const bolsaPremios       = totalRecaudado - cuotaAdmin;
        const premio1 = bolsaPremios * (cfg.pctPremio1 / 100);
        const premio2 = bolsaPremios * (cfg.pctPremio2 / 100);
        const premio3 = bolsaPremios * (cfg.pctPremio3 / 100);

        const ranking = await obtenerTablaGeneralRankings();
        const groups  = {};
        ranking.forEach(u => { if (!groups[u.Posicion]) groups[u.Posicion]=[]; groups[u.Posicion].push(u); });

        const sortedRanks = Object.keys(groups).map(Number).sort((a,b)=>a-b);
        const prizes = [premio1, premio2, premio3];
        let distribucion = [], prizeIdx = 0;
        for (const rk of sortedRanks) {
            if (prizeIdx >= prizes.length) break;
            const gUsers = groups[rk], L = gUsers.length;
            const gPrizes = prizes.slice(prizeIdx, prizeIdx+L); prizeIdx+=L;
            if (!gPrizes.length) break;
            const sumP = gPrizes.reduce((a,b)=>a+b,0);
            gUsers.forEach(u => distribucion.push({ ...u, montoPremio: sumP/L, porcentaje: ((sumP/bolsaPremios)*100/L).toFixed(2) }));
        }

        return res.json({ ok:true, totalRecaudado, totalParticipantes, bolsaPremios, cuotaAdmin, premio1, premio2, premio3, distribucion, ranking, config: cfg });
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
        if (pctAdmin > 50) return res.status(400).json({ ok: false, message: '⛔ Cuota admin máx 50%.' });
        const suma = parseFloat(pctPremio1)+parseFloat(pctPremio2)+parseFloat(pctPremio3);
        if (Math.abs(suma - 100) > 0.01)
            return res.status(400).json({ ok: false, message: `⛔ Los premios deben sumar 100% (actualmente ${suma.toFixed(2)}%).` });

        const pool = await poolPromise;
        const updates = [['PctAdmin',pctAdmin],['PctPremio1',pctPremio1],['PctPremio2',pctPremio2],['PctPremio3',pctPremio3]];
        for (const [clave, valor] of updates) {
            await pool.request()
                .input('Clave', sql.NVarChar(50),  clave)
                .input('Valor', sql.Decimal(5, 2),  parseFloat(valor))
                .query(`
                    MERGE dbo.ConfigBolsa AS target
                    USING (SELECT @Clave AS Clave) AS source ON target.Clave = source.Clave
                    WHEN MATCHED THEN UPDATE SET Valor=@Valor, FechaActualizacion=GETDATE()
                    WHEN NOT MATCHED THEN INSERT (Clave,Valor) VALUES (@Clave,@Valor);
                `);
        }
        return res.json({ ok: true, message: '✅ Porcentajes actualizados.' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al guardar config.' });
    }
});

// ─── PÚBLICO: BOLSA PARA USUARIOS ────────────────────────────────────────────
router.get('/bolsa-premios', async (req, res) => {
    try {
        const pool = await poolPromise;
        const [insResult, cfg] = await Promise.all([
            pool.request().query(`
                SELECT COALESCE(SUM(b.Monto),0) AS TotalRecaudado, COUNT(DISTINCT s.IdUsuario) AS TotalParticipantes
                FROM dbo.Suscripciones s INNER JOIN dbo.Bolsa b ON b.IdUsuario=s.IdUsuario WHERE s.Activa=1
            `),
            getConfigBolsa(pool)
        ]);

        const totalRecaudado     = parseFloat(insResult.recordset[0].TotalRecaudado) || 0;
        const totalParticipantes = parseInt(insResult.recordset[0].TotalParticipantes) || 0;
        const bolsaPremios       = totalRecaudado * ((100 - cfg.pctAdmin) / 100);
        const premio1 = bolsaPremios * (cfg.pctPremio1 / 100);
        const premio2 = bolsaPremios * (cfg.pctPremio2 / 100);
        const premio3 = bolsaPremios * (cfg.pctPremio3 / 100);

        const rankingResult = await pool.request().query(`
            SELECT TOP 3 u.Nombre, u.FotoUrl,
                   COALESCE(p.PuntosTotales,0) AS Puntos,
                   DENSE_RANK() OVER (ORDER BY COALESCE(p.PuntosTotales,0) DESC) AS Posicion
            FROM dbo.Usuarios u LEFT JOIN dbo.Puntajes p ON u.IdUsuario=p.IdUsuario
            WHERE u.Activo=1 AND u.IdUsuario <> 1
            ORDER BY Puntos DESC
        `);

        return res.json({ ok:true, totalRecaudado, totalParticipantes, bolsaPremios, premio1, premio2, premio3,
            pctPremio1:cfg.pctPremio1, pctPremio2:cfg.pctPremio2, pctPremio3:cfg.pctPremio3,
            ranking: rankingResult.recordset });
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

        const cfg  = await getConfigBolsa(pool);
        const bolsaR = await pool.request().query(`SELECT COALESCE(SUM(Monto),0) AS Total FROM dbo.Bolsa`);
        const totalRecaudado = parseFloat(bolsaR.recordset[0].Total) || 0;
        const cuotaAdmin     = totalRecaudado * (cfg.pctAdmin / 100);
        const bolsaPremios   = totalRecaudado - cuotaAdmin;
        const premio1 = bolsaPremios*(cfg.pctPremio1/100), premio2 = bolsaPremios*(cfg.pctPremio2/100), premio3 = bolsaPremios*(cfg.pctPremio3/100);

        const ranking = await obtenerTablaGeneralRankings();
        const groups  = {};
        ranking.forEach(u => { if (!groups[u.Posicion]) groups[u.Posicion]=[]; groups[u.Posicion].push(u); });

        const sortedRanks = Object.keys(groups).map(Number).sort((a,b)=>a-b);
        const prizes = [premio1, premio2, premio3];
        let distribucion = [], prizeIdx = 0;
        for (const rk of sortedRanks) {
            if (prizeIdx >= prizes.length) break;
            const gUsers = groups[rk], L = gUsers.length;
            const gPrizes = prizes.slice(prizeIdx, prizeIdx+L); prizeIdx+=L;
            if (!gPrizes.length) break;
            const sumP = gPrizes.reduce((a,b)=>a+b,0);
            gUsers.forEach(u => distribucion.push({ ...u, montoPremio: sumP/L, porcentaje: ((sumP/bolsaPremios)*100/L).toFixed(2) }));
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

        const todos = ranking.filter(u => u.Correo && u.Correo !== '');
        const fmt=n=>`$${Number(n).toLocaleString('es-MX',{minimumFractionDigits:2})} MXN`;
        const medallas={1:'🥇',2:'🥈',3:'🥉'};
        const tablaHTML=distribucion.map(g=>`<tr><td>${medallas[g.Posicion]}</td><td>${g.Nombre}</td><td>${g.Puntos} pts</td><td>${fmt(g.montoPremio)}</td></tr>`).join('');

        for (const u of todos) {
            const gi = distribucion.find(g => g.IdUsuario === u.IdUsuario);
            const html=`<div style="font-family:sans-serif;max-width:600px;background:#05101a;color:white;border-radius:16px;overflow:hidden;"><div style="background:linear-gradient(135deg,#f1c40f,#d4ac0d);padding:2rem;text-align:center;"><h1 style="color:#000;">🏆 ¡El Mundial ha terminado!</h1></div>${gi?`<div style="padding:1.5rem;text-align:center;"><p style="font-size:3rem;">${medallas[gi.Posicion]}</p><h2 style="color:#2ecc71;">¡Felicidades ${u.Nombre}!</h2><p>Premio: <strong style="color:#f1c40f;">${fmt(gi.montoPremio)}</strong></p></div>`:`<div style="padding:1.5rem;text-align:center;"><p>Hola ${u.Nombre}, terminaste en ${u.posicion}° con ${u.Puntos} pts.</p></div>`}<div style="padding:1rem;"><table style="width:100%;"><thead><tr><th>Pos</th><th>Nombre</th><th>Puntos</th><th>Premio</th></tr></thead><tbody>${tablaHTML}</tbody></table></div><div style="padding:1rem;text-align:center;"><small>Quiniela Mundial 2026 — torreslab</small></div></div>`;
            enviarCorreoResultado({ correo:u.Correo, nombre:u.Nombre, asunto:'🏆 Resultados Quiniela Mundial 2026', htmlPersonalizado:html, idUsuario:u.IdUsuario }).catch(console.error);
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

        await registrarLogActividad({ idUsuario:1, accion:'marcador_final_registrado', partidoId, detalle:`${LocalNombre} ${GolesLocal} - ${GolesVisitante} ${VisitanteNombre}`, exito:true });

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
            enviarCorreoResultado({ correo:pro.Correo, nombre:pro.Nombre, local:LocalNombre, visitante:VisitanteNombre, golesLocal:GolesLocal, golesVisitante:GolesVisitante, proLocal:pro.ProLocal, proVisitante:pro.ProVisitante, puntos, estado, idUsuario:pro.IdUsuario, partidoId }).catch(console.error);
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
        await pool.request().input('IdPendiente', sql.Int, req.body.idPendiente)
            .query(`DELETE FROM dbo.ResultadosPendientes WHERE IdPendiente=@IdPendiente`);
        return res.json({ ok: true, message: 'Descartado.' });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: EXPORTAR PRONÓSTICOS (con filtros) ───────────────────────────────
router.get('/admin/exportar-pronosticos', async (req, res) => {
    try {
        const pool = await poolPromise;
        const { partidoIds, includeCampeon } = req.query;

        const filtrarPartidos = partidoIds && partidoIds !== 'all';
        const ids = filtrarPartidos ? partidoIds.split(',').map(Number).filter(n => !isNaN(n)) : [];

        let wherePartido = 'WHERE u.Activo=1';
        if (filtrarPartidos && ids.length > 0) wherePartido += ` AND p.PartidoId IN (${ids.join(',')})`;

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
            ${wherePartido}
            ORDER BY u.Nombre ASC, p.PartidoId ASC
        `);

        let pronosticos = result.recordset;

        if (includeCampeon === 'true') {
            const campeonResult = await pool.request().query(`
                SELECT u.Nombre, pc.SeleccionCampeon AS [Campeón Pronóstico],
                       pc.GolesLocal AS [Goles Campeón], pc.GolesVisitante AS [Goles Rival],
                       rc.SeleccionCampeon AS [Campeón Real],
                       rc.GolesLocal AS [Goles Real Campeón], rc.GolesVisitante AS [Goles Real Rival],
                       CASE
                           WHEN rc.SeleccionCampeon IS NULL THEN 'Pendiente'
                           WHEN pc.SeleccionCampeon=rc.SeleccionCampeon AND pc.GolesLocal=rc.GolesLocal AND pc.GolesVisitante=rc.GolesVisitante THEN '25 — Exacto'
                           WHEN pc.SeleccionCampeon=rc.SeleccionCampeon THEN '15 — Campeón correcto'
                           ELSE '0 — Falló'
                       END AS [Puntos Campeón]
                FROM dbo.PronosticosCampeon pc
                INNER JOIN dbo.Usuarios u ON pc.IdUsuario=u.IdUsuario
                LEFT JOIN (SELECT TOP 1 * FROM dbo.ResultadoCampeon ORDER BY IdResultado DESC) rc ON 1=1
                WHERE u.Activo=1
                ORDER BY u.Nombre ASC
            `);
            const campeonMap = {};
            campeonResult.recordset.forEach(c => { campeonMap[c.Nombre] = c; });
            pronosticos = pronosticos.map((row, i) => {
                const camp = campeonMap[row.Usuario];
                if (!camp) return row;
                const esPrimero = pronosticos.findIndex(r => r.Usuario === row.Usuario) === i;
                if (!esPrimero) return row;
                return { ...row, 'Campeón Pronóstico':camp['Campeón Pronóstico']||'-', 'Goles Campeón':camp['Goles Campeón']??'-', 'Goles Rival':camp['Goles Rival']??'-', 'Campeón Real':camp['Campeón Real']||'Pendiente', 'Puntos Campeón':camp['Puntos Campeón']||'Pendiente' };
            });
        }

        return res.json({ ok: true, pronosticos });
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

// ─── ADMIN: SINCRONIZAR ──────────────────────────────────────────────────────
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

// ─── STANDINGS (Football-Data.org) ───────────────────────────────────────────
router.get('/standings', async (req, res) => {
    try {
        const API_KEY = process.env.FOOTBALL_DATA_API_KEY || process.env.APISPORTS_KEY;
        if (!API_KEY) return res.status(500).json({ ok: false, message: 'API Key no configurada.' });

        const response = await fetch(
            `https://api.football-data.org/v4/competitions/WC/standings`,
            { headers: { 'X-Auth-Token': API_KEY } }
        );
        const data = await response.json();
        if (data.errors || data.message || !data.standings) return res.json({ ok: true, grupos: {} });

        const grupos = {};
        data.standings.forEach(standing => {
            const letra = standing.group.replace('GROUP_','').replace('Group ','').trim();
            if (!grupos[letra]) grupos[letra] = [];
            standing.table.forEach(equipo => {
                grupos[letra].push({
                    posicion: equipo.position, nombre: equipo.team.name, logo: equipo.team.crest,
                    jugados: equipo.playedGames, ganados: equipo.won, empates: equipo.draw,
                    perdidos: equipo.lost, golesFavor: equipo.goalsFor,
                    golesContra: equipo.goalsAgainst, diferencia: equipo.goalDifference, puntos: equipo.points
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
                FROM dbo.Pronosticos p INNER JOIN dbo.ResultadosReales r ON p.PartidoId=r.PartidoId
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

// ─── PRONÓSTICOS PÚBLICOS POR PARTIDO ────────────────────────────────────────
router.get('/pronosticos-partido/:partidoId', validarTokenUsuario, async (req, res) => {
    try {
        const partidoId = parseInt(req.params.partidoId);
        const pool      = await poolPromise;

        const revelado = await pool.request()
            .input('PartidoId', sql.Int, partidoId)
            .query(`SELECT Revelado FROM dbo.PartidosRevelados WHERE PartidoId=@PartidoId`);

        const estaRevelado = revelado.recordset[0]?.Revelado === true;
        const tokenAdmin   = req.headers['x-admin-token'] || req.query.adminToken;
        const secret       = process.env.ADMIN_SECRET || 'default-admin-secret-2026-torreslab';
        const esAdmin      = tokenAdmin === crypto.createHmac('sha256', secret).update('1').digest('hex');

        if (!estaRevelado && !esAdmin) return res.json({ ok: true, revelado: false, pronosticos: [] });

        const result = await pool.request()
            .input('PartidoId', sql.Int, partidoId)
            .query(`
                SELECT u.Nombre, p.GolesLocal, p.GolesVisitante, p.FechaRegistro, p.HashIntegridad,
                       CASE WHEN p.ModificadoPor IS NOT NULL THEN 1 ELSE 0 END AS Sospechoso,
                       p.ModificadoPor
                FROM dbo.Pronosticos p INNER JOIN dbo.Usuarios u ON u.IdUsuario=p.IdUsuario
                WHERE p.PartidoId=@PartidoId ORDER BY u.Nombre ASC
            `);

        return res.json({ ok: true, revelado: true, pronosticos: result.recordset });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error.' });
    }
});

// ─── ADMIN: REVELAR PARTIDO ───────────────────────────────────────────────────
router.post('/admin/revelar-partido', validarTokenAdmin, async (req, res) => {
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
                USING (SELECT @PartidoId AS PartidoId) AS source ON target.PartidoId=source.PartidoId
                WHEN MATCHED THEN UPDATE SET Revelado=1, FechaRevelado=@Fecha, ReveladoPor=@Admin
                WHEN NOT MATCHED THEN INSERT (PartidoId,Revelado,FechaRevelado,ReveladoPor) VALUES (@PartidoId,1,@Fecha,@Admin);
            `);

        await registrarLogActividad({ accion:'revelar_partido', partidoId, detalle:`Partido ${partidoId} revelado`, exito:true });
        return res.json({ ok: true, message: `✅ Pronósticos del partido ${partidoId} revelados.` });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al revelar.' });
    }
});

// ─── STANDINGS CALCULADOS DESDE ResultadosReales ─────────────────────────────
router.get('/standings-reales', async (req, res) => {
    try {
        const pool   = await poolPromise;
        const result = await pool.request()
            .query(`SELECT PartidoId, GolesLocal, GolesVisitante FROM dbo.ResultadosReales`);
        const resultados = result.recordset;

        const grupos = {};
        partidos.forEach(p => {
            if (!p.grupo) return;
            if (!grupos[p.grupo]) grupos[p.grupo] = {};
            [{ nombre:p.local, cod:p.codLocal }, { nombre:p.visitante, cod:p.codVisitante }]
                .forEach(({ nombre, cod }) => {
                    if (!grupos[p.grupo][nombre])
                        grupos[p.grupo][nombre] = { nombre, cod, j:0, g:0, e:0, l:0, gf:0, gc:0, pts:0 };
                });
        });

        partidos.forEach(p => {
            if (!p.grupo) return;
            const res = resultados.find(r => r.PartidoId === p.id);
            if (!res) return;
            const eqL = grupos[p.grupo][p.local], eqV = grupos[p.grupo][p.visitante];
            if (!eqL || !eqV) return;
            const gl = res.GolesLocal, gv = res.GolesVisitante;
            eqL.j++; eqV.j++; eqL.gf+=gl; eqL.gc+=gv; eqV.gf+=gv; eqV.gc+=gl;
            if      (gl>gv) { eqL.g++; eqL.pts+=3; eqV.l++; }
            else if (gl<gv) { eqV.g++; eqV.pts+=3; eqL.l++; }
            else             { eqL.e++; eqL.pts++; eqV.e++; eqV.pts++; }
        });

        const tablas = {};
        Object.keys(grupos).sort().forEach(g => {
            tablas[g] = Object.values(grupos[g]).sort((a,b) => {
                if (b.pts!==a.pts) return b.pts-a.pts;
                const dA=a.gf-a.gc, dB=b.gf-b.gc;
                if (dB!==dA) return dB-dA;
                if (b.gf!==a.gf) return b.gf-a.gf;
                return a.nombre.localeCompare(b.nombre);
            });
        });

        return res.json({ ok: true, tablas });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al calcular standings.' });
    }
});

// ─── DEBUG: LOGS DE CORREO ───────────────────────────────────────────────────
router.get('/debug-email-logs', async (req, res) => {
    try {
        const pool   = await poolPromise;
        const result = await pool.request().query(`
            SELECT TOP 50 l.IdLog, u.Nombre, u.Correo,
                   l.Accion, l.Detalle, l.Fecha, l.Exito, l.ErrorMessage
            FROM dbo.LogsActividad l
            LEFT JOIN dbo.Usuarios u ON l.IdUsuario=u.IdUsuario
            WHERE l.Accion='enviar_correo_resultado'
            ORDER BY l.Fecha DESC
        `);
        return res.json({ ok: true, logs: result.recordset });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;