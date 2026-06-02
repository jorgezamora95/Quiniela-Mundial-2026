fetch("sidebar.html")
.then(response => response.text())
.then(data => {
    document.getElementById("sidebar-container").innerHTML = data;

    inicializarSidebarGlobal();
});

function inicializarSidebarGlobal() {
    const idUsuario = Number(localStorage.getItem("idUsuario"));
    const nombreGuardado = localStorage.getItem("Nombre");
    const fotoGuardada = localStorage.getItem("FotoUrl"); // ← FALTA ESTA LÍNEA

    const txtNombreSidebar = document.getElementById("txtNombreUsuarioSidebar");

    if (txtNombreSidebar) {
        txtNombreSidebar.textContent =
            nombreGuardado && nombreGuardado !== "undefined"
                ? nombreGuardado
                : "Participante";
    }

    const imgSidebar = document.getElementById("imgAvatarSidebar"); // ajusta el ID al tuyo
    if (imgSidebar) {
        imgSidebar.src = fotoGuardada && fotoGuardada !== "" 
            ? fotoGuardada 
            : "./img/user-icon.png";
        imgSidebar.onerror = () => { imgSidebar.src = "./img/user-icon.png"; };
    }

    const menuPrincipal = document.getElementById("menuPrincipal");

    if (menuPrincipal && idUsuario === 1) {
        const yaExiste = document.querySelector(".menu-item-admin");

        if (!yaExiste) {
            const liAdmin = document.createElement("li");
            liAdmin.className = "menu-item menu-item-static menu-item-admin";

            liAdmin.innerHTML = `
                <a href="admin.html" class="menu-link">
                    <i class="fa-solid fa-user-gear"></i>
                    <span>Admin</span>
                </a>
            `;

            menuPrincipal.appendChild(liAdmin);
        }
    }

    const btnLogout = document.getElementById("btnCerrarSesion");

    if (btnLogout) {
        btnLogout.addEventListener("click", function(e) {
            e.preventDefault();
            localStorage.clear();
            window.location.href = "login.html";
        });
    }
}