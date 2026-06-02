const usuarioActivo = JSON.parse(localStorage.getItem("usuarioActivo"));
if (!usuarioActivo) {
    window.location.href = "login.html";
    return; // ← ESTO faltaba
}
document.querySelectorAll("#Nombre, #nombreUsuario").forEach(elemento => {
    elemento.textContent = usuarioActivo.nombre;
});

