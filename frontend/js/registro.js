const btnRegistro = document.querySelector(".btn-registro");

btnRegistro.addEventListener("click", async function () {
    const nombre             = document.querySelector("#usuario").value.trim();
    const correo             = document.querySelector("#correo").value.trim();
    const password           = document.querySelector("#password").value;
    const mensaje            = document.querySelector("#mensajeRegistro");
    const preguntaSeguridad  = document.querySelector("#regPregunta").value;
    const respuestaSeguridad = document.querySelector("#regRespuesta").value.trim();
    const codigoInvitacion   = document.querySelector("#codigoInvitacion")?.value.trim(); // ✅ NUEVO

    // Validaciones
    if (codigoInvitacion === "") {
        mensaje.textContent = "⚠️ Ingresa el código de invitación.";
        mensaje.className = "mensaje error";
        return;
    }

    if (respuestaSeguridad === "") {
        mensaje.textContent = "Por favor, escribe una respuesta a tu pregunta de seguridad.";
        mensaje.className = "mensaje error";
        return;
    }

    if (nombre === "") {
        mensaje.textContent = "Por favor, introduce tu nombre de usuario.";
        mensaje.className = "mensaje error";
        return;
    }

    const regexCorreo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!regexCorreo.test(correo)) {
        mensaje.textContent = "Por favor, introduce un correo válido (ejemplo@dominio.com).";
        mensaje.className = "mensaje error";
        return;
    }

    if (password.length < 6) {
        mensaje.textContent = "La contraseña debe tener al menos 6 caracteres.";
        mensaje.className = "mensaje error";
        return;
    }

    try {
        btnRegistro.disabled = true;

        const response = await fetch(`${API_URL}/api/registro`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                nombre,
                correo,
                password,
                preguntaSeguridad,
                respuestaSeguridad,
                codigoInvitacion   // ✅ NUEVO
            })
        });

        const data = await response.json();

        mensaje.textContent = data.message;
        mensaje.className = data.ok ? "mensaje success" : "mensaje error";

        if (data.ok) {
            setTimeout(() => {
                window.location.href = "login.html";
            }, 1200);
        }
    } catch (error) {
        mensaje.textContent = "Error de conexión con el servidor.";
        mensaje.className = "mensaje error";
    } finally {
        btnRegistro.disabled = false;
    }
});
