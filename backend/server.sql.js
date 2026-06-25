const express = require("express");
const cors    = require("cors");
const bcrypt  = require("bcrypt");
const crypto  = require("crypto");
const { z }   = require('zod');
const { sql, poolPromise } = require("./db.sql");

const app = express();

const allowedOrigins = [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://localhost",
    "http://localhost:80",
    "http://10.200.20.102:8080",
    "http://10.200.20.102",
    "http://10.200.20.102:3000",
    process.env.FRONTEND_URL,
    `http://${process.env.FRONTEND_HOST || "localhost"}:8080`
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) callback(null, true);
        else callback(new Error("No permitido por CORS"));
    }
}));

app.use(express.json({ limit: '100kb' }));

// ─── REGISTRO ────────────────────────────────────────────────────────────────
app.post("/api/registro", async (req, res) => {
    try {
        const { nombre, correo, password, preguntaSeguridad, respuestaSeguridad, codigoInvitacion } = req.body;

        if (!nombre || !correo || !password || !preguntaSeguridad || !respuestaSeguridad || !codigoInvitacion)
            return res.status(400).json({ ok: false, message: "Todos los campos son obligatorios." });

        const pool = await poolPromise;

        // Validar código de invitación
        const codResult = await pool.request()
            .input("Codigo", sql.NVarChar(100), codigoInvitacion.trim())
            .query(`SELECT IdCodigo, Utilizado FROM dbo.CodigosInvitacion WHERE LOWER(Codigo)=LOWER(@Codigo)`);

        if (codResult.recordset.length === 0)
            return res.status(403).json({ ok: false, message: "⛔ Código de invitación inválido." });
        if (codResult.recordset[0].Utilizado)
            return res.status(403).json({ ok: false, message: "⛔ Ese código ya fue utilizado." });

        const idCodigo = codResult.recordset[0].IdCodigo;

        // Verificar correo duplicado
        const existe = await pool.request()
            .input("Correo", sql.NVarChar(150), correo)
            .query(`SELECT IdUsuario FROM dbo.Usuarios WHERE Correo=@Correo`);
        if (existe.recordset.length > 0)
            return res.status(409).json({ ok: false, message: "Ese correo ya está registrado." });

        const passwordHash  = await bcrypt.hash(password, 10);
        const respuestaHash = await bcrypt.hash(respuestaSeguridad.toLowerCase(), 10);

        const insertResult = await pool.request()
            .input("Nombre",                 sql.NVarChar(100), nombre)
            .input("Correo",                 sql.NVarChar(150), correo)
            .input("PasswordHash",           sql.NVarChar(255), passwordHash)
            .input("PreguntaSeguridad",      sql.NVarChar(255), preguntaSeguridad)
            .input("RespuestaSeguridadHash", sql.NVarChar(255), respuestaHash)
            .query(`
                INSERT INTO dbo.Usuarios (Nombre,Correo,PasswordHash,PreguntaSeguridad,RespuestaSeguridadHash)
                OUTPUT INSERTED.IdUsuario
                VALUES (@Nombre,@Correo,@PasswordHash,@PreguntaSeguridad,@RespuestaSeguridadHash)
            `);

        const nuevoIdUsuario = insertResult.recordset[0].IdUsuario;

        await pool.request()
            .input("IdCodigo",  sql.Int, idCodigo)
            .input("IdUsuario", sql.Int, nuevoIdUsuario)
            .query(`UPDATE dbo.CodigosInvitacion SET Utilizado=1, FechaUso=GETDATE(), IdUsuario=@IdUsuario WHERE IdCodigo=@IdCodigo`);

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
        const pool = await poolPromise;

        const result = await pool.request()
            .input("Correo", sql.NVarChar(150), correo)
            .query(`SELECT IdUsuario, Nombre, Correo, PasswordHash, FotoUrl FROM dbo.Usuarios WHERE Correo=@Correo AND Activo=1`);

        if (result.recordset.length === 0)
            return res.status(401).json({ ok: false, message: "Correo o contraseña incorrectos" });

        const usuario = result.recordset[0];
        const passwordCorrecta = await bcrypt.compare(password, usuario.PasswordHash);
        if (!passwordCorrecta)
            return res.status(401).json({ ok: false, message: "Correo o contraseña incorrectos" });

        const crypto = require('crypto');
        const secret = process.env.ADMIN_SECRET || "default-admin-secret-2026-torreslab";
        const token  = crypto.createHmac('sha256', secret).update(String(usuario.IdUsuario)).digest('hex');

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
        const pool = await poolPromise;

        const nombreExiste = await pool.request()
            .input("Nombre",    sql.NVarChar(100), nuevoNombre)
            .input("IdUsuario", sql.Int,           idUsuario)
            .query(`SELECT IdUsuario FROM dbo.Usuarios WHERE Nombre=@Nombre AND IdUsuario<>@IdUsuario`);
        if (nombreExiste.recordset.length > 0)
            return res.status(409).json({ ok: false, message: "Ese nombre ya está en uso." });

        const reservados = ["admin","administrador","administrator","administracion","administración","moderador","moderator","root","superadmin","system","sistema"];
        const normalizar = t => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().replace(/\s+/g,"");
        if (reservados.map(normalizar).includes(normalizar(nuevoNombre)))
            return res.status(403).json({ ok: false, message: "⛔ Ese nombre está reservado." });

        await pool.request()
            .input("IdUsuario", sql.Int,           idUsuario)
            .input("Nombre",    sql.NVarChar(100), nuevoNombre)
            .input("FotoUrl",   sql.NVarChar(500), nuevaFotoUrl || null)
            .query(`UPDATE dbo.Usuarios SET Nombre=@Nombre, FotoUrl=@FotoUrl WHERE IdUsuario=@IdUsuario`);

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
        const pool = await poolPromise;

        const result = await pool.request()
            .input("Correo", sql.NVarChar(150), correo)
            .query(`SELECT IdUsuario, RespuestaSeguridadHash FROM dbo.Usuarios WHERE Correo=@Correo AND Activo=1`);
        if (result.recordset.length === 0)
            return res.status(404).json({ ok: false, message: "No se encontró ninguna cuenta con ese correo." });

        const usuario = result.recordset[0];
        const respuestaCorrecta = await bcrypt.compare(respuestaSeguridad.toLowerCase(), usuario.RespuestaSeguridadHash);
        if (!respuestaCorrecta)
            return res.status(401).json({ ok: false, message: "⛔ Respuesta de seguridad incorrecta." });

        const nuevaPasswordHash = await bcrypt.hash(nuevaPassword, 10);
        await pool.request()
            .input("IdUsuario",    sql.Int,          usuario.IdUsuario)
            .input("PasswordHash", sql.NVarChar(255), nuevaPasswordHash)
            .query(`UPDATE dbo.Usuarios SET PasswordHash=@PasswordHash WHERE IdUsuario=@IdUsuario`);

        return res.json({ ok: true, message: "¡Contraseña actualizada con éxito!" });

    } catch (error) {
        console.error(error);
        return res.status(400).json({ ok: false, message: "Error en el servidor." });
    }
});

// ─── RUTAS EXTERNAS ───────────────────────────────────────────────────────────
app.use('/api', require('./quiniela.routes.sql'));
require('./sync-resultados'); // ← descomentar el 11 de Junio

app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
    console.log(`Servidor corriendo en http://0.0.0.0:${process.env.PORT || 3000}`);
});