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
        const yaExiste = document.querySelector(".sidebar-link-admin");

        if (!yaExiste) {
            const adminLink = document.createElement("a");
            adminLink.href      = "admin.html";
            adminLink.className = "sidebar-link sidebar-link-admin";
            adminLink.innerHTML = `
                <span class="sidebar-link__icon">
                    <i class="fa-solid fa-user-gear"></i>
                </span>
                <span class="sidebar-link__label">Admin</span>
            `;
            menuPrincipal.appendChild(adminLink);
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

        const btnHamburger = document.getElementById("btnHamburger");
    const sidebar      = document.getElementById("sidebar");
    const overlay      = document.getElementById("sidebarOverlay");

    if (btnHamburger && sidebar && overlay) {
        btnHamburger.addEventListener("click", () => {
            const abierto = sidebar.classList.contains("sidebar--open");
            if (abierto) {
                sidebar.classList.remove("sidebar--open");
                overlay.classList.remove("sidebar-overlay--visible");
                btnHamburger.innerHTML = '<i class="fa-solid fa-bars"></i>';
            } else {
                sidebar.classList.add("sidebar--open");
                overlay.classList.add("sidebar-overlay--visible");
                btnHamburger.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            }
        });

        overlay.addEventListener("click", () => {
            sidebar.classList.remove("sidebar--open");
            overlay.classList.remove("sidebar-overlay--visible");
            btnHamburger.innerHTML = '<i class="fa-solid fa-bars"></i>';
        });

        document.querySelectorAll(".sidebar-link").forEach(link => {
            link.addEventListener("click", () => {
                sidebar.classList.remove("sidebar--open");
                overlay.classList.remove("sidebar-overlay--visible");
                btnHamburger.innerHTML = '<i class="fa-solid fa-bars"></i>';
            });
        });
    }
    const paginaActual = window.location.pathname.split('/').pop() || 'dashboard.html';
    document.querySelectorAll('.sidebar-link').forEach(link => {
        const href = link.getAttribute('href');
        if (href && paginaActual.includes(href.replace('.html',''))) {
            link.classList.add('sidebar-link--active');
        }
    });

}


// ─── AUTO LOGOUT por inactividad (10 min) ────────────────────────────────────
(function iniciarTimerInactividad() {
    const MINUTOS = 10;
    const TIEMPO  = MINUTOS * 60 * 1000;
    let timer;

    function resetTimer() {
        clearTimeout(timer);
        timer = setTimeout(() => {
            alert("⏱️ Sesión cerrada por inactividad.");
            localStorage.clear();
            window.location.href = "login.html";
        }, TIEMPO);
    }

    // Resetear el timer con cualquier interacción del usuario
    ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach(evento => {
        document.addEventListener(evento, resetTimer, { passive: true });
    });

    // Arrancar el timer al cargar
    resetTimer();
})();