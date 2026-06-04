// =============================================
// PEGA ESTO AL FINAL DE quiniela.routes.js
// (justo antes del module.exports = router)
// =============================================

// ─── ADMIN: REGISTRAR RECARGA DE GOLES ───────────────────────────────────────
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

// ─── ADMIN: BOLSA ACUMULADA ───────────────────────────────────────────────────
// Suma inscripciones (precio del paquete) + recargas (tabla Bolsa)
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

// ─── ESTADO QUINIELA (¿ya se revelaron ganadores?) ───────────────────────────
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

// ─── ADMIN: REVELAR GANADORES ─────────────────────────────────────────────────
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
                    <p style="margin:.5rem 0 0;color:rgba(0,0,0,.7);">Quiniela Mundial 2026 — torreslab</p>
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
                    <p style="margin:0;color:#b8c2d6;font-size:.8rem;">Quiniela Mundial 2026 — torreslab</p>
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


// =============================================
// TAMBIÉN ACTUALIZA la función enviarCorreoResultado
// en quiniela.routes.js para que soporte htmlPersonalizado:
// =============================================
//
// async function enviarCorreoResultado({ correo, nombre, local, visitante,
//     golesLocal, golesVisitante, proLocal, proVisitante, puntos, estado,
//     asunto, htmlPersonalizado }) {   // ← agrega estos dos parámetros
//
//     const html = htmlPersonalizado || `... tu html actual ...`;
//
//     await transporter.sendMail({
//         from:    process.env.EMAIL_FROM,
//         to:      correo,
//         subject: asunto || `Resultado: ${local} ${golesLocal}-${golesVisitante} ${visitante}`,
//         html
//     });
// }
