const express = require("express");
const cors    = require("cors");
const bcrypt  = require("bcrypt");
const crypto  = require("crypto");
const { z }   = require('zod');
const { query } = require('./db');

const app = express();

app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json({ limit: '100kb' }));

// ─── REGISTRO ────────────────────────────────────────────────────────────────
app.post("/api/registro", async (req, res) => {
    try {
        const { nombre, correo, password, preguntaSeguridad, respuestaSeguridad, codigoInvitacion } = req.body;

        if (!nombre || !correo || !password || !preguntaSeguridad || !respuestaSeguridad || !codigoInvitacion)
            return res.status(400).json({ ok: false, message: "Todos los campos son obligatorios." });

        // Validar código de invitación
        const codResult = await query(
            `SELECT id_codigo AS "IdCodigo", utilizado AS "Utilizado"
             FROM codigos_invitacion WHERE LOWER(codigo)=LOWER($1)`,
            [codigoInvitacion.trim()]
        );

        if (codResult.rows.length === 0)
            return res.status(403).json({ ok: false, message: "⛔ Código de invitación inválido." });
        if (codResult.rows[0].Utilizado)
            return res.status(403).json({ ok: false, message: "⛔ Ese código ya fue utilizado." });

        const idCodigo = codResult.rows[0].IdCodigo;

        // Verificar correo duplicado
        const existe = await query(
            `SELECT id_usuario FROM usuarios WHERE correo=$1`,
            [correo]
        );
        if (existe.rows.length > 0)
            return res.status(409).json({ ok: false, message: "Ese correo ya está registrado." });

        const passwordHash  = await bcrypt.hash(password, 10);
        const respuestaHash = await bcrypt.hash(respuestaSeguridad.toLowerCase(), 10);

        const insertResult = await query(
            `INSERT INTO usuarios (nombre, correo, password_hash, pregunta_seguridad, respuesta_seguridad_hash)
             VALUES ($1, $2, $3, $4, $5) RETURNING id_usuario AS "IdUsuario"`,
            [nombre, correo, passwordHash, preguntaSeguridad, respuestaHash]
        );

        const nuevoIdUsuario = insertResult.rows[0].IdUsuario;

        await query(
            `UPDATE codigos_invitacion SET utilizado=TRUE, fecha_uso=NOW(), id_usuario=$1 WHERE id_codigo=$2`,
            [nuevoIdUsuario, idCodigo]
        );

        res.json({ ok: true, message: "¡Usuario registrado correctamente!" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, message: "Error interno del servidor" });
    }
});

// ─── LOGIN ────────────────────────────────────────────────────────────────────
app.post("/api/login", async (req, res) => {
    try {
        const { correo, password } = req.body;

        const result = await query(
            `SELECT id_usuario AS "IdUsuario", nombre AS "Nombre", correo AS "Correo",
                    password_hash AS "PasswordHash", foto_url AS "FotoUrl"
             FROM usuarios WHERE correo=$1 AND activo=TRUE`,
            [correo]
        );

        if (result.rows.length === 0)
            return res.status(401).json({ ok: false, message: "Correo o contraseña incorrectos" });

        const usuario = result.rows[0];
        const passwordCorrecta = await bcrypt.compare(password, usuario.PasswordHash);
        if (!passwordCorrecta)
            return res.status(401).json({ ok: false, message: "Correo o contraseña incorrectos" });

        const secret     = process.env.ADMIN_SECRET || "default-admin-secret-2026-torreslab";
        const token      = crypto.createHmac('sha256', secret).update(String(usuario.IdUsuario)).digest('hex');
        const adminToken = usuario.IdUsuario === 1
            ? crypto.createHmac('sha256', secret).update('1').digest('hex')
            : null;

        res.json({
            ok: true,
            message: "Login correcto",
            usuario: {
                idUsuario: usuario.IdUsuario,
                nombre:    usuario.Nombre,
                correo:    usuario.Correo,
                fotoUrl:   usuario.FotoUrl
            },
            token,
            adminToken
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, message: "Error interno" });
    }
});

// ─── SCHEMAS ZOD ──────────────────────────────────────────────────────────────
const perfilSchema = z.object({
    idUsuario:    z.number().int().positive(),
    nuevoNombre:  z.string().min(2).max(100).trim(),
    nuevaFotoUrl: z.string().trim().max(1000000).refine(val => {
        if (!val || val === "") return true;
        if (val.startsWith("http://") || val.startsWith("https://")) return true;
        if (val.startsWith("data:image/")) return true;
        if (val.startsWith("./") || val.startsWith("img/")) return true;
        return false;
    }, { message: "La foto debe ser una URL válida o imagen base64." }).optional().nullable()
});

const restablecerSchema = z.object({
    correo:             z.string().trim().email(),
    respuestaSeguridad: z.string().trim().min(2),
    nuevaPassword:      z.string().min(6)
});

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

// ─── ACTUALIZAR PERFIL ────────────────────────────────────────────────────────
app.post("/api/actualizar-perfil", validarTokenUsuario, async (req, res) => {
    try {
        const { idUsuario, nuevoNombre, nuevaFotoUrl } = perfilSchema.parse(req.body);

        const nombreExiste = await query(
            `SELECT id_usuario FROM usuarios WHERE nombre=$1 AND id_usuario<>$2`,
            [nuevoNombre, idUsuario]
        );
        if (nombreExiste.rows.length > 0)
            return res.status(409).json({ ok: false, message: "Ese nombre ya está en uso." });

        const reservados = ["admin","administrador","administrator","administracion","administración","moderador","moderator","root","superadmin","system","sistema"];
        const normalizar = t => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().replace(/\s+/g,"");
        if (reservados.map(normalizar).includes(normalizar(nuevoNombre)))
            return res.status(403).json({ ok: false, message: "⛔ Ese nombre está reservado." });

        await query(
            `UPDATE usuarios SET nombre=$1, foto_url=$2 WHERE id_usuario=$3`,
            [nuevoNombre, nuevaFotoUrl || null, idUsuario]
        );

        return res.json({ ok: true, message: "¡Perfil actualizado con éxito!" });

    } catch (error) {
        console.error(error);
        return res.status(400).json({ ok: false, message: "Datos no válidos." });
    }
});

// ─── RESTABLECER PASSWORD ─────────────────────────────────────────────────────
app.post("/api/restablecer-password", async (req, res) => {
    try {
        const { correo, respuestaSeguridad, nuevaPassword } = restablecerSchema.parse(req.body);

        const result = await query(
            `SELECT id_usuario AS "IdUsuario", respuesta_seguridad_hash AS "RespuestaSeguridadHash"
             FROM usuarios WHERE correo=$1 AND activo=TRUE`,
            [correo]
        );
        if (result.rows.length === 0)
            return res.status(404).json({ ok: false, message: "No se encontró ninguna cuenta con ese correo." });

        const usuario = result.rows[0];
        const respuestaCorrecta = await bcrypt.compare(respuestaSeguridad.toLowerCase(), usuario.RespuestaSeguridadHash);
        if (!respuestaCorrecta)
            return res.status(401).json({ ok: false, message: "⛔ Respuesta de seguridad incorrecta." });

        const nuevaPasswordHash = await bcrypt.hash(nuevaPassword, 10);
        await query(
            `UPDATE usuarios SET password_hash=$1 WHERE id_usuario=$2`,
            [nuevaPasswordHash, usuario.IdUsuario]
        );

        return res.json({ ok: true, message: "¡Contraseña actualizada con éxito!" });

    } catch (error) {
        console.error(error);
        return res.status(400).json({ ok: false, message: "Error en el servidor." });
    }
});

// ─── RUTAS EXTERNAS ───────────────────────────────────────────────────────────
app.use('/api', require('./quiniela.routes'));
// require('./sync-resultados'); // ← descomentar el 11 de Junio

app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
    console.log(`Servidor corriendo en http://0.0.0.0:${process.env.PORT || 3000}`);
});
