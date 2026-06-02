// Variable global para controlar la persistencia de datos en memoria
let partidosAdminGlobal = [];
let resultadosGuardadosBD = [];

// --- BLINDAJE DE SEGURIDAD EN ADMIN.JS ---
(function comprobarAccesoAdmin() {
    const usuarioActivo = JSON.parse(localStorage.getItem("idUsuario"));
    if (usuarioActivo !== 1) {
        alert("⛔ Acceso denegado: No tienes permisos de administrador.");
        window.location.href = "login.html";
    }
})();

document.addEventListener("DOMContentLoaded", () => {
    inicializarAdmin();
    configurarBotonRecalcular();
});

// Carga inicial cruzada: JSON + SQL Server
async function inicializarAdmin() {
    const selectGrupo = document.querySelector("#selectGrupoAdmin");
    
    try {
        const responsePartidos = await fetch("./data/partidos.json");
        partidosAdminGlobal = await responsePartidos.json();
        
        // ✅ FIX: URL corregida (faltaba la / entre api y obtener)
        const responseDB = await fetch("http://localhost:3000/api/obtener-resultados");
        const datosDB = await responseDB.json();
        
        if (datosDB.ok) {
            resultadosGuardadosBD = datosDB.resultados;
        }

        renderizarPartidosAdmin(partidosAdminGlobal);

        if (selectGrupo) {
            selectGrupo.addEventListener("change", (e) => {
                const grupoSeleccionado = e.target.value;
                if (grupoSeleccionado === "TODOS") {
                    renderizarPartidosAdmin(partidosAdminGlobal);
                } else {
                    const filtrados = partidosAdminGlobal.filter(p => p.grupo === grupoSeleccionado);
                    renderizarPartidosAdmin(filtrados);
                }
            });
        }
    } catch (error) {
        console.error("Error al inicializar el panel de administración:", error);
    }
}

function renderizarPartidosAdmin(partidosAMostrar) {
    const container = document.querySelector("#adminPartidosContainer");
    if (!container) return;
    container.textContent = "";

    partidosAMostrar.forEach((partido) => {
        const registroBD = resultadosGuardadosBD.find(r => r.PartidoId === partido.id);

        const golesLocalActual = partido.resultadoLocal !== undefined ? partido.resultadoLocal : (registroBD ? registroBD.GolesLocal : "");
        const golesVisitanteActual = partido.resultadoVisitante !== undefined ? partido.resultadoVisitante : (registroBD ? registroBD.GolesVisitante : "");

        const row = document.createElement("div");
        row.className = "quiniela-row";
        row.style.gridTemplateColumns = "1.5fr 1fr .8fr 0.8fr";

        const matchDiv = document.createElement("div");
        matchDiv.className = "match";
        const numSpan = document.createElement("span");
        numSpan.className = "num";
        numSpan.textContent = partido.id;
        const localSpan = document.createElement("span");
        localSpan.className = "team-name";
        localSpan.textContent = `${obtenerEmojiBandera(partido.codLocal)} ${partido.local}`;
        const vsSmall = document.createElement("small");
        vsSmall.textContent = "vs";
        const visitanteSpan = document.createElement("span");
        visitanteSpan.className = "team-name";
        visitanteSpan.textContent = `${partido.visitante} ${obtenerEmojiBandera(partido.codVisitante)}`;
        matchDiv.append(numSpan, localSpan, vsSmall, visitanteSpan);

        const predictionDiv = document.createElement("div");
        predictionDiv.className = "prediction";

        const inputLocal = document.createElement("input");
        inputLocal.type = "number";
        inputLocal.className = "goles-local";
        inputLocal.min = "0";
        inputLocal.placeholder = "-";
        inputLocal.value = golesLocalActual;
        inputLocal.addEventListener("input", (e) => {
            partido.resultadoLocal = e.target.value;
        });

        const dashSpan = document.createElement("span");
        dashSpan.className = "dash";
        dashSpan.textContent = "-";

        const inputVisitante = document.createElement("input");
        inputVisitante.type = "number";
        inputVisitante.className = "goles-visitante";
        inputVisitante.min = "0";
        inputVisitante.placeholder = "-";
        inputVisitante.value = golesVisitanteActual;
        inputVisitante.addEventListener("input", (e) => {
            partido.resultadoVisitante = e.target.value;
        });

        predictionDiv.append(inputLocal, dashSpan, inputVisitante);

        const dateDiv = document.createElement("div");
        dateDiv.className = "date";
        const clockIcon = document.createElement("i");
        clockIcon.className = "bx bx-time-five";
        const dateTextDiv = document.createElement("div");
        dateTextDiv.className = "date-text";
        dateTextDiv.appendChild(document.createTextNode(partido.fecha));
        dateTextDiv.appendChild(document.createElement("br"));
        const hourSmall = document.createElement("small");
        hourSmall.textContent = partido.hora;
        dateTextDiv.appendChild(hourSmall);
        dateDiv.append(clockIcon, dateTextDiv);

        const btnGuardarFila = document.createElement("button");
        btnGuardarFila.className = "btn-registrar-fila";
        btnGuardarFila.textContent = "✔ Registrar";
        
        btnGuardarFila.addEventListener("click", () => {
            enviarResultadoOficial(partido.id, inputLocal.value, inputVisitante.value, btnGuardarFila);
        });

        if (registroBD) {
            inputLocal.readOnly = true;
            inputVisitante.readOnly = true;
            row.classList.add("partido-registrado-admin");
            btnGuardarFila.disabled = true;
            btnGuardarFila.textContent = "Guardado 🟢";
        }

        row.append(matchDiv, predictionDiv, dateDiv, btnGuardarFila);
        container.appendChild(row);
    });
}

async function enviarResultadoOficial(partidoId, gLocal, gVisitante, botonPresionado) {
    const mensaje = document.getElementById("adminMensaje");
    
    if (gLocal === "" || gVisitante === "") {
        mensaje.textContent = "⚠️ Ingresa ambos marcadores para registrar.";
        mensaje.style.color = "#e74c3c";
        return;
    }

    try {
        const response = await fetch("http://localhost:3000/api/guardar-resultado", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                partidoId: parseInt(partidoId),
                golesLocal: parseInt(gLocal),
                golesVisitante: parseInt(gVisitante)
            })
        });

        const data = await response.json();
        mensaje.textContent = data.message;
        mensaje.style.color = data.ok ? "#2ecc71" : "#e74c3c";

        if (data.ok && botonPresionado) {
            botonPresionado.textContent = "Guardado 🟢";
            botonPresionado.disabled = true;
            const filaPadre = botonPresionado.closest(".quiniela-row");
            if (filaPadre) {
                filaPadre.classList.add("partido-registrado-admin");
                filaPadre.querySelectorAll(".prediction input").forEach(inp => inp.readOnly = true);
            }

            const partIdx = partidosAdminGlobal.findIndex(p => p.id === partidoId);
            if (partIdx !== -1) {
                partidosAdminGlobal[partIdx].resultadoLocal = gLocal;
                partidosAdminGlobal[partIdx].resultadoVisitante = gVisitante;
            }
        }

    } catch (error) {
        console.error(error);
        mensaje.textContent = "Error crítico de conexión.";
        mensaje.style.color = "#e74c3c";
    }
}

function configurarBotonRecalcular() {
    const btnCalcular = document.getElementById("btnAdminCalcular");
    const mensaje = document.getElementById("adminMensaje");

    if (!btnCalcular) return;

    btnCalcular.addEventListener("click", async () => {
        try {
            mensaje.textContent = "⏳ Procesando el cálculo masivo en SQL Server...";
            mensaje.style.color = "#f1c40f";

            const response = await fetch("http://localhost:3000/api/calcular-puntos", { method: "POST" });
            const data = await response.json();

            mensaje.textContent = data.message;
            mensaje.style.color = data.ok ? "#2ecc71" : "#e74c3c";
        } catch (error) {
            mensaje.textContent = "Error al ejecutar el cálculo global.";
            mensaje.style.color = "#e74c3c";
        }
    });
}

// ✅ FIX: Algoritmo de banderas actualizado (mismo que app.js)
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
