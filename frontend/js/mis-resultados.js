let historialCompletoGlobal = [];

document.addEventListener("DOMContentLoaded", () => {
    cargarMecanicaResultados();
});

async function cargarMecanicaResultados() {
    const idUsuario = localStorage.getItem("idUsuario");
    const selectFiltro = document.getElementById("selectFiltroEstado");

    if (!idUsuario) { window.location.href = "login.html"; return; }

    try {
        const responsePartidos = await fetch("./data/partidos.json");
        const partidosJSON = await responsePartidos.json();

        const responseDB = await fetch(`${API_URL}/api/mis-resultados/${idUsuario}`);
        const data = await responseDB.json();

        if (!data.ok) return;

        document.getElementById("cardPuntosTotales").textContent = `${data.puntosTotales} pts`;
        document.getElementById("statPosicion").textContent = data.posicion;
        document.getElementById("statAciertos").textContent = data.aciertos;
        document.getElementById("statJugados").textContent = data.partidosJugados;

        document.getElementById("resExactos").textContent = data.resumen.marcadoresExactos;
        document.getElementById("resCorrectos").textContent = data.resumen.ganadoresCorrectos;
        document.getElementById("resFallados").textContent = data.resumen.fallados;
        document.getElementById("txtEfectividad").textContent = data.efectividad;
        document.getElementById("barEfectividad").style.width = data.efectividad;

        historialCompletoGlobal = data.historial.map(item => {
            const infoPartidoEstatico = partidosJSON.find(p => p.id === item.partidoId);
            return {
                ...item,
                local: infoPartidoEstatico ? infoPartidoEstatico.local : "Desconocido",
                codLocal: infoPartidoEstatico ? infoPartidoEstatico.codLocal : "",
                visitante: infoPartidoEstatico ? infoPartidoEstatico.visitante : "Desconocido",
                codVisitante: infoPartidoEstatico ? infoPartidoEstatico.codVisitante : ""
            };
        });

        renderizarHistorialRows(historialCompletoGlobal);

        if (selectFiltro) {
            selectFiltro.addEventListener("change", (e) => {
                const estadoElegido = e.target.value;
                if (estadoElegido === "TODOS") {
                    renderizarHistorialRows(historialCompletoGlobal);
                } else {
                    const filtrados = historialCompletoGlobal.filter(p => p.estado === estadoElegido);
                    renderizarHistorialRows(filtrados);
                }
            });
        }

    } catch (error) {
        console.error("Error al inicializar la pantalla de resultados:", error);
    }
}

function renderizarHistorialRows(partidosALostrar) {
    const container = document.getElementById("historialPartidosRows");
    if (!container) return;
    container.textContent = "";

    partidosALostrar.forEach(item => {
        const row = document.createElement("div");
        row.className = "resultados-row-item";

        const matchDiv = document.createElement("div");
        matchDiv.className = "match-resultados";

        const localSpan = document.createElement("span");
        localSpan.className = "team-name";
        localSpan.textContent = `${obtenerEmojiBandera(item.codLocal)} ${item.local}`;

        const vsSmall = document.createElement("small");
        vsSmall.textContent = "vs";
        vsSmall.style.color = "#b8c2d6";

        const visitanteSpan = document.createElement("span");
        visitanteSpan.className = "team-name";
        visitanteSpan.textContent = `${item.visitante} ${obtenerEmojiBandera(item.codVisitante)}`;

        matchDiv.append(localSpan, vsSmall, visitanteSpan);

        const spanPro = document.createElement("span");
        spanPro.className = "font-bold text-center";
        spanPro.textContent = item.pronostico;

        const spanReal = document.createElement("span");
        spanReal.className = "font-bold text-center";
        spanReal.textContent = item.resultadoReal;
        if (item.estado === "Pendiente") spanReal.style.color = "#b8c2d6";

        const spanPts = document.createElement("span");
        spanPts.className = "font-bold text-center";
        spanPts.textContent = item.estado === "Pendiente" ? "-" : `${item.puntos} pts`;
        if (item.puntos > 0) spanPts.className += " text-green";

        const badgeEstado = document.createElement("div");
        badgeEstado.className = `badge-estado estado-${item.estado.toLowerCase()}`;
        badgeEstado.textContent = item.estado;

        row.append(matchDiv, spanPro, spanReal, spanPts, badgeEstado);
        container.appendChild(row);
    });
}

// ✅ FIX: Algoritmo de banderas actualizado (consistente con app.js)
function obtenerEmojiBandera(codigoPais) {
    if (!codigoPais) return "";
    const codigo = codigoPais.toUpperCase().trim();
    if (codigo === "GB-ENG") return "🏴󠁧󠁢󠁥󠁮󠁧󠁿";
    if (codigo === "GB-SCT") return "🏴󠁧󠁢󠁳󠁣󠁴󠁿";
    if (codigo === "GB-WLS") return "🏴󠁧󠁢󠁷󠁬󠁳󠁿";
    if (codigo.length !== 2) return "";
    const [a, b] = codigo.split("");
    return String.fromCodePoint(
        0x1F1E6 + a.charCodeAt(0) - 65,
        0x1F1E6 + b.charCodeAt(0) - 65
    );
}
