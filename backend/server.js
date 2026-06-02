const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const { z } = require('zod');
const { sql, poolPromise } = require("./db");

const app = express();

// ✅ FIX: CORS restringido a tu servidor frontend
// Cambia la IP por la de tu servidor Linux cuando lo publiques
const allowedOrigins = [

    "http://127.0.0.1:5500",        // desarrollo local
    "http://localhost:5500",         // desarrollo local
    "http://IP-DEL-SERVIDOR:8080",  // producción Linux con serve/PM2
    `http://${process.env.FRONTEND_HOST || "localhost"}:8080`
];

app.use(cors({
    origin: function (origin, callback) {
        // Permite peticiones sin origin (ej. Postman, apps móviles) y orígenes en la lista
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("No permitido por CORS"));
        }
    }
}));

// Protección DoS: Limitamos el JSON entrante a un máximo estricto de 100kb
app.use(express.json({ limit: '100kb' }));

// --- RUTAS DE AUTENTICACIÓN ---

app.post("/api/registro", async (req, res) => {
    try {
        const { nombre, correo, password, preguntaSeguridad, respuestaSeguridad } = req.body;

        if (!nombre || !correo || !password || !preguntaSeguridad || !respuestaSeguridad) {
            return res.status(400).json({
                ok: false,
                message: "Todos los campos de registro y seguridad son obligatorios."
            });
        }

        const pool = await poolPromise;

        const existe = await pool.request()
            .input("Correo", sql.NVarChar(150), correo)
            .query(`SELECT IdUsuario FROM dbo.Usuarios WHERE Correo = @Correo`);

        if (existe.recordset.length > 0) {
            return res.status(409).json({ ok: false, message: "Ese correo ya está registrado" });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const respuestaHash = await bcrypt.hash(respuestaSeguridad.toLowerCase(), 10);

        await pool.request()
            .input("Nombre", sql.NVarChar(100), nombre)
            .input("Correo", sql.NVarChar(150), correo)
            .input("PasswordHash", sql.NVarChar(255), passwordHash)
            .input("PreguntaSeguridad", sql.NVarChar(255), preguntaSeguridad)
            .input("RespuestaSeguridadHash", sql.NVarChar(255), respuestaHash)
            .query(`
                INSERT INTO dbo.Usuarios (Nombre, Correo, PasswordHash, PreguntaSeguridad, RespuestaSeguridadHash)
                VALUES (@Nombre, @Correo, @PasswordHash, @PreguntaSeguridad, @RespuestaSeguridadHash)
            `);

        res.json({ ok: true, message: "Usuario registrado correctamente" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, message: "Error interno del servidor" });
    }
});

app.post("/api/login", async (req, res) => {
    try {
        const { correo, password } = req.body;
        const pool = await poolPromise;

        const result = await pool.request()
            .input("Correo", sql.NVarChar(150), correo)
            .query(`
                SELECT IdUsuario, Nombre, Correo, PasswordHash, FotoUrl
                FROM dbo.Usuarios
                WHERE Correo = @Correo AND Activo = 1
            `);

        if (result.recordset.length === 0) {
            return res.status(401).json({ ok: false, message: "Correo o contraseña incorrectos" });
        }

        const usuario = result.recordset[0];

        const passwordCorrecta = await bcrypt.compare(password, usuario.PasswordHash);
        if (!passwordCorrecta) {
            return res.status(401).json({ ok: false, message: "Correo o contraseña incorrectos" });
        }

        res.json({
            ok: true,
            message: "Login correcto",
            usuario: {
                idUsuario: usuario.IdUsuario,
                nombre: usuario.Nombre,
                correo: usuario.Correo,
                fotoUrl: usuario.FotoUrl  // ✅ Consistente con el SELECT
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, message: "Error interno" });
    }
});

// --- SCHEMAS ZOD ---
const perfilSchema = z.object({
    idUsuario: z.number().int().positive(),
    nuevoNombre: z.string().min(2).max(100).trim(),
    nuevaFotoUrl: z.string().trim().url().optional().or(z.literal(""))
});

const restablecerSchema = z.object({
    correo: z.string().trim().email(),
    respuestaSeguridad: z.string().trim().min(2),
    nuevaPassword: z.string().min(6)
});

// --- ACTUALIZAR PERFIL ---
app.post("/api/actualizar-perfil", async (req, res) => {
    try {
        const { idUsuario, nuevoNombre, nuevaFotoUrl } = perfilSchema.parse(req.body);
        const pool = await poolPromise;

        const nombreExiste = await pool.request()
            .input("Nombre", sql.NVarChar(100), nuevoNombre)
            .input("IdUsuario", sql.Int, idUsuario)
            .query(`SELECT IdUsuario FROM dbo.Usuarios WHERE Nombre = @Nombre AND IdUsuario <> @IdUsuario`);

        if (nombreExiste.recordset.length > 0) {
            return res.status(409).json({ ok: false, message: "Ese nombre de usuario ya está en uso por otra persona." });
        }

        const nombresReservados = ["admin","administrador","administrator","administracion","administración","moderador","moderator","root","superadmin","system","sistema"];

        const normalizarTexto = texto =>
            texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, "");

        if (nombresReservados.map(normalizarTexto).includes(normalizarTexto(nuevoNombre))) {
            return res.status(403).json({ ok: false, message: "⛔ Ese nombre está reservado para administración." });
        }

        await pool.request()
            .input("IdUsuario", sql.Int, idUsuario)
            .input("Nombre", sql.NVarChar(100), nuevoNombre)
            .input("FotoURL", sql.NVarChar(500), nuevaFotoUrl || null)
            .query(`UPDATE dbo.Usuarios SET Nombre = @Nombre, FotoURL = @FotoURL WHERE IdUsuario = @IdUsuario`);

        return res.json({ ok: true, message: "¡Perfil actualizado con éxito en SQL Server!" });

    } catch (error) {
        console.error("Error en actualización de perfil:", error);
        return res.status(400).json({ ok: false, message: "Datos no válidos. Asegúrate de poner un nombre real o una URL de imagen válida." });
    }
});

// --- RESTABLECER PASSWORD ---
app.post("/api/restablecer-password", async (req, res) => {
    try {
        const { correo, respuestaSeguridad, nuevaPassword } = restablecerSchema.parse(req.body);
        const pool = await poolPromise;

        const result = await pool.request()
            .input("Correo", sql.NVarChar(150), correo)
            .query("SELECT IdUsuario, RespuestaSeguridadHash FROM dbo.Usuarios WHERE Correo = @Correo AND Activo = 1");

        if (result.recordset.length === 0) {
            return res.status(404).json({ ok: false, message: "No se encontró ninguna cuenta con ese correo." });
        }

        const usuario = result.recordset[0];

        const respuestaCorrecta = await bcrypt.compare(respuestaSeguridad.toLowerCase(), usuario.RespuestaSeguridadHash);

        if (!respuestaCorrecta) {
            return res.status(401).json({ ok: false, message: "⛔ Respuesta de seguridad incorrecta. Acceso denegado." });
        }

        const nuevaPasswordHash = await bcrypt.hash(nuevaPassword, 10);

        await pool.request()
            .input("IdUsuario", sql.Int, usuario.IdUsuario)
            .input("PasswordHash", sql.NVarChar(255), nuevaPasswordHash)
            .query("UPDATE dbo.Usuarios SET PasswordHash = @PasswordHash WHERE IdUsuario = @IdUsuario");

        return res.json({ ok: true, message: "¡Contraseña actualizada con éxito!" });

    } catch (error) {
        console.error(error);
        return res.status(400).json({ ok: false, message: "Datos no válidos o error en el servidor." });
    }
});

// --- RUTAS EXTERNAS ---
app.use('/api', require('./quiniela.routes'));

// --- ARRANQUE ---
app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
    console.log(`Servidor corriendo en http://0.0.0.0:${process.env.PORT || 3000}`);
});
