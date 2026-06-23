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

// ─── PRESENCIA DE USUARIOS CONECTADOS (HEARTBEAT) ─────────────────────────────
(function iniciarPresenciaConectados() {
    const idUsuario = Number(localStorage.getItem("idUsuario"));
    if (!idUsuario) return;

    async function reportarHeartbeat() {
        try {
            const res = await fetch(`${API_URL}/api/heartbeat`, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ idUsuario })
            });
            const data = await res.json();
            if (data.ok && data.activeUsers) {
                renderizarUsuariosConectados(data.activeUsers);
            }
        } catch (e) {
            console.error("Error al reportar presencia:", e);
        }
    }

    function renderizarUsuariosConectados(usuarios) {
        const container = document.getElementById("listaConectados");
        if (!container) return; // Si la página actual no tiene la lista de conectados, no hacemos nada

        container.innerHTML = "";
        if (usuarios.length === 0) {
            container.innerHTML = `<p style="color:#b8c2d6; font-size:0.85rem; margin:0;">No hay usuarios conectados.</p>`;
            return;
        }

        usuarios.forEach(user => {
            const userDiv = document.createElement("div");
            userDiv.className = "connected-user";
            userDiv.style.cssText = "display:flex; flex-direction:column; align-items:center; width:65px; text-align:center; position:relative; cursor:pointer;";
            userDiv.title = user.nombre;

            // Limitar longitud del nombre
            const primerNombre = user.nombre.split(" ")[0] || "";
            const nombreMostrar = primerNombre.length > 8 ? primerNombre.substring(0, 7) + ".." : primerNombre;

            userDiv.innerHTML = `
                <div style="position:relative; width:45px; height:45px;">
                    <img src="${user.fotoUrl && user.fotoUrl.trim() !== "" ? user.fotoUrl : './img/user-icon.png'}" 
                         alt="${user.nombre}" 
                         style="width:45px; height:45px; border-radius:50%; border:3px solid #2ecc71; object-fit:cover; background:#0d1f33;" 
                         onerror="this.src='./img/user-icon.png';" />
                    <span style="position:absolute; bottom:0; right:0; width:12px; height:12px; background:#2ecc71; border:2px solid #05101a; border-radius:50%;"></span>
                </div>
                <span style="font-size:0.7rem; color:#b8c2d6; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; width:100%; font-weight:500;">
                    ${nombreMostrar}
                </span>
            `;
            container.appendChild(userDiv);
        });
    }

    // Reportar inmediatamente al cargar la página
    reportarHeartbeat();

    // Reportar cada 30 segundos
    setInterval(reportarHeartbeat, 30000);
})();