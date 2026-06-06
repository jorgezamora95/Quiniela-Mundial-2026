document.addEventListener("DOMContentLoaded", () => {
    // Seleccionamos el botón usando su clase de estilo exacta (.btn-entrar)
    const btnRestablecer = document.querySelector(".btn-entrar");
    const mensaje = document.getElementById("mensajeForgot");

    if (!btnRestablecer) return;

    btnRestablecer.addEventListener("click", async () => {
        // Capturamos los valores usando los IDs reales de tus etiquetas input
        const correo = document.getElementById("correo").value.trim();
        const password = document.getElementById("password").value;
        const respuestaSeguridad = document.getElementById("forgotRespuesta").value.trim();

        // 1. Validar formato de correo electrónico
        const regexCorreo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!regexCorreo.test(correo)) {
            mostrarMensaje("Por favor, introduce un correo válido (ejemplo@dominio.com).", "error");
            return;
        }

        // 2. Validar que la respuesta secreta no vaya en blanco
        if (respuestaSeguridad === "") {
            mostrarMensaje("⚠️ Por favor, escribe tu respuesta de seguridad.", "error");
            return;
        }

        // 3. Validar longitud de la nueva contraseña
        if (password.length < 6) {
            mostrarMensaje("La nueva contraseña debe tener al menos 6 caracteres.", "error");
            return;
        }

        try {
            // Cambiamos el estado del botón de forma segura para evitar clics dobles
            btnRestablecer.disabled = true;
            btnRestablecer.value = "Procesando...";
            if (mensaje) mensaje.textContent = "";

            // 4. Petición HTTP POST hacia tu endpoint seguro de Express
            const response = await fetch(`${API_URL}/api/restablecer-password`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    correo, 
                    respuestaSeguridad, 
                    nuevaPassword: password 
                })
            });

            const data = await response.json();

            // Desplegamos la respuesta del servidor con tus clases estéticas
            if (data.ok) {
                mostrarMensaje(data.message, "success");
                
                // Redirección suave al login en 2 segundos si todo salió bien
                setTimeout(() => {
                    window.location.href = "login.html";
                }, 2000);
            } else {
                mostrarMensaje(data.message, "error");
            }

        } catch (error) {
            console.error("Error al restablecer clave:", error);
            mostrarMensaje("Error crítico de comunicación con el servidor.", "error");
        } finally {
            // Reestablecemos el botón al estado original pase lo que pase
            btnRestablecer.disabled = false;
            btnRestablecer.value = "Actualizar Contraseña";
        }
    });

    // Función auxiliar para inyectar textos y aplicar las clases CSS correspondientes
    function mostrarMensaje(texto, tipo) {
        if (mensaje) {
            mensaje.textContent = texto;
            // Se acopla a tus clases .mensaje, .success y .error de tu hoja de estilos
            mensaje.className = `mensaje ${tipo}`;
        }
    }
});
