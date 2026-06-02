const btnEntrar = document.querySelector(".btn-entrar");

btnEntrar.addEventListener("click", async function () {
    const correo = document.querySelector("#correo").value;
    const password = document.querySelector("#password").value;

    const response = await fetch("http://localhost:3000/api/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            correo,
            password
        })
    });

    const mensaje = document.querySelector("#mensajeLogin");

    const data = await response.json();


    if (data.ok) {
        mensaje.textContent = "Inicio de sesión correcto";
        mensaje.className = "mensaje success";

        localStorage.setItem("idUsuario", data.usuario.idUsuario);
        localStorage.setItem("usuarioActivo", JSON.stringify(data.usuario));
        localStorage.setItem("Nombre", data.usuario.nombre); // Guarda el string, ej: "Jorge Zamora"
        localStorage.setItem("FotoUrl", data.usuario.fotoUrl || "");

        setTimeout(() => {
            window.location.href = "index.html";
        }, 700);
    } else {
        mensaje.textContent = data.message;
        mensaje.className = "mensaje error";
        localStorage.clear();
    }
});