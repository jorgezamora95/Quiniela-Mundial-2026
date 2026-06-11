// Helper fetch wrapper to attach x-user-token header
async function authFetch(url, options = {}) {
    const token = localStorage.getItem("token");
    if (!options.headers) {
        options.headers = {};
    }
    if (token) {
        options.headers["x-user-token"] = token;
    }
    return fetch(url, options);
}

document.addEventListener("DOMContentLoaded", () => {
    cargarDatosActuales();
    configurarFormularioPerfil();
    configurarPreviewFoto();
});

const NOMBRES_RESERVADOS = [
    "admin", "administrador", "administrator", "administracion", 
    "administración", "moderador", "moderator", "root", 
    "superadmin", "system", "sistema", "jorge" // Bloqueamos también Jorge por seguridad
];

function normalizarTexto(texto) {
    return texto
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

function esNombreReservado(nombre) {
    const normalizado = normalizarTexto(nombre).replace(/\s+/g, "");

    return NOMBRES_RESERVADOS.some(reservado => {
        const reservadoNormalizado = normalizarTexto(reservado).replace(/\s+/g, "");
        return normalizado === reservadoNormalizado;
    });
}

function cargarDatosActuales() {
    // 🛡️ LA CORRECCIÓN: Leemos primero las cadenas de texto sin parsear para evitar que rompa el script
    const idUsuario = localStorage.getItem("idUsuario");
    const nombreActual = localStorage.getItem("Nombre");
    const fotoActual = localStorage.getItem("FotoUrl");

    // Si la sesión se cerró y no hay ID, expulsamos de inmediato de forma limpia
    if (!idUsuario) {
        window.location.href = "login.html";
        return;
    }

    const inputNombre = document.getElementById("inputNuevoNombre");
    const txtSaludo = document.getElementById("txtSaludioNombre");
    const imgPreview = document.getElementById("avatarPreview");
    const inputFoto = document.getElementById("inputNuevaFoto");

    if (inputNombre && nombreActual) inputNombre.value = nombreActual;
    if (txtSaludo && nombreActual) txtSaludo.textContent = nombreActual;

    if (fotoActual && imgPreview && inputFoto) {
        imgPreview.src = fotoActual;
        inputFoto.value = fotoActual;
    }

    if (imgPreview) {
        imgPreview.onerror = function () {
            this.src = "./img/user-icon.png";
        };
    }
}

function configurarPreviewFoto() {
    const inputFoto = document.getElementById("inputNuevaFoto");
    const imgPreview = document.getElementById("avatarPreview");

    if (!inputFoto || !imgPreview) return;

    inputFoto.addEventListener("input", () => {
        const url = inputFoto.value.trim();

        if (url === "") {
            imgPreview.src = "./img/user-icon.png";
            return;
        }

        imgPreview.src = url;
    });

    imgPreview.onerror = function () {
        this.src = "./img/user-icon.png";
    };
}

function configurarFormularioPerfil() {
    const btnGuardar = document.getElementById("btnGuardarPerfil");
    const mensaje = document.getElementById("mensajeOpciones");
    const imgPreview = document.getElementById("avatarPreview");
    const txtSaludo = document.getElementById("txtSaludioNombre");

    if (!btnGuardar) return;

    btnGuardar.addEventListener("click", async () => {
        const idUsuario = localStorage.getItem("idUsuario");

        if (!idUsuario) {
            window.location.href = "login.html";
            return;
        }

        const nuevoNombre = document.getElementById("inputNuevoNombre").value.trim();
        const nuevaFotoUrl = document.getElementById("inputNuevaFoto").value.trim();

        if (nuevoNombre.length < 2) {
            mostrarMensaje("⚠️ El nombre debe tener al menos 2 caracteres.", "error");
            return;
        }

        if (esNombreReservado(nuevoNombre)) {
            mostrarMensaje("⛔ Ese nombre está reservado para administración.", "error");
            return;
        }

        try {
            btnGuardar.disabled = true;
            btnGuardar.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Guardando...`;

            const response = await authFetch(`${API_URL}/api/actualizar-perfil`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    idUsuario: Number(idUsuario),
                    nuevoNombre,
                    nuevaFotoUrl
                })
            });

            const data = await response.json();

            if (!data.ok) {
                mostrarMensaje(data.message, "error");
                return;
            }

            // 💾 Sincronizamos las variables globales en el navegador de forma directa
            localStorage.setItem("Nombre", nuevoNombre);

            if (nuevaFotoUrl !== "") {
                localStorage.setItem("FotoUrl", nuevaFotoUrl);
                if (imgPreview) imgPreview.src = nuevaFotoUrl;
            } else {
                localStorage.removeItem("FotoUrl");
                if (imgPreview) imgPreview.src = "./img/user-icon.png";
            }

            if (txtSaludo) txtSaludo.textContent = nuevoNombre;

            // Buscamos dinámicamente tu h3 del sidebar para que se actualice el saludo al segundo
            const nombreSidebar = document.getElementById("txtNombreUsuarioSidebar") || document.querySelector(".user-data h3");
            if (nombreSidebar) {
                nombreSidebar.textContent = nuevoNombre;
            }

            const imgSidebar = document.getElementById("imgAvatarSidebar");
            if (imgSidebar) {
                imgSidebar.src = nuevaFotoUrl !== "" ? nuevaFotoUrl : "./img/user-icon.png";
            }

            mostrarMensaje("✅ Perfil actualizado correctamente.", "success");

        } catch (error) {
            console.error(error);
            mostrarMensaje("Error al intentar conectar con el servidor.", "error");
        } finally {
            btnGuardar.disabled = false;
            btnGuardar.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Guardar cambios`;
        }
    });

    function mostrarMensaje(texto, tipo) {
        if (mensaje) {
            mensaje.textContent = texto;
            mensaje.className = `mensaje ${tipo}`;
        }
    }
}
