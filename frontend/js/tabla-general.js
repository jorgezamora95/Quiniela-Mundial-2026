let rankingDataGlobal = [];

document.addEventListener("DOMContentLoaded", () => {
    cargarTablaPosiciones();
    configurarBuscador();
});

async function cargarTablaPosiciones() {
    try {
        const response = await fetch(`${API_URL}/api/tabla-general`);
        const data = await response.json();

        if (!data.ok) return;
        rankingDataGlobal = data.ranking;

        const totalBadge = document.getElementById("totalParticipantes");
        if (totalBadge) totalBadge.textContent = rankingDataGlobal.length;

        inyectarDatoPodio("podio1", rankingDataGlobal[0]);
        inyectarDatoPodio("podio2", rankingDataGlobal[1]);
        inyectarDatoPodio("podio3", rankingDataGlobal[2]);

        renderizarListaRanking(rankingDataGlobal);

        // ✅ FIX: Buscar por ID numérico en lugar de nombre (más confiable)
        const miId = parseInt(localStorage.getItem("idUsuario"));
        const miIndex = rankingDataGlobal.findIndex(u => parseInt(u.IdUsuario) === miId);

        const txtPosicion = document.getElementById("resumenPosicion");
        if (txtPosicion) {
            txtPosicion.textContent = miIndex !== -1 ? `#${rankingDataGlobal[miIndex].PosicionReal}` : "#1";
        }

        if (miIndex !== -1) {
            const misDatos = rankingDataGlobal[miIndex];
            const elMiPosicion = document.getElementById("miPosicion");
            const elMisPuntos = document.getElementById("misPuntos");
            const elMisAciertos = document.getElementById("misAciertos");
            if (elMiPosicion) elMiPosicion.textContent = `${misDatos.PosicionReal}° lugar`;
            if (elMisPuntos) elMisPuntos.textContent = `${misDatos.Puntos} pts`;
            if (elMisAciertos) elMisAciertos.textContent = misDatos.Aciertos;
        }

    } catch (error) {
        console.error("Error al cargar la tabla general:", error);
    }
}

function inyectarDatoPodio(idContenedor, usuario) {
    const contenedor = document.getElementById(idContenedor);
    if (!contenedor) return;

    if (usuario) {
        contenedor.querySelector(".podium-name").textContent = usuario.Nombre;
        contenedor.querySelector(".podium-pts").textContent = `${usuario.Puntos} pts`;
    } else {
        contenedor.style.display = "none";
    }
}

function renderizarListaRanking(listaUsuarios) {
    const container = document.getElementById("tablaGeneralRows");
    if (!container) return;
    container.textContent = "";

    // ✅ FIX: Comparación por ID numérico
    const miId = parseInt(localStorage.getItem("idUsuario"));

    listaUsuarios.forEach((usuario) => {
        const posicionReal = usuario.PosicionReal;

        const row = document.createElement("div");
        row.className = "tabla-row-item";

        if (parseInt(usuario.IdUsuario) === miId) {
            row.className = "tabla-row-item active-user";
        }

        const badgePos = document.createElement("span");
        badgePos.className = `num-badge pos-${posicionReal}`;
        badgePos.textContent = posicionReal;

        const userDiv = document.createElement("div");
        userDiv.className = "user-column";

        // ✅ Después — foto real con fallback al ícono
        const avatar = document.createElement("img");
        avatar.className = "avatar-tabla";
        avatar.src = usuario.FotoUrl && usuario.FotoUrl !== ""
            ? usuario.FotoUrl
            : "./img/user-icon.png";
        avatar.alt = usuario.Nombre;
        avatar.onerror = () => { avatar.src = "./img/user-icon.png"; };

        const txtNombre = document.createElement("strong");
        txtNombre.textContent = usuario.Nombre;
        userDiv.append(avatar, txtNombre);

        const spanPred = document.createElement("span");
        spanPred.textContent = usuario.Predicciones;

        const spanAcier = document.createElement("span");
        spanAcier.textContent = usuario.Aciertos;

        const spanPts = document.createElement("span");
        spanPts.className = "text-green font-bold";
        spanPts.textContent = `${usuario.Puntos} pts`;

        row.append(badgePos, userDiv, spanPred, spanAcier, spanPts);
        container.appendChild(row);
    });
}

function configurarBuscador() {
    const inputBuscar = document.getElementById("buscarParticipante");
    if (!inputBuscar) return;

    inputBuscar.addEventListener("input", (e) => {
        const busqueda = e.target.value.toLowerCase().trim();
        const filtrados = rankingDataGlobal.filter(u => u.Nombre.toLowerCase().includes(busqueda));
        renderizarListaRanking(filtrados);
    });
}

function inyectarDatoPodio(idContenedor, usuario) {
    const contenedor = document.getElementById(idContenedor);
    if (!contenedor) return;

    if (usuario) {
        contenedor.querySelector(".podium-name").textContent = usuario.Nombre;
        contenedor.querySelector(".podium-pts").textContent = `${usuario.Puntos} pts`;

        // ✅ NUEVO: Foto en el podio
        const avatarCircle = contenedor.querySelector(".avatar-circle");
        if (avatarCircle) {
            avatarCircle.innerHTML = ""; // Limpiamos el ícono genérico
            const img = document.createElement("img");
            img.className = "avatar-podio";
            img.src = usuario.FotoUrl && usuario.FotoUrl !== ""
                ? usuario.FotoUrl
                : "./img/user-icon.png";
            img.alt = usuario.Nombre;
            img.onerror = () => { img.src = "./img/user-icon.png"; };
            avatarCircle.appendChild(img);
        }
    } else {
        contenedor.style.display = "none";
    }
}