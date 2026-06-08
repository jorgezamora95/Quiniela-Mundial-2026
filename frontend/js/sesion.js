const usuarioActivo = JSON.parse(localStorage.getItem("usuarioActivo"));
const token = localStorage.getItem("token");

if (!usuarioActivo || !token) {
    localStorage.clear();
    window.location.href = "login.html";
} else {
    document.querySelectorAll("#Nombre, #nombreUsuario").forEach(elemento => {
        elemento.textContent = usuarioActivo.nombre;
    });
}

