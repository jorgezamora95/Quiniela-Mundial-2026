const express    = require('express');
const router     = express.Router();
const { z }      = require('zod');
const nodemailer = require('nodemailer');
const { sql, poolPromise } = require('./db');

// ─── CONFIGURACIÓN DE NODEMAILER (Outlook) ───────────────────────────────────
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ─── FUNCIÓN: Enviar correo de resultado a un usuario ────────────────────────
async function enviarCorreoResultado({ correo, nombre, local, visitante, golesLocal, golesVisitante, proLocal, proVisitante, puntos, estado, asunto, htmlPersonalizado }) {
    const emojis = { 'Exacto': '🎯', 'Acierto': '✅', 'Falló': '❌', 'Pendiente': '⏳' };
    const emoji  = emojis[estado] || '⚽';

    const html = `
    <div style="font-family:sans-serif; max-width:500px; margin:0 auto; background:#05101a; color:white; border-radius:16px; overflow:hidden;">
        <div style="background:linear-gradient(135deg,#16883f,#0b5229); padding:1.5rem; text-align:center;">
            <h1 style="margin:0; font-size:1.8rem;">⚽ Quiniela Mundial 2026</h1>
            <p style="margin:.5rem 0 0; color:rgba(255,255,255,.8);">Resultado oficial registrado</p>
        </div>
        <div style="padding:1.5rem;">
            <p style="color:#b8c2d6;">Hola <strong style="color:white;">${nombre}</strong>,</p>
            <p style="color:#b8c2d6;">Se registró el resultado oficial del partido:</p>

            <div style="background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1); border-radius:12px; padding:1.2rem; text-align:center; margin:1rem 0;">
                <p style="margin:0 0 .5rem; color:#b8c2d6; font-size:.85rem;">RESULTADO OFICIAL</p>
                <h2 style="margin:0; font-size:1.6rem; color:white;">${local} <span style="color:#2ecc71;">${golesLocal} - ${golesVisitante}</span> ${visitante}</h2>
            </div>

            <div style="background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:1.2rem; text-align:center; margin:1rem 0;">
                <p style="margin:0 0 .5rem; color:#b8c2d6; font-size:.85rem;">TU PRONÓSTICO</p>
                <h3 style="margin:0; color:white;">${local} ${proLocal} - ${proVisitante} ${visitante}</h3>
            </div>

            <div style="text-align:center; margin:1.5rem 0;">
                <span style="font-size:3rem;">${emoji}</span>
                <p style="margin:.5rem 0 0; font-size:1.1rem; color:${puntos > 0 ? '#2ecc71' : '#e74c3c'};">
                    ${estado} — <strong>${puntos} punto${puntos !== 1 ? 's' : ''}</strong>
                </p>
            </div>

            <p style="color:#b8c2d6; font-size:.85rem; text-align:center;">
                Entra a la quiniela para ver tu posición actualizada.
            </p>
        </div>
        <div style="background:rgba(0,0,0,.3); padding:1rem; text-align:center;">
            <p style="margin:0; color:#b8c2d6; font-size:.8rem;">Quiniela Mundial 2026 — No respondas este correo</p>
        </div>
    </div>
    `;

    await transporter.sendMail({
        from:    process.env.EMAIL_FROM,
        to:      correo,
        subject: `${emoji} Resultado: ${local} ${golesLocal}-${golesVisitante} ${visitante} | Quiniela 2026`,
        html
    });
}

// ─── SCHEMAS ────────────────────────────────────────────────────────────────

const quinielaSchema = z.object({
    idUsuario:    z.number().int().positive(),
    pronosticos:  z.array(z.object({
        partidoId:      z.number().int().min(1).max(72),
        golesLocal:     z.number().int().min(0).max(50),
        golesVisitante: z.number().int().min(0).max(50)
    })).nonempty()
});

const resultadoRealSchema = z.object({
    partidoId:      z.number().int().min(1).max(72),
    golesLocal:     z.number().int().min(0).max(50),
    golesVisitante: z.number().int().min(0).max(50)
});

const campeonSchema = z.object({
    idUsuario:       z.number().int().positive(),
    seleccionCampeon: z.string().min(2).max(100).trim(),
    golesLocal:      z.number().int().min(0).max(50),
    golesVisitante:  z.number().int().min(0).max(50)
});

// ─── HELPERS ────────────────────────────────────────────────────────────────

// Calcula el costo en goles de desbloquear un partido según el tiempo restante
function calcularCostoGoles(msHastaPartido) {
    const min30  = 30 * 60 * 1000;
    const min59  = 59 * 60 * 1000;
    if (msHastaPartido <= 0)    return null;   // ya empezó — imposible
    if (msHastaPartido <= min30) return 5;     // últimos 30 min
    if (msHastaPartido <= min59) return 3;     // entre 59 y 30 min
    return 1;                                   // más de 1 hora antes
}

// ─── GUARDAR QUINIELA (solo partidos desbloqueados, máx 3 modificaciones) ──

router.post('/guardar-quiniela', async (req, res) => {
    try {
        const { idUsuario, pronosticos } = quinielaSchema.parse(req.body);
        const pool = await poolPromise;

        // Verificar suscripción activa
        const sub = await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .query(`
                SELECT s.IdSuscripcion, s.GolesRestantes, p.MaxPartidos
                FROM dbo.Suscripciones s
                INNER JOIN dbo.Paquetes p ON s.IdPaquete = p.IdPaquete
                WHERE s.IdUsuario = @IdUsuario AND s.Activa = 1
            `);

        if (sub.recordset.length === 0) {
            return res.status(403).json({ ok: false, message: '⛔ No tienes una suscripción activa.' });
        }

        let errores = [];
        let guardados = 0;

        for (const pro of pronosticos) {
            // 1. Verificar que el partido esté desbloqueado
            const desbloq = await pool.request()
                .input('IdUsuario', sql.Int, idUsuario)
                .input('PartidoId', sql.Int, pro.partidoId)
                .query(`
                    SELECT IdDesbloqueo, ModificacionesUsadas
                    FROM dbo.PartidosDesbloqueados
                    WHERE IdUsuario = @IdUsuario AND PartidoId = @PartidoId
                `);

            if (desbloq.recordset.length === 0) {
                errores.push(`Partido #${pro.partidoId} no desbloqueado.`);
                continue;
            }

            const { IdDesbloqueo, ModificacionesUsadas } = desbloq.recordset[0];

            // 2. Verificar que no haya agotado las 3 modificaciones
            if (ModificacionesUsadas >= 3) {
                errores.push(`Partido #${pro.partidoId}: agotaste tus 3 modificaciones.`);
                continue;
            }

            // 3. Guardar pronóstico
            await pool.request()
                .input('IdUsuario',      sql.Int, idUsuario)
                .input('PartidoId',      sql.Int, pro.partidoId)
                .input('GolesLocal',     sql.Int, pro.golesLocal)
                .input('GolesVisitante', sql.Int, pro.golesVisitante)
                .query(`
                    IF EXISTS (SELECT 1 FROM dbo.Pronosticos WHERE IdUsuario=@IdUsuario AND PartidoId=@PartidoId)
                        UPDATE dbo.Pronosticos 
                        SET GolesLocal=@GolesLocal, GolesVisitante=@GolesVisitante 
                        WHERE IdUsuario=@IdUsuario AND PartidoId=@PartidoId
                    ELSE
                        INSERT INTO dbo.Pronosticos (IdUsuario,PartidoId,GolesLocal,GolesVisitante)
                        VALUES (@IdUsuario,@PartidoId,@GolesLocal,@GolesVisitante)
                `);

            // 4. Incrementar modificaciones usadas
            await pool.request()
                .input('IdDesbloqueo', sql.Int, IdDesbloqueo)
                .query(`UPDATE dbo.PartidosDesbloqueados SET ModificacionesUsadas = ModificacionesUsadas + 1 WHERE IdDesbloqueo = @IdDesbloqueo`);

            guardados++;
        }

        // Asegurar registro en Quinielas
        await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .query(`
                IF NOT EXISTS (SELECT 1 FROM dbo.Quinielas WHERE IdUsuario=@IdUsuario)
                    INSERT INTO dbo.Quinielas (IdUsuario, Estatus) VALUES (@IdUsuario, 'Borrador')
            `);

        const msg = errores.length > 0
            ? `✅ ${guardados} guardados. ⚠️ ${errores.join(' | ')}`
            : `✅ ${guardados} pronóstico(s) guardado(s) correctamente.`;

        return res.json({ ok: true, message: msg });

    } catch (error) {
        console.error(error);
        return res.status(400).json({ ok: false, message: 'Error al procesar la solicitud.' });
    }
});

// ─── OBTENER QUINIELA ────────────────────────────────────────────────────────

router.get('/obtener-quiniela/:idUsuario', async (req, res) => {
    try {
        const idUsuario = parseInt(req.params.idUsuario);
        const pool = await poolPromise;

        const qPronosticos = await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .query(`SELECT PartidoId, GolesLocal, GolesVisitante FROM dbo.Pronosticos WHERE IdUsuario=@IdUsuario`);

        return res.json({ ok: true, pronosticos: qPronosticos.recordset });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al recuperar datos.' });
    }
});

// ─── DATOS DEL USUARIO PARA LA QUINIELA (suscripción + partidos desbloqueados) ─

router.get('/mis-datos/:idUsuario', async (req, res) => {
    try {
        const idUsuario = parseInt(req.params.idUsuario);
        const pool = await poolPromise;

        // Suscripción activa
        const sub = await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .query(`
                SELECT s.GolesRestantes, p.Nombre AS Paquete, p.MaxPartidos, p.Goles AS GolesIniciales
                FROM dbo.Suscripciones s
                INNER JOIN dbo.Paquetes p ON s.IdPaquete = p.IdPaquete
                WHERE s.IdUsuario = @IdUsuario AND s.Activa = 1
            `);

        // Partidos desbloqueados con modificaciones restantes
        const desbloqueados = await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .query(`
                SELECT PartidoId, ModificacionesUsadas, GolesGastados
                FROM dbo.PartidosDesbloqueados
                WHERE IdUsuario = @IdUsuario
            `);

        const suscripcion = sub.recordset.length > 0 ? sub.recordset[0] : null;

        return res.json({
            ok: true,
            suscripcion,
            partidosDesbloqueados: desbloqueados.recordset
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al obtener datos del usuario.' });
    }
});

// ─── DESBLOQUEAR PARTIDO (descuenta goles) ──────────────────────────────────

router.post('/desbloquear-partido', async (req, res) => {
    try {
        const { idUsuario, partidoId, fechaPartido } = req.body;
        if (!idUsuario || !partidoId || !fechaPartido) {
            return res.status(400).json({ ok: false, message: 'Datos incompletos.' });
        }

        const pool = await poolPromise;

        // 1. Verificar suscripción activa y goles disponibles
        const sub = await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .query(`
                SELECT s.IdSuscripcion, s.GolesRestantes, p.MaxPartidos
                FROM dbo.Suscripciones s
                INNER JOIN dbo.Paquetes p ON s.IdPaquete = p.IdPaquete
                WHERE s.IdUsuario = @IdUsuario AND s.Activa = 1
            `);

        if (sub.recordset.length === 0) {
            return res.status(403).json({ ok: false, message: '⛔ No tienes suscripción activa.' });
        }

        const { IdSuscripcion, GolesRestantes, MaxPartidos } = sub.recordset[0];

        // 2. Verificar que no exceda el límite de partidos del paquete
        const totalDesbloqueados = await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .query(`SELECT COUNT(*) AS Total FROM dbo.PartidosDesbloqueados WHERE IdUsuario=@IdUsuario`);

        if (totalDesbloqueados.recordset[0].Total >= MaxPartidos) {
            return res.status(403).json({ ok: false, message: `⛔ Ya alcanzaste el límite de partidos de tu paquete (${MaxPartidos}).` });
        }

        // 3. Calcular costo según tiempo restante
        const msHastaPartido = new Date(fechaPartido).getTime() - Date.now();
        const costo = calcularCostoGoles(msHastaPartido);

        if (costo === null) {
            return res.status(403).json({ ok: false, message: '⛔ El partido ya empezó. No se puede desbloquear.' });
        }

        if (GolesRestantes < costo) {
            return res.status(403).json({ ok: false, message: `⛔ No tienes suficientes goles. Necesitas ${costo}, tienes ${GolesRestantes}.` });
        }

        // 4. Verificar que no esté ya desbloqueado
        const yaDesbloqueado = await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .input('PartidoId', sql.Int, partidoId)
            .query(`SELECT 1 FROM dbo.PartidosDesbloqueados WHERE IdUsuario=@IdUsuario AND PartidoId=@PartidoId`);

        if (yaDesbloqueado.recordset.length > 0) {
            return res.status(409).json({ ok: false, message: 'Este partido ya está desbloqueado.' });
        }

        // 5. Descontar goles y registrar desbloqueo
        await pool.request()
            .input('IdSuscripcion', sql.Int, IdSuscripcion)
            .input('Costo', sql.Int, costo)
            .query(`UPDATE dbo.Suscripciones SET GolesRestantes = GolesRestantes - @Costo WHERE IdSuscripcion=@IdSuscripcion`);

        await pool.request()
            .input('IdUsuario',    sql.Int, idUsuario)
            .input('PartidoId',    sql.Int, partidoId)
            .input('GolesGastados', sql.Int, costo)
            .query(`INSERT INTO dbo.PartidosDesbloqueados (IdUsuario, PartidoId, GolesGastados) VALUES (@IdUsuario, @PartidoId, @GolesGastados)`);

        const golesNuevos = GolesRestantes - costo;
        return res.json({
            ok: true,
            message: `🔓 Partido desbloqueado. Gastaste ${costo} gol(es). Te quedan ${golesNuevos} goles.`,
            golesRestantes: golesNuevos,
            costo
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al desbloquear partido.' });
    }
});

// ─── GUARDAR RESULTADO OFICIAL (ADMIN) ──────────────────────────────────────

router.post('/guardar-resultado', async (req, res) => {
    try {
        const { partidoId, golesLocal, golesVisitante, local, visitante } = req.body;
        resultadoRealSchema.parse({ partidoId, golesLocal, golesVisitante });
        const pool = await poolPromise;

        // 1. Guardar resultado oficial
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

        // 2. Responder al admin de inmediato — los correos van en background
        res.json({ ok: true, message: 'Resultado oficial guardado. Enviando notificaciones...' });

        // 3. Buscar todos los usuarios que pronosticaron este partido
        const pronosticos = await pool.request()
            .input('PartidoId', sql.Int, partidoId)
            .query(`
                SELECT p.IdUsuario, p.GolesLocal AS ProLocal, p.GolesVisitante AS ProVisitante,
                       u.Nombre, u.Correo
                FROM dbo.Pronosticos p
                INNER JOIN dbo.Usuarios u ON p.IdUsuario = u.IdUsuario
                WHERE p.PartidoId = @PartidoId
                AND u.Correo IS NOT NULL AND u.Correo != ''
            `);

        // 4. Calcular resultado y enviar correo a cada uno
        for (const pro of pronosticos.recordset) {
            const { ProLocal, ProVisitante, Nombre, Correo } = pro;
            let puntos = 0;
            let estado = 'Falló';

            if (ProLocal === golesLocal && ProVisitante === golesVisitante) {
                puntos = 5; estado = 'Exacto';
            } else if (
                (ProLocal > ProVisitante && golesLocal > golesVisitante) ||
                (ProLocal < ProVisitante && golesLocal < golesVisitante) ||
                (ProLocal === ProVisitante && golesLocal === golesVisitante)
            ) {
                puntos = 3; estado = 'Acierto';
            }

            // Enviar en background sin bloquear
            enviarCorreoResultado({
                correo:        Correo,
                nombre:        Nombre,
                local:         local  || `Equipo Local`,
                visitante:     visitante || `Equipo Visitante`,
                golesLocal,
                golesVisitante,
                proLocal:      ProLocal,
                proVisitante:  ProVisitante,
                puntos,
                estado
            }).catch(err => console.error(`Error correo a ${Correo}:`, err.message));
        }

    } catch (error) {
        console.error(error);
        return res.status(400).json({ ok: false, message: 'Error al guardar resultado.' });
    }
});

// ─── OBTENER RESULTADOS (ADMIN) ──────────────────────────────────────────────

router.get('/obtener-resultados', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`SELECT PartidoId, GolesLocal, GolesVisitante FROM dbo.ResultadosReales`);
        return res.json({ ok: true, resultados: result.recordset });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error al obtener resultados.' });
    }
});

// ─── CALCULAR PUNTOS ─────────────────────────────────────────────────────────

router.post('/calcular-puntos', async (req, res) => {
    try {
        const pool = await poolPromise;

        const pronosticos = await pool.request().query(`
            SELECT p.IdUsuario, p.PartidoId,
                   p.GolesLocal AS ProLocal, p.GolesVisitante AS ProVisitante,
                   r.GolesLocal AS RealLocal, r.GolesVisitante AS RealVisitante
            FROM dbo.Pronosticos p
            INNER JOIN dbo.ResultadosReales r ON p.PartidoId = r.PartidoId
        `);

        // Calcular puntos por partido
        const mapaPuntos    = {};
        const mapaAciertos  = {};

        pronosticos.recordset.forEach(row => {
            const { IdUsuario, ProLocal, ProVisitante, RealLocal, RealVisitante } = row;
            if (!mapaPuntos[IdUsuario])   mapaPuntos[IdUsuario]   = 0;
            if (!mapaAciertos[IdUsuario]) mapaAciertos[IdUsuario] = 0;

            if (ProLocal === RealLocal && ProVisitante === RealVisitante) {
                mapaPuntos[IdUsuario]   += 5;
                mapaAciertos[IdUsuario] += 1;
            } else if (
                (ProLocal > ProVisitante && RealLocal > RealVisitante) ||
                (ProLocal < ProVisitante && RealLocal < RealVisitante) ||
                (ProLocal === ProVisitante && RealLocal === RealVisitante)
            ) {
                mapaPuntos[IdUsuario]   += 3;
                mapaAciertos[IdUsuario] += 1;
            }
        });

        // Sumar puntos por campeón
        const campeonReal = await pool.request().query(`SELECT TOP 1 * FROM dbo.ResultadoCampeon ORDER BY IdResultado DESC`);
        if (campeonReal.recordset.length > 0) {
            const { SeleccionCampeon: campeonNombre, GolesLocal: cRL, GolesVisitante: cRV } = campeonReal.recordset[0];

            const pronosticosCampeon = await pool.request().query(`SELECT * FROM dbo.PronosticosCampeon`);
            pronosticosCampeon.recordset.forEach(pc => {
                if (!mapaPuntos[pc.IdUsuario]) mapaPuntos[pc.IdUsuario] = 0;
                const aciertoNombre  = pc.SeleccionCampeon.toLowerCase() === campeonNombre.toLowerCase();
                const aciertoMarcador = pc.GolesLocal === cRL && pc.GolesVisitante === cRV;

                if (aciertoNombre && aciertoMarcador) {
                    mapaPuntos[pc.IdUsuario] += 25; // campeón + marcador exacto
                } else if (aciertoNombre) {
                    mapaPuntos[pc.IdUsuario] += 15; // solo campeón
                }
            });
        }

        // Persistir en dbo.Puntajes
        for (const idUsuario in mapaPuntos) {
            await pool.request()
                .input('IdUsuario', sql.Int, parseInt(idUsuario))
                .input('Puntos',    sql.Int, mapaPuntos[idUsuario])
                .input('Aciertos',  sql.Int, mapaAciertos[idUsuario] || 0)
                .query(`
                    IF EXISTS (SELECT 1 FROM dbo.Puntajes WHERE IdUsuario=@IdUsuario)
                        UPDATE dbo.Puntajes SET PuntosTotales=@Puntos WHERE IdUsuario=@IdUsuario
                    ELSE
                        INSERT INTO dbo.Puntajes (IdUsuario,PuntosTotales) VALUES (@IdUsuario,@Puntos)
                `);
        }

        return res.json({ ok: true, message: '✅ Puntos recalculados incluyendo pronóstico de campeón.' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al calcular puntos.' });
    }
});

// ─── TABLA GENERAL ───────────────────────────────────────────────────────────

router.get('/tabla-general', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT
                u.IdUsuario, u.Nombre, u.FotoUrl,
                COALESCE(p.PuntosTotales, 0) AS Puntos,
                DENSE_RANK() OVER (ORDER BY COALESCE(p.PuntosTotales,0) DESC, u.Nombre ASC) AS PosicionReal,
                (SELECT COUNT(*) FROM dbo.Pronosticos pr WHERE pr.IdUsuario=u.IdUsuario) AS Predicciones,
                (
                    SELECT COUNT(*) FROM dbo.Pronosticos pr
                    INNER JOIN dbo.ResultadosReales rr ON pr.PartidoId=rr.PartidoId
                    WHERE pr.IdUsuario=u.IdUsuario AND (
                        (pr.GolesLocal=rr.GolesLocal AND pr.GolesVisitante=rr.GolesVisitante) OR
                        (pr.GolesLocal>pr.GolesVisitante AND rr.GolesLocal>rr.GolesVisitante) OR
                        (pr.GolesLocal<pr.GolesVisitante AND rr.GolesLocal<rr.GolesVisitante) OR
                        (pr.GolesLocal=pr.GolesVisitante AND rr.GolesLocal=rr.GolesVisitante)
                    )
                ) AS Aciertos
            FROM dbo.Usuarios u
            LEFT JOIN dbo.Puntajes p ON u.IdUsuario=p.IdUsuario
            WHERE u.Activo=1
            AND U.IdUsuario != 1
            ORDER BY Puntos DESC, Aciertos DESC, u.Nombre ASC
        `);
        return res.json({ ok: true, ranking: result.recordset });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al consultar tabla general.' });
    }
});

// ─── MIS RESULTADOS ──────────────────────────────────────────────────────────

router.get('/mis-resultados/:idUsuario', async (req, res) => {
    try {
        const idUsuario = parseInt(req.params.idUsuario);
        const pool = await poolPromise;

        const result = await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .query(`
                SELECT p.PartidoId,
                       p.GolesLocal AS ProLocal, p.GolesVisitante AS ProVisitante,
                       r.GolesLocal AS RealLocal, r.GolesVisitante AS RealVisitante
                FROM dbo.Pronosticos p
                LEFT JOIN dbo.ResultadosReales r ON p.PartidoId=r.PartidoId
                WHERE p.IdUsuario=@IdUsuario
            `);

        const rankingQ = await pool.request().query(`
            SELECT u.IdUsuario,
                   DENSE_RANK() OVER (ORDER BY COALESCE(p.PuntosTotales,0) DESC) AS Posicion
            FROM dbo.Usuarios u LEFT JOIN dbo.Puntajes p ON u.IdUsuario=p.IdUsuario
            WHERE u.Activo=1
        `);

        const miPos = rankingQ.recordset.find(u => u.IdUsuario === idUsuario);

        let exactos=0, correctos=0, fallados=0, pendientes=0, puntos=0;
        const historial = result.recordset.map(row => {
            const { PartidoId, ProLocal, ProVisitante, RealLocal, RealVisitante } = row;
            let ptsPartido=0, estado='Pendiente';
            if (RealLocal===null) { pendientes++; }
            else if (ProLocal===RealLocal && ProVisitante===RealVisitante) { exactos++; ptsPartido=5; estado='Exacto'; }
            else if (
                (ProLocal>ProVisitante&&RealLocal>RealVisitante)||
                (ProLocal<ProVisitante&&RealLocal<RealVisitante)||
                (ProLocal===ProVisitante&&RealLocal===RealVisitante)
            ) { correctos++; ptsPartido=3; estado='Acierto'; }
            else { fallados++; estado='Falló'; }
            puntos += ptsPartido;
            return {
                partidoId: PartidoId,
                pronostico: `${ProLocal} - ${ProVisitante}`,
                resultadoReal: RealLocal!==null ? `${RealLocal} - ${RealVisitante}` : 'Pendiente',
                puntos: ptsPartido, estado
            };
        });

        const completados = exactos+correctos+fallados;
        const efectividad = completados>0 ? Math.round(((exactos+correctos)/completados)*100) : 0;

        return res.json({
            ok: true,
            posicion: miPos ? `${miPos.Posicion}° lugar` : '1° lugar',
            puntosTotales: puntos,
            aciertos: exactos+correctos,
            partidosJugados: completados,
            resumen: { marcadoresExactos:exactos, ganadoresCorrectos:correctos, fallados, pendientes },
            efectividad: `${efectividad}%`,
            historial
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al procesar historial.' });
    }
});

// ─── PRONÓSTICO DE CAMPEÓN ───────────────────────────────────────────────────

router.post('/campeon', async (req, res) => {
    try {
        const { idUsuario, seleccionCampeon, golesLocal, golesVisitante } = campeonSchema.parse(req.body);
        const pool = await poolPromise;

        await pool.request()
            .input('IdUsuario',        sql.Int, idUsuario)
            .input('SeleccionCampeon', sql.NVarChar(100), seleccionCampeon)
            .input('GolesLocal',       sql.Int, golesLocal)
            .input('GolesVisitante',   sql.Int, golesVisitante)
            .query(`
                IF EXISTS (SELECT 1 FROM dbo.PronosticosCampeon WHERE IdUsuario=@IdUsuario)
                    UPDATE dbo.PronosticosCampeon
                    SET SeleccionCampeon=@SeleccionCampeon, GolesLocal=@GolesLocal,
                        GolesVisitante=@GolesVisitante, FechaActualizacion=GETDATE()
                    WHERE IdUsuario=@IdUsuario
                ELSE
                    INSERT INTO dbo.PronosticosCampeon (IdUsuario,SeleccionCampeon,GolesLocal,GolesVisitante)
                    VALUES (@IdUsuario,@SeleccionCampeon,@GolesLocal,@GolesVisitante)
            `);

        return res.json({ ok: true, message: '🏆 Pronóstico de campeón guardado.' });
    } catch (error) {
        console.error(error);
        return res.status(400).json({ ok: false, message: 'Error al guardar pronóstico de campeón.' });
    }
});

router.get('/campeon/:idUsuario', async (req, res) => {
    try {
        const idUsuario = parseInt(req.params.idUsuario);
        const pool = await poolPromise;
        const result = await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .query(`SELECT SeleccionCampeon, GolesLocal, GolesVisitante FROM dbo.PronosticosCampeon WHERE IdUsuario=@IdUsuario`);
        return res.json({ ok: true, campeon: result.recordset[0] || null });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error al obtener pronóstico.' });
    }
});

// ─── ADMIN: ACTIVAR SUSCRIPCIÓN ──────────────────────────────────────────────

router.post('/admin/activar-suscripcion', async (req, res) => {
    try {
        const { idUsuario, idPaquete, notas } = req.body;
        if (!idUsuario || !idPaquete) return res.status(400).json({ ok: false, message: 'Datos incompletos.' });

        const pool = await poolPromise;

        // Obtener goles del paquete
        const paq = await pool.request()
            .input('IdPaquete', sql.Int, idPaquete)
            .query(`SELECT Goles, Nombre FROM dbo.Paquetes WHERE IdPaquete=@IdPaquete`);

        if (paq.recordset.length === 0) return res.status(404).json({ ok: false, message: 'Paquete no encontrado.' });

        const { Goles, Nombre } = paq.recordset[0];

        // Desactivar suscripción anterior si existe
        await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .query(`UPDATE dbo.Suscripciones SET Activa=0 WHERE IdUsuario=@IdUsuario AND Activa=1`);

        // Crear nueva suscripción
        await pool.request()
            .input('IdUsuario',      sql.Int, idUsuario)
            .input('IdPaquete',      sql.Int, idPaquete)
            .input('GolesRestantes', sql.Int, Goles)
            .input('Notas',          sql.NVarChar(255), notas || null)
            .query(`INSERT INTO dbo.Suscripciones (IdUsuario,IdPaquete,GolesRestantes,Notas) VALUES (@IdUsuario,@IdPaquete,@GolesRestantes,@Notas)`);

        return res.json({ ok: true, message: `✅ Paquete ${Nombre} activado con ${Goles} goles.` });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al activar suscripción.' });
    }
});

// ─── ADMIN: USUARIOS CON SUSCRIPCIONES ──────────────────────────────────────

router.get('/admin/usuarios-suscripciones', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT
                u.IdUsuario, u.Nombre, u.Correo, u.FotoUrl,
                p.Nombre      AS Paquete,
                p.IdPaquete,
                s.GolesRestantes,
                p.Goles       AS GolesIniciales,
                p.MaxPartidos,
                s.FechaActivacion,
                s.Notas,
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
        return res.status(500).json({ ok: false, message: 'Error al obtener usuarios.' });
    }
});

// ─── ADMIN: GUARDAR CAMPEÓN REAL ─────────────────────────────────────────────

router.post('/admin/campeon-real', async (req, res) => {
    try {
        const { seleccionCampeon, golesLocal, golesVisitante } = req.body;
        const pool = await poolPromise;
        await pool.request()
            .input('SeleccionCampeon', sql.NVarChar(100), seleccionCampeon)
            .input('GolesLocal',       sql.Int, golesLocal)
            .input('GolesVisitante',   sql.Int, golesVisitante)
            .query(`INSERT INTO dbo.ResultadoCampeon (SeleccionCampeon,GolesLocal,GolesVisitante) VALUES (@SeleccionCampeon,@GolesLocal,@GolesVisitante)`);
        return res.json({ ok: true, message: '🏆 Campeón real registrado.' });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error al registrar campeón.' });
    }
});

module.exports = router;

// ─── OBTENER PAQUETES (para el select del admin) ─────────────────────────────
router.get('/paquetes', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`SELECT IdPaquete, Nombre, Precio, Goles, MaxPartidos FROM dbo.Paquetes ORDER BY Precio DESC`);
        return res.json({ ok: true, paquetes: result.recordset });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error al obtener paquetes.' });
    }
});

// =============================================
// AGREGAR ESTAS RUTAS EN quiniela.routes.js
// =============================================

// ─── OBTENER RESULTADOS PENDIENTES DE VALIDAR (admin) ────────────────────────
router.get('/admin/pendientes', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT IdPendiente, FixtureId, LocalNombre, VisitanteNombre,
                   GolesLocal, GolesVisitante, FechaPartido, Validado, PartidoId
            FROM dbo.ResultadosPendientes
            WHERE Validado = 0
            ORDER BY FechaPartido ASC
        `);
        return res.json({ ok: true, pendientes: result.recordset });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al obtener pendientes.' });
    }
});

// ─── VALIDAR RESULTADO PENDIENTE (admin confirma) ────────────────────────────
router.post('/admin/validar-pendiente', async (req, res) => {
    try {
        const { idPendiente, partidoId } = req.body;
        if (!idPendiente || !partidoId) {
            return res.status(400).json({ ok: false, message: 'Datos incompletos.' });
        }

        const pool = await poolPromise;

        // 1. Obtener datos del pendiente
        const pendiente = await pool.request()
            .input('IdPendiente', sql.Int, idPendiente)
            .query(`SELECT * FROM dbo.ResultadosPendientes WHERE IdPendiente = @IdPendiente`);

        if (pendiente.recordset.length === 0) {
            return res.status(404).json({ ok: false, message: 'Resultado pendiente no encontrado.' });
        }

        const { GolesLocal, GolesVisitante, LocalNombre, VisitanteNombre } = pendiente.recordset[0];

        // 2. Guardar como resultado oficial
        await pool.request()
            .input('PartidoId',      sql.Int, partidoId)
            .input('GolesLocal',     sql.Int, GolesLocal)
            .input('GolesVisitante', sql.Int, GolesVisitante)
            .query(`
                IF EXISTS (SELECT 1 FROM dbo.ResultadosReales WHERE PartidoId = @PartidoId)
                    UPDATE dbo.ResultadosReales SET GolesLocal=@GolesLocal, GolesVisitante=@GolesVisitante WHERE PartidoId=@PartidoId
                ELSE
                    INSERT INTO dbo.ResultadosReales (PartidoId,GolesLocal,GolesVisitante) VALUES (@PartidoId,@GolesLocal,@GolesVisitante)
            `);

        // 3. Marcar como validado
        await pool.request()
            .input('IdPendiente', sql.Int, idPendiente)
            .input('PartidoId',   sql.Int, partidoId)
            .query(`
                UPDATE dbo.ResultadosPendientes
                SET Validado=1, FechaValidacion=GETDATE(), PartidoId=@PartidoId
                WHERE IdPendiente=@IdPendiente
            `);

        // 4. Enviar correos automáticos en background
        const pronosticos = await pool.request()
            .input('PartidoId', sql.Int, partidoId)
            .query(`
                SELECT p.IdUsuario, p.GolesLocal AS ProLocal, p.GolesVisitante AS ProVisitante,
                       u.Nombre, u.Correo
                FROM dbo.Pronosticos p
                INNER JOIN dbo.Usuarios u ON p.IdUsuario = u.IdUsuario
                WHERE p.PartidoId = @PartidoId
                AND u.Correo IS NOT NULL AND u.Correo != ''
            `);

        for (const pro of pronosticos.recordset) {
            const { ProLocal, ProVisitante, Nombre, Correo } = pro;
            let puntos = 0, estado = 'Falló';

            if (ProLocal === GolesLocal && ProVisitante === GolesVisitante) {
                puntos = 5; estado = 'Exacto';
            } else if (
                (ProLocal > ProVisitante && GolesLocal > GolesVisitante) ||
                (ProLocal < ProVisitante && GolesLocal < GolesVisitante) ||
                (ProLocal === ProVisitante && GolesLocal === GolesVisitante)
            ) {
                puntos = 3; estado = 'Acierto';
            }

            enviarCorreoResultado({
                correo: Correo, nombre: Nombre,
                local: LocalNombre, visitante: VisitanteNombre,
                golesLocal: GolesLocal, golesVisitante: GolesVisitante,
                proLocal: ProLocal, proVisitante: ProVisitante,
                puntos, estado
            }).catch(err => console.error(`Error correo ${Correo}:`, err.message));
        }

        return res.json({ ok: true, message: `✅ Resultado validado y correos enviados.` });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al validar resultado.' });
    }
});

// ─── RECHAZAR PENDIENTE (admin descarta si está mal) ─────────────────────────
router.post('/admin/rechazar-pendiente', async (req, res) => {
    try {
        const { idPendiente } = req.body;
        const pool = await poolPromise;
        await pool.request()
            .input('IdPendiente', sql.Int, idPendiente)
            .query(`DELETE FROM dbo.ResultadosPendientes WHERE IdPendiente = @IdPendiente`);
        return res.json({ ok: true, message: 'Resultado descartado.' });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error al rechazar.' });
    }
});


const { sincronizarResultados } = require('./sync-resultados');

router.post('/admin/sincronizar', async (req, res) => {
    try {
        await sincronizarResultados();
        return res.json({ ok: true, message: '✅ Sincronización completada.' });
    } catch(e) {
        return res.status(500).json({ ok: false, message: 'Error al sincronizar.' });
    }
});


// ─── BOLSA: CALCULAR Y OBTENER ───────────────────────────────────────────────
router.get('/admin/bolsa', async (req, res) => {
    try {
        const pool = await poolPromise;

        // 1. Total de inscripciones (precio del paquete por cada suscripción activa)
        const inscripcionesResult = await pool.request().query(`
            SELECT
                COALESCE(SUM(p.Precio), 0) AS TotalInscripciones,
                COUNT(s.IdSuscripcion)      AS TotalParticipantes
            FROM dbo.Suscripciones s
            INNER JOIN dbo.Paquetes p ON s.IdPaquete = p.IdPaquete
            WHERE s.Activa = 1
        `);

        // 2. Total de recargas registradas manualmente
        const recargasResult = await pool.request().query(`
            SELECT COALESCE(SUM(Monto), 0) AS TotalRecargas
            FROM dbo.Bolsa
        `);

        const totalInscripciones  = parseFloat(inscripcionesResult.recordset[0].TotalInscripciones) || 0;
        const totalParticipantes  = inscripcionesResult.recordset[0].TotalParticipantes || 0;
        const totalRecargas       = parseFloat(recargasResult.recordset[0].TotalRecargas) || 0;
        const totalRecaudado      = totalInscripciones + totalRecargas;
        const bolsaPremios        = totalRecaudado * 0.85;
        const cuotaAdmin          = totalRecaudado * 0.15;
        const premio1             = bolsaPremios * 0.50;
        const premio2             = bolsaPremios * 0.30;
        const premio3             = bolsaPremios * 0.20;

        // 3. Top usuarios por puntos para calcular distribución
        const rankingResult = await pool.request().query(`
            SELECT TOP 5
                u.IdUsuario, u.Nombre,
                COALESCE(pt.PuntosTotales, 0) AS Puntos,
                DENSE_RANK() OVER (ORDER BY COALESCE(pt.PuntosTotales,0) DESC) AS Posicion
            FROM dbo.Usuarios u
            LEFT JOIN dbo.Puntajes pt ON u.IdUsuario = pt.IdUsuario
            WHERE u.Activo = 1
            ORDER BY Puntos DESC
        `);

        const ranking = rankingResult.recordset;
        const pos1    = ranking.filter(u => u.Posicion === 1);
        const pos2    = ranking.filter(u => u.Posicion === 2);
        const pos3    = ranking.filter(u => u.Posicion === 3);

        // Calcular bolsas combinadas en empates
        const combinar = (posiciones, premiosArr) => {
            const total = premiosArr.reduce((a, b) => a + b, 0);
            return posiciones.map(u => ({
                ...u,
                montoPremio: total / posiciones.length,
                porcentaje: ((total / bolsaPremios) * 100 / posiciones.length).toFixed(2)
            }));
        };

        let distribucion = [];
        if (pos1.length > 1) {
            distribucion = [
                ...combinar(pos1, [premio1, premio2]),
                ...combinar(pos2.length ? pos2 : pos3, [premio3])
            ];
        } else if (pos2.length > 1) {
            distribucion = [
                ...combinar(pos1, [premio1]),
                ...combinar(pos2, [premio2, premio3])
            ];
        } else if (pos3.length > 1) {
            distribucion = [
                ...combinar(pos1, [premio1]),
                ...combinar(pos2, [premio2]),
                ...combinar(pos3, [premio3])
            ];
        } else {
            distribucion = [
                ...(pos1[0] ? [{ ...pos1[0], montoPremio: premio1, porcentaje: '50.00' }] : []),
                ...(pos2[0] ? [{ ...pos2[0], montoPremio: premio2, porcentaje: '30.00' }] : []),
                ...(pos3[0] ? [{ ...pos3[0], montoPremio: premio3, porcentaje: '20.00' }] : [])
            ];
        }

        return res.json({
            ok: true,
            totalRecaudado,
            totalInscripciones,
            totalRecargas,
            totalParticipantes,
            bolsaPremios,
            cuotaAdmin,
            premio1, premio2, premio3,
            distribucion,
            ranking: ranking.slice(0, 5)
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al calcular bolsa.' });
    }
});

// ─── REVELAR GANADORES (envía correos a todos) ────────────────────────────────
router.post('/admin/revelar-ganadores', async (req, res) => {
    try {
        const pool = await poolPromise;

        // Verificar que no se haya revelado antes
        const config = await pool.request()
            .query(`SELECT Valor FROM dbo.ConfigQuiniela WHERE Clave='GanadoresRevelados'`);
        if (config.recordset[0]?.Valor === '1') {
            return res.status(409).json({ ok: false, message: '⚠️ Los ganadores ya fueron revelados.' });
        }

        // Obtener bolsa calculada
        const bolsaResult = await pool.request().query(`
            SELECT
                COALESCE(SUM(p.Precio), 0) AS TotalInscripciones
            FROM dbo.Suscripciones s
            INNER JOIN dbo.Paquetes p ON s.IdPaquete = p.IdPaquete
            WHERE s.Activa = 1
        `);
        const recargasResult = await pool.request().query(`SELECT COALESCE(SUM(Monto),0) AS TotalRecargas FROM dbo.Bolsa`);
        const totalRecaudado = parseFloat(bolsaResult.recordset[0].TotalInscripciones) + parseFloat(recargasResult.recordset[0].TotalRecargas);
        const bolsaPremios   = totalRecaudado * 0.85;
        const premio1 = bolsaPremios * 0.50;
        const premio2 = bolsaPremios * 0.30;
        const premio3 = bolsaPremios * 0.20;

        // Top usuarios
        const rankingResult = await pool.request().query(`
            SELECT TOP 5
                u.IdUsuario, u.Nombre,
                COALESCE(pt.PuntosTotales, 0) AS Puntos,
                DENSE_RANK() OVER (ORDER BY COALESCE(pt.PuntosTotales,0) DESC) AS Posicion
            FROM dbo.Usuarios u
            LEFT JOIN dbo.Puntajes pt ON u.IdUsuario = pt.IdUsuario
            WHERE u.Activo = 1
            ORDER BY Puntos DESC
        `);

        const ranking = rankingResult.recordset;
        const pos1 = ranking.filter(u => u.Posicion === 1);
        const pos2 = ranking.filter(u => u.Posicion === 2);
        const pos3 = ranking.filter(u => u.Posicion === 3);

        const combinar = (posiciones, premiosArr) => {
            const total = premiosArr.reduce((a, b) => a + b, 0);
            return posiciones.map(u => ({ ...u, montoPremio: total / posiciones.length, porcentaje: ((total / bolsaPremios) * 100 / posiciones.length).toFixed(2) }));
        };

        let distribucion = [];
        if (pos1.length > 1)      distribucion = [...combinar(pos1, [premio1, premio2]), ...combinar(pos2.length ? pos2 : pos3, [premio3])];
        else if (pos2.length > 1) distribucion = [...combinar(pos1, [premio1]), ...combinar(pos2, [premio2, premio3])];
        else if (pos3.length > 1) distribucion = [...combinar(pos1, [premio1]), ...combinar(pos2, [premio2]), ...combinar(pos3, [premio3])];
        else distribucion = [
            ...(pos1[0] ? [{ ...pos1[0], montoPremio: premio1, porcentaje: '50.00' }] : []),
            ...(pos2[0] ? [{ ...pos2[0], montoPremio: premio2, porcentaje: '30.00' }] : []),
            ...(pos3[0] ? [{ ...pos3[0], montoPremio: premio3, porcentaje: '20.00' }] : [])
        ];

        // Guardar ganadores en BD
        for (const g of distribucion) {
            await pool.request()
                .input('IdUsuario',        sql.Int,           g.IdUsuario)
                .input('Posicion',         sql.Int,           g.Posicion)
                .input('Puntos',           sql.Int,           g.Puntos)
                .input('PorcentajePremio', sql.Decimal(5,2),  parseFloat(g.porcentaje))
                .input('MontoPremio',      sql.Decimal(10,2), g.montoPremio)
                .query(`INSERT INTO dbo.GanadoresFinales (IdUsuario,Posicion,Puntos,PorcentajePremio,MontoPremio) VALUES (@IdUsuario,@Posicion,@Puntos,@PorcentajePremio,@MontoPremio)`);
        }

        // Marcar como revelado
        await pool.request().query(`UPDATE dbo.ConfigQuiniela SET Valor='1' WHERE Clave='GanadoresRevelados'`);

        // Enviar correos a todos
        const todosResult = await pool.request().query(`
            SELECT u.IdUsuario, u.Nombre, u.Correo,
                   COALESCE(pt.PuntosTotales,0) AS Puntos,
                   DENSE_RANK() OVER (ORDER BY COALESCE(pt.PuntosTotales,0) DESC) AS Posicion
            FROM dbo.Usuarios u
            LEFT JOIN dbo.Puntajes pt ON u.IdUsuario = pt.IdUsuario
            WHERE u.Activo=1 AND u.Correo IS NOT NULL AND u.Correo!=''
            ORDER BY Puntos DESC
        `);

        const medallas     = { 1:'🥇', 2:'🥈', 3:'🥉' };
        const fmt          = n => `$${Number(n).toLocaleString('es-MX',{minimumFractionDigits:2})} MXN`;
        const tablaGanadores = distribucion.map(g => `
            <tr>
                <td style="padding:.5rem 1rem;text-align:center;">${medallas[g.Posicion]||g.Posicion+'°'}</td>
                <td style="padding:.5rem 1rem;"><strong>${g.Nombre}</strong></td>
                <td style="padding:.5rem 1rem;text-align:center;">${g.Puntos} pts</td>
                <td style="padding:.5rem 1rem;text-align:center;color:#2ecc71;"><strong>${fmt(g.montoPremio)}</strong></td>
            </tr>`).join('');

        for (const u of todosResult.recordset) {
            const ganadorInfo = distribucion.find(g => g.IdUsuario === u.IdUsuario);
            const htmlCorreo = `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#05101a;color:white;border-radius:16px;overflow:hidden;">
                <div style="background:linear-gradient(135deg,#f1c40f,#d4ac0d);padding:2rem;text-align:center;">
                    <h1 style="margin:0;color:#000;font-size:2rem;">🏆 ¡El Mundial ha terminado!</h1>
                    <p style="margin:.5rem 0 0;color:rgba(0,0,0,.7);">Quiniela Mundial 2026</p>
                </div>
                ${ganadorInfo ? `
                <div style="background:rgba(46,204,113,.15);border:1px solid rgba(46,204,113,.3);margin:1.5rem;border-radius:12px;padding:1.5rem;text-align:center;">
                    <p style="font-size:3rem;margin:0;">${medallas[ganadorInfo.Posicion]}</p>
                    <h2 style="margin:.5rem 0;color:#2ecc71;">¡Felicidades ${u.Nombre}!</h2>
                    <p style="color:#b8c2d6;">Quedaste en <strong style="color:white;">${ganadorInfo.Posicion}° lugar</strong> con <strong style="color:#2ecc71;">${ganadorInfo.Puntos} puntos</strong></p>
                    <p style="font-size:2rem;color:#f1c40f;font-weight:bold;margin:.5rem 0;">Premio: ${fmt(ganadorInfo.montoPremio)}</p>
                    <p style="color:#b8c2d6;font-size:.85rem;">Contacta al administrador para recibir tu premio.</p>
                </div>` : `
                <div style="padding:1.5rem;text-align:center;">
                    <p style="color:#b8c2d6;">Hola <strong style="color:white;">${u.Nombre}</strong>, terminaste en la posición ${medallas[u.Posicion]||''} ${u.Posicion}° con <strong style="color:#2ecc71;">${u.Puntos} puntos</strong>. ¡Gracias por participar!</p>
                </div>`}
                <div style="padding:0 1.5rem 1.5rem;">
                    <h3 style="color:white;margin-bottom:.8rem;">📊 Tabla de Ganadores</h3>
                    <table style="width:100%;border-collapse:collapse;background:rgba(255,255,255,.04);border-radius:8px;overflow:hidden;">
                        <thead><tr style="background:rgba(255,255,255,.08);">
                            <th style="padding:.5rem 1rem;">Pos.</th>
                            <th style="padding:.5rem 1rem;text-align:left;">Participante</th>
                            <th style="padding:.5rem 1rem;">Puntos</th>
                            <th style="padding:.5rem 1rem;">Premio</th>
                        </tr></thead>
                        <tbody>${tablaGanadores}</tbody>
                    </table>
                    <p style="color:#b8c2d6;font-size:.8rem;margin-top:1rem;text-align:center;">
                        Bolsa total: ${fmt(totalRecaudado)} · Premios: ${fmt(bolsaPremios)} (85%)
                    </p>
                </div>
                <div style="background:rgba(0,0,0,.3);padding:1rem;text-align:center;">
                    <p style="margin:0;color:#b8c2d6;font-size:.8rem;">Quiniela Mundial 2026</p>
                </div>
            </div>`;

            enviarCorreoResultado({
                correo: u.Correo,
                nombre: u.Nombre,
                asunto: `🏆 Resultados finales Quiniela Mundial 2026`,
                htmlPersonalizado: htmlCorreo
            }).catch(err => console.error(`Error correo ${u.Correo}:`, err.message));
        }

        return res.json({
            ok: true,
            message: `🏆 Ganadores revelados y correos enviados a ${todosResult.recordset.length} participantes.`,
            distribucion
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al revelar ganadores.' });
    }
});

// ─── OBTENER ESTADO: ¿Ya se revelaron ganadores? ────────────────────────────
router.get('/estado-quiniela', async (req, res) => {
    try {
        const pool   = await poolPromise;
        const config = await pool.request().query(`SELECT Clave, Valor FROM dbo.ConfigQuiniela`);
        const estado = {};
        config.recordset.forEach(r => { estado[r.Clave] = r.Valor; });

        let ganadores = [];
        if (estado.GanadoresRevelados === '1') {
            const result = await pool.request().query(`
                SELECT g.Posicion, g.Puntos, g.MontoPremio, g.PorcentajePremio,
                       u.Nombre, u.FotoUrl
                FROM dbo.GanadoresFinales g
                INNER JOIN dbo.Usuarios u ON g.IdUsuario = u.IdUsuario
                ORDER BY g.Posicion ASC, g.MontoPremio DESC
            `);
            ganadores = result.recordset;
        }

        return res.json({ ok: true, ...estado, ganadores });
    } catch (error) {
        return res.status(500).json({ ok: false, message: 'Error al obtener estado.' });
    }
});


router.post('/admin/registrar-recarga', async (req, res) => {
    try {
        const { idUsuario, goles, monto, nota } = req.body;
        if (!idUsuario || !goles || !monto) {
            return res.status(400).json({ ok: false, message: 'Datos incompletos.' });
        }
        const pool = await poolPromise;

        // Sumar goles a la suscripción activa
        const result = await pool.request()
            .input('IdUsuario', sql.Int, idUsuario)
            .input('Goles',     sql.Int, goles)
            .query(`
                UPDATE dbo.Suscripciones
                SET GolesRestantes = GolesRestantes + @Goles
                WHERE IdUsuario = @IdUsuario AND Activa = 1
            `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ ok: false, message: 'No tiene suscripción activa.' });
        }

        // Registrar pago en la bolsa
        await pool.request()
            .input('IdUsuario', sql.Int,           idUsuario)
            .input('Monto',     sql.Decimal(10,2), parseFloat(monto))
            .input('Concepto',  sql.NVarChar(255), nota || `Recarga ${goles} goles`)
            .query(`INSERT INTO dbo.Bolsa (IdUsuario, Monto, Concepto) VALUES (@IdUsuario, @Monto, @Concepto)`);

        return res.json({ ok: true, message: `✅ ${goles} Goles agregados y $${monto} MXN registrados en bolsa.` });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: 'Error al registrar recarga.' });
    }
});