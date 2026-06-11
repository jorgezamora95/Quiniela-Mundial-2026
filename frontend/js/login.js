const btnEntrar = document.querySelector(".btn-entrar");

btnEntrar.addEventListener("click", async function () {
    const correo = document.querySelector("#correo").value.trim();
    const password = document.querySelector("#password").value;
    const mensaje = document.querySelector("#mensajeLogin");

    if (!correo || !password) {
        mensaje.textContent = "Por favor, ingresa tu correo y contraseña.";
        mensaje.className = "mensaje error";
        return;
    }

    try {
        btnEntrar.disabled = true;
        btnEntrar.value = "Conectando...";
        mensaje.textContent = "Iniciando sesión...";
        mensaje.className = "mensaje";
        mensaje.style.color = "#f1c40f";

        const response = await fetch(`${API_URL}/api/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                correo,
                password
            })
        });

        let data;
        try {
            data = await response.json();
        } catch (jsonErr) {
            throw new Error(`Servidor respondió con código ${response.status}`);
        }

        if (response.ok && data.ok) {
            mensaje.textContent = "Inicio de sesión correcto";
            mensaje.className = "mensaje success";
            mensaje.style.color = "";

            localStorage.setItem("idUsuario", data.usuario.idUsuario);
            localStorage.setItem("usuarioActivo", JSON.stringify(data.usuario));
            localStorage.setItem("Nombre", data.usuario.nombre);
            localStorage.setItem("FotoUrl", data.usuario.fotoUrl || "");
        
            if (data.token) {
                localStorage.setItem("token", data.token);
            }
            if (data.adminToken) {
                localStorage.setItem("adminToken", data.adminToken);
            }

            setTimeout(() => {
                window.location.href = "dashboard.html";
            }, 700);
        } else {
            mensaje.textContent = data.message || "Correo o contraseña incorrectos";
            mensaje.className = "mensaje error";
            mensaje.style.color = "";
            localStorage.clear();
            btnEntrar.disabled = false;
            btnEntrar.value = "Entrar";
        }
    } catch (error) {
        console.error("Error al iniciar sesión:", error);
        mensaje.textContent = `Error: ${error.message || error}`;
        mensaje.className = "mensaje error";
        mensaje.style.color = "";
        btnEntrar.disabled = false;
        btnEntrar.value = "Entrar";
    }
});