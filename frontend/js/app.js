let partidosGlobal        = [];
let temporizadorMensaje;
let suscripcionUsuario    = null;  // { Paquete, GolesRestantes, MaxPartidos, GolesIniciales }
let partidosDesbloqueados = [];    // [{ PartidoId, ModificacionesUsadas, GolesGastados }]

document.addEventListener("DOMContentLoaded", () => {
    inicializarQuiniela();
    iniciarTemporizador();
    cargarPerfilUsuario();
    // configurarBotonGuardar();
    inicializarPronosticoCampeon();
});

// ─── INICIALIZAR ─────────────────────────────────────────────────────────────

async function inicializarQuiniela() {
    const selectGrupo  = document.querySelector("#selectGrupo");
    const idUsuario    = localStorage.getItem("idUsuario");
    const nombreGuardado = localStorage.getItem("Nombre");

    if (!idUsuario) { window.location.href = "login.html"; return; }

    const txtNombreSidebar = document.querySelector(".user-data h3") || document.getElementById("txtNombreUsuarioSidebar");
    if (txtNombreSidebar) {
        txtNombreSidebar.textContent =
            nombreGuardado && nombreGuardado !== "null" && nombreGuardado !== "undefined"
                ? nombreGuardado : "Participante";
    }

    try {
        const [resPartidos, resQuiniela, resDatos] = await Promise.all([
            fetch("./data/partidos.json"),
            fetch(`${API_URL}/api/obtener-quiniela/${idUsuario}`),
            fetch(`${API_URL}/api/mis-datos/${idUsuario}`)
        ]);

        partidosGlobal        = await resPartidos.json();
        const datosDB         = await resQuiniela.json();
        const datosSub        = await resDatos.json();

        suscripcionUsuario    = datosSub.ok ? datosSub.suscripcion         : null;
        partidosDesbloqueados = datosSub.ok ? datosSub.partidosDesbloqueados : [];

        actualizarPanelGoles();
        renderizarPartidos(partidosGlobal, datosDB.pronosticos);

        if (selectGrupo) {
            selectGrupo.addEventListener("change", (e) => {
                const g = e.target.value;
                const lista = g === "TODOS" ? partidosGlobal : partidosGlobal.filter(p => p.grupo === g);
                renderizarPartidos(lista, datosDB.pronosticos);
            });
        }
    } catch (error) {
        console.error("Error al inicializar:", error);
    }
}

// ─── PANEL DE GOLES (sidebar derecho) ────────────────────────────────────────

function actualizarPanelGoles() {
    const panelGoles  = document.getElementById("panelGoles");
    const txtPaquete  = document.getElementById("txtPaquete");
    const txtGoles    = document.getElementById("txtGolesRestantes");
    const barGoles    = document.getElementById("barGoles");
    const txtPartidos = document.getElementById("txtPartidosDesbloqueados");

    if (!panelGoles) return;

    if (!suscripcionUsuario) {
        panelGoles.style.display = "block";
        if (txtPaquete)  txtPaquete.textContent  = "Sin suscripción";
        if (txtGoles)    txtGoles.textContent     = "0 goles";
        if (txtPartidos) txtPartidos.textContent  = `0 / 0 partidos`;
        return;
    }

    panelGoles.style.display = "block";
    const { Paquete, GolesRestantes, GolesIniciales, MaxPartidos } = suscripcionUsuario;
    const desbloqueadosCount = partidosDesbloqueados.length;
    const porcentaje = GolesIniciales > 0 ? Math.round((GolesRestantes / GolesIniciales) * 100) : 0;

    if (txtPaquete)  txtPaquete.textContent  = `Paquete ${Paquete}`;
    if (txtGoles)    txtGoles.textContent     = `${GolesRestantes} goles`;
    if (barGoles)    barGoles.style.width     = `${porcentaje}%`;
    if (txtPartidos) txtPartidos.textContent  = `${desbloqueadosCount} / ${MaxPartidos} partidos`;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getDesbloqueo(partidoId) {
    return partidosDesbloqueados.find(d => d.PartidoId === partidoId) || null;
}

function calcularCostoFrontend(msHastaPartido) {
    const min30 = 30 * 60 * 1000;
    const min59 = 59 * 60 * 1000;
    if (msHastaPartido <= 0)     return null;
    if (msHastaPartido <= min30) return 5;
    if (msHastaPartido <= min59) return 3;
    return 1;
}

// ─── RENDERIZAR PARTIDOS ─────────────────────────────────────────────────────

function renderizarPartidos(partidosAMostrar, pronosticosGuardados = []) {
    const container = document.querySelector("#quinielaContainer");
    if (!container) return;
    container.textContent = "";

    partidosAMostrar.forEach((partido) => {
        const horaLimpia    = partido.hora.replace(" hrs", "");
        const fechaPartido  = new Date(`${partido.fecha} ${horaLimpia}:00`);
        const ahora         = new Date();
        const msHasta       = fechaPartido.getTime() - ahora.getTime();
        const yaEmpezó      = msHasta <= 0;
        const desbloqueo    = getDesbloqueo(partido.id);
        const desbloqueado  = !!desbloqueo;
        const modUsadas     = desbloqueo ? desbloqueo.ModificacionesUsadas : 0;
        const modRestantes  = 3 - modUsadas;
        const costo         = calcularCostoFrontend(msHasta);

        const recordGuardado      = pronosticosGuardados.find(p => p.PartidoId === partido.id);
        const golesLocalActual    = partido.golesLocal     !== undefined ? partido.golesLocal     : (recordGuardado ? recordGuardado.GolesLocal     : "0");
        const golesVisitanteActual = partido.golesVisitante !== undefined ? partido.golesVisitante : (recordGuardado ? recordGuardado.GolesVisitante : "0");

        const row = document.createElement("div");
        row.className = "quiniela-row";
        row.dataset.id = partido.id;

        // Equipos
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

        // Inputs
        const predictionDiv = document.createElement("div");
        predictionDiv.className = "prediction";
        const inputLocal = document.createElement("input");
        inputLocal.type = "number"; inputLocal.className = "goles-local"; inputLocal.min = "0";
        inputLocal.value = golesLocalActual;
        inputLocal.addEventListener("input", e => { partido.golesLocal = parseInt(e.target.value) || 0; });
        const dashSpan = document.createElement("span");
        dashSpan.className = "dash"; dashSpan.textContent = "-";
        const inputVisitante = document.createElement("input");
        inputVisitante.type = "number"; inputVisitante.className = "goles-visitante"; inputVisitante.min = "0";
        inputVisitante.value = golesVisitanteActual;
        inputVisitante.addEventListener("input", e => { partido.golesVisitante = parseInt(e.target.value) || 0; });
        predictionDiv.append(inputLocal, dashSpan, inputVisitante);

        // Fecha
        const dateDiv = document.createElement("div");
        dateDiv.className = "date";
        const clockIcon = document.createElement("i");
        clockIcon.className = "bx bx-time-five";
        const dateTextDiv = document.createElement("div");
        dateTextDiv.className = "date-text";
        dateTextDiv.append(document.createTextNode(partido.fecha), document.createElement("br"));
        const hourSmall = document.createElement("small");
        hourSmall.textContent = partido.hora;
        dateTextDiv.appendChild(hourSmall);
        dateDiv.append(clockIcon, dateTextDiv);

        // ─── ESTADO DEL PARTIDO ───────────────────────────────
        const estadoDiv = document.createElement("div");
        estadoDiv.className = "estado-col";

        if (yaEmpezó) {
            // Partido en curso — bloqueado para todos sin excepción
            inputLocal.readOnly    = true;
            inputVisitante.readOnly = true;
            row.style.opacity      = "0.4";
            estadoDiv.innerHTML    = `<span class="badge-estado-partido en-juego">⏱ En juego</span>`;

        } else if (desbloqueado) {
            // Tiene desbloqueo — puede editar si le quedan modificaciones
            if (modRestantes > 0) {
                // Botón guardar individual por fila
                const btnGuardarFila = document.createElement("button");
                btnGuardarFila.className = "btn-guardar-fila";
                btnGuardarFila.innerHTML = `💾 <small>${modRestantes} mod.</small>`;
                btnGuardarFila.title = `Te quedan ${modRestantes} modificaciones para este partido`;
                btnGuardarFila.addEventListener("click", () => guardarPartidoIndividual(partido, inputLocal, inputVisitante, btnGuardarFila));
                estadoDiv.appendChild(btnGuardarFila);
            } else {
                // Sin modificaciones restantes
                inputLocal.readOnly    = true;
                inputVisitante.readOnly = true;
                estadoDiv.innerHTML    = `<span class="badge-estado-partido sin-mods">🔒 Sin modificaciones</span>`;
            }

        } else {
            // Sin desbloqueo — mostrar botón de desbloquear con costo
            inputLocal.readOnly    = true;
            inputVisitante.readOnly = true;
            row.style.opacity      = "0.6";

            if (!suscripcionUsuario) {
                estadoDiv.innerHTML = `<span class="badge-estado-partido sin-plan">⚠️ Sin plan</span>`;
            } else if (costo === null) {
                estadoDiv.innerHTML = `<span class="badge-estado-partido en-juego">⏱ En juego</span>`;
            } else {
                const btnDesbloquear = document.createElement("button");
                btnDesbloquear.className = "btn-desbloquear-partido";
                const textoEmergencia = costo > 1 ? ` ⚡${costo > 3 ? "URGENTE" : "pronto"}` : "";
                btnDesbloquear.innerHTML = `🔓 <small>${costo} gol${costo > 1 ? "es" : ""}${textoEmergencia}</small>`;
                btnDesbloquear.addEventListener("click", () => desbloquearPartido(partido, fechaPartido, row, btnDesbloquear));
                estadoDiv.appendChild(btnDesbloquear);
            }
        }

        row.append(matchDiv, predictionDiv, dateDiv, estadoDiv);
        container.appendChild(row);
    });
}

// ─── DESBLOQUEAR PARTIDO ─────────────────────────────────────────────────────

async function desbloquearPartido(partido, fechaPartido, row, btn) {
    const idUsuario = parseInt(localStorage.getItem("idUsuario"));
    const costo     = calcularCostoFrontend(fechaPartido.getTime() - Date.now());

    if (costo === null) {
        mostrarMensaje("⛔ El partido ya empezó.", "error");
        return;
    }

    const confirmar = confirm(
        `¿Desbloquear ${partido.local} vs ${partido.visitante}?\n` +
        `Costo: ${costo} gol${costo > 1 ? "es" : ""}.\n` +
        `Goles disponibles: ${suscripcionUsuario?.GolesRestantes ?? 0}`
    );
    if (!confirmar) return;

    try {
        btn.disabled = true;
        const res  = await fetch(`${API_URL}/api/desbloquear-partido`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ idUsuario, partidoId: partido.id, fechaPartido: fechaPartido.toISOString() })
        });
        const data = await res.json();
        mostrarMensaje(data.message, data.ok ? "success" : "error");

        if (data.ok) {
            // Actualizar estado en memoria y re-renderizar
            suscripcionUsuario.GolesRestantes = data.golesRestantes;
            partidosDesbloqueados.push({ PartidoId: partido.id, ModificacionesUsadas: 0, GolesGastados: data.costo });
            actualizarPanelGoles();

            // Re-renderizar solo esta fila recargando la página (más limpio)
            const selectGrupo = document.querySelector("#selectGrupo");
            const grupoActual = selectGrupo ? selectGrupo.value : "TODOS";
            const lista = grupoActual === "TODOS" ? partidosGlobal : partidosGlobal.filter(p => p.grupo === grupoActual);
            const resQ  = await fetch(`${API_URL}/api/obtener-quiniela/${idUsuario}`);
            const datosQ = await resQ.json();
            renderizarPartidos(lista, datosQ.pronosticos);
        }
    } catch (error) {
        mostrarMensaje("Error de conexión.", "error");
    } finally {
        btn.disabled = false;
    }
}

// ─── GUARDAR PARTIDO INDIVIDUAL ──────────────────────────────────────────────

async function guardarPartidoIndividual(partido, inputLocal, inputVisitante, btn) {
    const idUsuario = parseInt(localStorage.getItem("idUsuario"));
    const gl = parseInt(inputLocal.value)    || 0;
    const gv = parseInt(inputVisitante.value) || 0;

    try {
        btn.disabled   = true;
        btn.innerHTML  = `⏳`;
        const res  = await fetch(`${API_URL}/api/guardar-quiniela`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
                idUsuario,
                pronosticos: [{ partidoId: partido.id, golesLocal: gl, golesVisitante: gv }]
            })
        });
        const data = await res.json();
        mostrarMensaje(data.message, data.ok ? "success" : "error");

        if (data.ok) {
            // Actualizar modificaciones en memoria
            const d = partidosDesbloqueados.find(d => d.PartidoId === partido.id);
            if (d) d.ModificacionesUsadas++;
            partido.golesLocal     = gl;
            partido.golesVisitante = gv;
            const modRestantes = 3 - (d ? d.ModificacionesUsadas : 0);
            btn.disabled = false;
            btn.innerHTML = modRestantes > 0
                ? `💾 <small>${modRestantes} mod.</small>`
                : `🔒 <small>Sin modificaciones</small>`;
            if (modRestantes === 0) {
                btn.disabled = true;
                inputLocal.readOnly = true;
                inputVisitante.readOnly = true;
            }
        } else {
            btn.disabled  = false;
            btn.innerHTML = `💾 <small>Reintentar</small>`;
        }
    } catch (error) {
        mostrarMensaje("Error de conexión.", "error");
        btn.disabled  = false;
        btn.innerHTML = `💾`;
    }
}

// ─── PRONÓSTICO DE CAMPEÓN ───────────────────────────────────────────────────

async function inicializarPronosticoCampeon() {
    const idUsuario = parseInt(localStorage.getItem("idUsuario"));
    const panel = document.getElementById("panelCampeon");
    if (!panel) return;

    try {
        const res  = await fetch(`${API_URL}/api/campeon/${idUsuario}`);
        const data = await res.json();
        if (data.ok && data.campeon) {
            const { SeleccionCampeon, GolesLocal, GolesVisitante } = data.campeon;
            const inputCampeon = document.getElementById("inputCampeon");
            const inputGL      = document.getElementById("inputCampeonGL");
            const inputGV      = document.getElementById("inputCampeonGV");
            if (inputCampeon) inputCampeon.value = SeleccionCampeon;
            if (inputGL)      inputGL.value      = GolesLocal ?? "";
            if (inputGV)      inputGV.value      = GolesVisitante ?? "";
        }
    } catch (e) { console.error(e); }

    const btnCampeon = document.getElementById("btnGuardarCampeon");
    if (!btnCampeon) return;

    btnCampeon.addEventListener("click", async () => {
        const idUsuario      = parseInt(localStorage.getItem("idUsuario"));
        const seleccion      = document.getElementById("inputCampeon")?.value.trim();
        const golesLocal     = parseInt(document.getElementById("inputCampeonGL")?.value) ?? 0;
        const golesVisitante = parseInt(document.getElementById("inputCampeonGV")?.value) ?? 0;

        if (!seleccion) { mostrarMensaje("⚠️ Escribe la selección campeona.", "error"); return; }

        try {
            btnCampeon.disabled = true;
            const res  = await fetch(`${API_URL}/api/campeon`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ idUsuario, seleccionCampeon: seleccion, golesLocal, golesVisitante })
            });
            const data = await res.json();
            mostrarMensaje(data.message, data.ok ? "success" : "error");
        } catch { mostrarMensaje("Error al guardar campeón.", "error"); }
        finally  { btnCampeon.disabled = false; }
    });
}

// ─── UTILIDADES ──────────────────────────────────────────────────────────────

function mostrarMensaje(texto, tipo) {
    const el = document.querySelector("#mensajeQuiniela");
    if (!el) return;
    clearTimeout(temporizadorMensaje);
    el.style.opacity = "1";
    el.textContent   = texto;
    el.className     = `mensaje ${tipo}`;
    temporizadorMensaje = setTimeout(() => {
        el.style.opacity = "0";
        setTimeout(() => { el.textContent = ""; }, 500);
    }, 4000);
}

function obtenerEmojiBandera(codigoPais) {
    if (!codigoPais) return "";
    const codigo = codigoPais.toUpperCase().trim();
    if (codigo === "GB-ENG") return "🏴󠁧󠁢󠁥󠁮󠁧󠁿";
    if (codigo === "GB-SCT") return "🏴󠁧󠁢󠁳󠁣󠁴󠁿";
    if (codigo === "GB-WLS") return "🏴󠁧󠁢󠁷󠁬󠁳󠁿";
    if (codigo.length !== 2) return "";
    const [a, b] = codigo.split("");
    return String.fromCodePoint(0x1F1E6 + a.charCodeAt(0) - 65, 0x1F1E6 + b.charCodeAt(0) - 65);
}

function iniciarTemporizador() {
    const fechaMundial    = new Date("June 11, 2026 13:00:00").getTime();
    const contenedorReloj = document.querySelector(".timer-card h3");
    if (!contenedorReloj) return;
    const intervalo = setInterval(() => {
        const distancia = fechaMundial - Date.now();
        if (distancia < 0) { clearInterval(intervalo); contenedorReloj.textContent = "00 : 00 : 00 : 00"; return; }
        const d = Math.floor(distancia / 86400000);
        const h = Math.floor((distancia % 86400000) / 3600000);
        const m = Math.floor((distancia % 3600000) / 60000);
        const s = Math.floor((distancia % 60000) / 1000);
        contenedorReloj.textContent = `${String(d).padStart(2,"0")} : ${String(h).padStart(2,"0")} : ${String(m).padStart(2,"0")} : ${String(s).padStart(2,"0")}`;
    }, 1000);
}

function cargarPerfilUsuario() {
    const nombreHeader   = document.querySelector(".profile-header h3");
    const nombreGuardado = localStorage.getItem("Nombre");
    const fotoGuardada   = localStorage.getItem("FotoUrl");
    if (nombreHeader && nombreGuardado) nombreHeader.textContent = nombreGuardado;
    const imgSidebar = document.getElementById("imgAvatarSidebar");
    if (imgSidebar && fotoGuardada && fotoGuardada !== "") {
        imgSidebar.src    = fotoGuardada;
        imgSidebar.onerror = () => { imgSidebar.src = "./img/user-icon.png"; };
    }
}
