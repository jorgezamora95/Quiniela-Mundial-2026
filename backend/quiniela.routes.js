const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { sql, poolPromise } = require("./db");

// ✅ FIX: Schemas declarados al inicio, antes de usarse en las rutas
const quinielaSchema = z.object({
    idUsuario: z.number().int().positive(),
    accion: z.enum(['guardar', 'enviar']),
    pronosticos: z.array(
        z.object({
            partidoId: z.number().int().min(1).max(72),
            golesLocal: z.number().int().min(0).max(50),
            golesVisitante: z.number().int().min(0).max(50)
        })
    ).nonempty()
});

const resultadoRealSchema = z.object({
    partidoId: z.number().int().min(1).max(72),
    golesLocal: z.number().int().min(0).max(50),
    golesVisitante: z.number().int().min(0).max(50)
});

// --- GUARDAR QUINIELA ---
router.post('/guardar-quiniela', async (req, res) => {
    try {
        const { idUsuario, accion, pronosticos } = quinielaSchema.parse(req.body);
        const pool = await poolPromise;

        const revision = await pool.request()
            .input("IdUsuario", sql.Int, idUsuario)
            .query("SELECT Estatus FROM dbo.Quinielas WHERE IdUsuario = @IdUsuario");

        if (revision.recordset.length > 0 && revision.recordset[0].Estatus === 'Enviada') {
            return res.status(403).json({
                ok: false,
                message: "Esta quiniela ya fue enviada definitivamente y está bloqueada."
            });
        }

        const nuevoEstatus = (accion === 'enviar') ? 'Enviada' : 'Borrador';
        await pool.request()
            .input("IdUsuario", sql.Int, idUsuario)
            .input("Estatus", sql.VarChar(20), nuevoEstatus)
            .query(`
                IF EXISTS (SELECT 1 FROM dbo.Quinielas WHERE IdUsuario = @IdUsuario)
                    UPDATE dbo.Quinielas SET Estatus = @Estatus, FechaActualizacion = GETDATE() WHERE IdUsuario = @IdUsuario
                ELSE
                    INSERT INTO dbo.Quinielas (IdUsuario, Estatus) VALUES (@IdUsuario, @Estatus)
            `);

        for (const prod of pronosticos) {
            await pool.request()
                .input("IdUsuario", sql.Int, idUsuario)
                .input("PartidoId", sql.Int, prod.partidoId)
                .input("GolesLocal", sql.Int, prod.golesLocal)
                .input("GolesVisitante", sql.Int, prod.golesVisitante)
                .query(`
                    IF EXISTS (SELECT 1 FROM dbo.Pronosticos WHERE IdUsuario = @IdUsuario AND PartidoId = @PartidoId)
                        UPDATE dbo.Pronosticos SET GolesLocal = @GolesLocal, GolesVisitante = @GolesVisitante WHERE IdUsuario = @IdUsuario AND PartidoId = @PartidoId
                    ELSE
                        INSERT INTO dbo.Pronosticos (IdUsuario, PartidoId, GolesLocal, GolesVisitante) VALUES (@IdUsuario, @PartidoId, @GolesLocal, @GolesVisitante)
                `);
        }

        return res.status(200).json({
            ok: true,
            isFinal: (accion === 'enviar'),
            message: (accion === 'enviar')
                ? "¡Quiniela enviada de forma definitiva! Ya no se permiten cambios."
                : "¡Borrador guardado correctamente en SQL!"
        });

    } catch (error) {
        console.error(error);
        return res.status(400).json({ ok: false, message: "Error al procesar la solicitud en el servidor." });
    }
});

// --- OBTENER QUINIELA ---
router.get('/obtener-quiniela/:idUsuario', async (req, res) => {
    try {
        const idUsuario = parseInt(req.params.idUsuario);
        const pool = await poolPromise;

        const qEstatus = await pool.request()
            .input("IdUsuario", sql.Int, idUsuario)
            .query("SELECT Estatus FROM dbo.Quinielas WHERE IdUsuario = @IdUsuario");

        const estatus = qEstatus.recordset.length > 0 ? qEstatus.recordset[0].Estatus : 'Borrador';

        const qPronosticos = await pool.request()
            .input("IdUsuario", sql.Int, idUsuario)
            .query(`
                SELECT PartidoId, GolesLocal, GolesVisitante
                FROM dbo.Pronosticos
                WHERE IdUsuario = @IdUsuario
            `);

        return res.status(200).json({
            ok: true,
            estatus,
            pronosticos: qPronosticos.recordset
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: "Error al recuperar datos de la base de datos." });
    }
});

// --- GUARDAR RESULTADO OFICIAL (ADMIN) ---
router.post('/guardar-resultado', async (req, res) => {
    try {
        const { partidoId, golesLocal, golesVisitante } = resultadoRealSchema.parse(req.body);
        const pool = await poolPromise;

        await pool.request()
            .input("PartidoId", sql.Int, partidoId)
            .input("GolesLocal", sql.Int, golesLocal)
            .input("GolesVisitante", sql.Int, golesVisitante)
            .query(`
                IF EXISTS (SELECT 1 FROM dbo.ResultadosReales WHERE PartidoId = @PartidoId)
                    UPDATE dbo.ResultadosReales SET GolesLocal = @GolesLocal, GolesVisitante = @GolesVisitante WHERE PartidoId = @PartidoId
                ELSE
                    INSERT INTO dbo.ResultadosReales (PartidoId, GolesLocal, GolesVisitante) VALUES (@PartidoId, @GolesLocal, @GolesVisitante)
            `);

        return res.status(200).json({ ok: true, message: "Resultado oficial guardado con éxito." });
    } catch (error) {
        console.error(error);
        return res.status(400).json({ ok: false, message: "Error al procesar el resultado oficial." });
    }
});

// --- CALCULAR PUNTOS ---
router.post('/calcular-puntos', async (req, res) => {
    try {
        const pool = await poolPromise;

        const pronosticos = await pool.request().query(`
            SELECT p.IdUsuario, p.PartidoId, p.GolesLocal AS ProLocal, p.GolesVisitante AS ProVisitante,
                   r.GolesLocal AS RealLocal, r.GolesVisitante AS RealVisitante
            FROM dbo.Pronosticos p
            INNER JOIN dbo.Quinielas q ON p.IdUsuario = q.IdUsuario
            INNER JOIN dbo.ResultadosReales r ON p.PartidoId = r.PartidoId
            WHERE q.Estatus = 'Enviada'
        `);

        const mapaPuntos = {};

        pronosticos.recordset.forEach(row => {
            const { IdUsuario, ProLocal, ProVisitante, RealLocal, RealVisitante } = row;
            if (!mapaPuntos[IdUsuario]) mapaPuntos[IdUsuario] = 0;

            if (ProLocal === RealLocal && ProVisitante === RealVisitante) {
                mapaPuntos[IdUsuario] += 5;
            } else if (
                (ProLocal > ProVisitante && RealLocal > RealVisitante) ||
                (ProLocal < ProVisitante && RealLocal < RealVisitante) ||
                (ProLocal === ProVisitante && RealLocal === RealVisitante)
            ) {
                mapaPuntos[IdUsuario] += 3;
            }
        });

        for (const idUsuario in mapaPuntos) {
            await pool.request()
                .input("IdUsuario", sql.Int, parseInt(idUsuario))
                .input("Puntos", sql.Int, mapaPuntos[idUsuario])
                .query(`
                    IF EXISTS (SELECT 1 FROM dbo.Puntajes WHERE IdUsuario = @IdUsuario)
                        UPDATE dbo.Puntajes SET PuntosTotales = @Puntos WHERE IdUsuario = @IdUsuario
                    ELSE
                        INSERT INTO dbo.Puntajes (IdUsuario, PuntosTotales) VALUES (@IdUsuario, @Puntos)
                `);
        }

        return res.status(200).json({ ok: true, message: "¡Tabla de posiciones recalculada con éxito!" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: "Error interno al calcular puntos." });
    }
});

// --- TABLA GENERAL ---
router.get('/tabla-general', async (req, res) => {
    try {
        const pool = await poolPromise;

        const result = await pool.request().query(`
            SELECT
                u.IdUsuario,
                u.Nombre,
                u.FotoUrl,
                COALESCE(p.PuntosTotales, 0) AS Puntos,
                DENSE_RANK() OVER (ORDER BY COALESCE(p.PuntosTotales, 0) DESC, u.Nombre ASC) AS PosicionReal,
                (SELECT COUNT(*) FROM dbo.Pronosticos pr WHERE pr.IdUsuario = u.IdUsuario) AS Predicciones,
                (
                    SELECT COUNT(*) FROM dbo.Pronosticos pr
                    INNER JOIN dbo.ResultadosReales rr ON pr.PartidoId = rr.PartidoId
                    WHERE pr.IdUsuario = u.IdUsuario
                    AND (
                        (pr.GolesLocal = rr.GolesLocal AND pr.GolesVisitante = rr.GolesVisitante) OR
                        (pr.GolesLocal > pr.GolesVisitante AND rr.GolesLocal > rr.GolesVisitante) OR
                        (pr.GolesLocal < pr.GolesVisitante AND rr.GolesLocal < rr.GolesVisitante) OR
                        (pr.GolesLocal = pr.GolesVisitante AND rr.GolesLocal = rr.GolesVisitante)
                    )
                ) AS Aciertos
            FROM dbo.Usuarios u
            LEFT JOIN dbo.Puntajes p ON u.IdUsuario = p.IdUsuario
            WHERE u.Activo = 1
            ORDER BY Puntos DESC, Aciertos DESC, u.Nombre ASC
        `);

        return res.status(200).json({ ok: true, ranking: result.recordset });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: "Error al consultar la tabla general." });
    }
});

// --- MIS RESULTADOS ---
router.get('/mis-resultados/:idUsuario', async (req, res) => {
    try {
        const idUsuario = parseInt(req.params.idUsuario);
        const pool = await poolPromise;

        const result = await pool.request()
            .input("IdUsuario", sql.Int, idUsuario)
            .query(`
                SELECT
                    p.PartidoId, p.GolesLocal AS ProLocal, p.GolesVisitante AS ProVisitante,
                    r.GolesLocal AS RealLocal, r.GolesVisitante AS RealVisitante
                FROM dbo.Pronosticos p
                LEFT JOIN dbo.ResultadosReales r ON p.PartidoId = r.PartidoId
                INNER JOIN dbo.Quinielas q ON p.IdUsuario = q.IdUsuario
                WHERE p.IdUsuario = @IdUsuario AND q.Estatus = 'Enviada'
            `);

        const rankingQuery = await pool.request().query(`
            SELECT u.IdUsuario, DENSE_RANK() OVER (ORDER BY COALESCE(p.PuntosTotales, 0) DESC) AS Posicion
            FROM dbo.Usuarios u
            LEFT JOIN dbo.Puntajes p ON u.IdUsuario = p.IdUsuario
            WHERE u.Activo = 1
        `);

        const miFilaPos = rankingQuery.recordset.find(u => u.IdUsuario === idUsuario);
        const posicionActual = miFilaPos ? `${miFilaPos.Posicion}° lugar` : "1° lugar";

        let marcadoresExactos = 0;
        let ganadoresCorrectos = 0;
        let fallados = 0;
        let pendientes = 0;
        let puntosTotales = 0;
        const historialMapeado = [];

        result.recordset.forEach(row => {
            const { PartidoId, ProLocal, ProVisitante, RealLocal, RealVisitante } = row;
            let puntosPartido = 0;
            let estado = "Pendiente";

            if (RealLocal === null || RealVisitante === null) {
                pendientes++;
                estado = "Pendiente";
            } else if (ProLocal === RealLocal && ProVisitante === RealVisitante) {
                marcadoresExactos++;
                puntosPartido = 5;
                estado = "Exacto";
            } else if (
                (ProLocal > ProVisitante && RealLocal > RealVisitante) ||
                (ProLocal < ProVisitante && RealLocal < RealVisitante) ||
                (ProLocal === ProVisitante && RealLocal === RealVisitante)
            ) {
                ganadoresCorrectos++;
                puntosPartido = 3;
                estado = "Acierto";
            } else {
                fallados++;
                puntosPartido = 0;
                estado = "Falló";
            }

            puntosTotales += puntosPartido;

            historialMapeado.push({
                partidoId: PartidoId,
                pronostico: `${ProLocal} - ${ProVisitante}`,
                resultadoReal: (RealLocal !== null) ? `${RealLocal} - ${RealVisitante}` : "Pendiente",
                puntos: puntosPartido,
                estado
            });
        });

        const completados = marcadoresExactos + ganadoresCorrectos + fallados;
        const aciertosTotales = marcadoresExactos + ganadoresCorrectos;
        const efectividad = completados > 0 ? Math.round((aciertosTotales / completados) * 100) : 0;

        return res.status(200).json({
            ok: true,
            posicion: posicionActual,
            puntosTotales,
            aciertos: aciertosTotales,
            partidosJugados: completados,
            resumen: { marcadoresExactos, ganadoresCorrectos, fallados, pendientes },
            efectividad: `${efectividad}%`,
            historial: historialMapeado
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ ok: false, message: "Error al procesar el historial del usuario." });
    }
});

// --- OBTENER RESULTADOS (ADMIN) ---
router.get('/obtener-resultados', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT PartidoId, GolesLocal, GolesVisitante
            FROM dbo.ResultadosReales
        `);

        return res.status(200).json({
            ok: true,
            resultados: result.recordset
        });
    } catch (error) {
        console.error("Error obtener resultados:", error);
        return res.status(400).json({
            ok: false,
            message: "Error al procesar el resultado oficial."
        });
    }
});

module.exports = router;
