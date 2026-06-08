let partidosGlobal        = [];
let temporizadorMensaje;
let suscripcionActiva     = false; // true si el admin activó la suscripción
let pronosticosMemoria    = {};    // { [partidoId]: { ModificacionesUsadas } }

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
    inicializarQuiniela();
    iniciarTemporizador();
    cargarPerfilUsuario();
    inicializarPronosticoCampeon();
});

async function inicializarQuiniela() {
    const selectGrupo    = document.querySelector("#selectGrupo");
    const idUsuario      = localStorage.getItem("idUsuario");
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
            authFetch(`${API_URL}/api/obtener-quiniela/${idUsuario}`),
            authFetch(`${API_URL}/api/mis-datos/${idUsuario}`)
        ]);

        partidosGlobal     = await resPartidos.json();
        poblarDropdownCampeon(partidosGlobal);
        const datosDB      = await resQuiniela.json();
        const datosSub     = await resDatos.json();

        // Suscripción activa = el admin le activó el paquete
        suscripcionActiva  = datosSub.ok && datosSub.suscripcion !== null;

        // Mostrar y actualizar panel de goles si está activo
        actualizarPanelGoles(datosSub.suscripcion, datosSub.partidosDesbloqueados);

        // Guardar modificaciones en memoria por partido
        if (datosSub.ok && datosSub.partidosDesbloqueados) {
            datosSub.partidosDesbloqueados.forEach(d => {
                pronosticosMemoria[d.PartidoId] = { ModificacionesUsadas: d.ModificacionesUsadas };
            });
        }

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

function renderizarPartidos(partidosAMostrar, pronosticosGuardados = []) {
    const container = document.querySelector("#quinielaContainer");
    if (!container) return;
    container.textContent = "";

    partidosAMostrar.forEach((partido) => {
        const horaLimpia   = partido.hora.replace(" hrs", "");
        const fechaPartido = new Date(`${partido.fecha} ${horaLimpia}:00 GMT-0600`);
        const msHasta      = fechaPartido.getTime() - Date.now();
        const yaEmpezó     = msHasta <= 0;
        const memPartido   = pronosticosMemoria[partido.id] || null;
        const modUsadas    = memPartido ? memPartido.ModificacionesUsadas : 0;
        const modRestantes = 3 - modUsadas;

        const recordGuardado       = pronosticosGuardados.find(p => p.PartidoId === partido.id);
        const golesLocalActual     = partido.golesLocal     !== undefined ? partido.golesLocal     : (recordGuardado ? recordGuardado.GolesLocal     : "0");
        const golesVisitanteActual = partido.golesVisitante !== undefined ? partido.golesVisitante : (recordGuardado ? recordGuardado.GolesVisitante : "0");

        const row = document.createElement("div");
        row.className  = "quiniela-row";
        row.dataset.id = partido.id;

        // ─── Equipos ──────────────────────────────────────────
        const matchDiv  = document.createElement("div"); matchDiv.className = "match";
        const numSpan   = document.createElement("span"); numSpan.className = "num"; numSpan.textContent = partido.id;
        const localSpan = document.createElement("span"); localSpan.className = "team-name";
        localSpan.textContent = `${obtenerEmojiBandera(partido.codLocal)} ${partido.local}`;
        const vsSmall   = document.createElement("small"); vsSmall.textContent = "vs";
        const visitSpan = document.createElement("span"); visitSpan.className = "team-name";
        visitSpan.textContent = `${partido.visitante} ${obtenerEmojiBandera(partido.codVisitante)}`;
        matchDiv.append(numSpan, localSpan, vsSmall, visitSpan);

        // ─── Inputs ───────────────────────────────────────────
        const predictionDiv  = document.createElement("div"); predictionDiv.className = "prediction";
        const inputLocal     = document.createElement("input");
        inputLocal.type = "number"; inputLocal.className = "goles-local"; inputLocal.min = "0"; inputLocal.value = golesLocalActual;
        inputLocal.addEventListener("input", e => { partido.golesLocal = parseInt(e.target.value) || 0; });
        const dashSpan       = document.createElement("span"); dashSpan.className = "dash"; dashSpan.textContent = "-";
        const inputVisitante = document.createElement("input");
        inputVisitante.type = "number"; inputVisitante.className = "goles-visitante"; inputVisitante.min = "0"; inputVisitante.value = golesVisitanteActual;
        inputVisitante.addEventListener("input", e => { partido.golesVisitante = parseInt(e.target.value) || 0; });
        predictionDiv.append(inputLocal, dashSpan, inputVisitante);

        // ─── Fecha ────────────────────────────────────────────
        const dateDiv     = document.createElement("div"); dateDiv.className = "date";
        const clockIcon   = document.createElement("i"); clockIcon.className = "bx bx-time-five";
        const dateTextDiv = document.createElement("div"); dateTextDiv.className = "date-text";
        dateTextDiv.append(document.createTextNode(partido.fecha), document.createElement("br"));
        const hourSmall   = document.createElement("small"); hourSmall.textContent = partido.hora;
        dateTextDiv.appendChild(hourSmall); dateDiv.append(clockIcon, dateTextDiv);

        // ─── Estado ───────────────────────────────────────────
        const estadoDiv = document.createElement("div");
        estadoDiv.className = "estado-col";

        if (yaEmpezó) {
            // Partido iniciado — bloqueado para todos
            inputLocal.readOnly = inputVisitante.readOnly = true;
            row.style.opacity   = "0.4";
            estadoDiv.innerHTML = `<span class="badge-estado-partido en-juego">⏱ En juego</span>`;

        } else if (!suscripcionActiva) {
            // Sin suscripción activada por el admin
            inputLocal.readOnly = inputVisitante.readOnly = true;
            row.style.opacity   = "0.6";
            estadoDiv.innerHTML = `<span class="badge-estado-partido sin-plan">🔒Esperando autorización...</span>`;

        } else if (modRestantes === 0) {
            // Agotó las 3 modificaciones
            inputLocal.readOnly = inputVisitante.readOnly = true;
            estadoDiv.innerHTML = `<span class="badge-estado-partido sin-mods">🔒 Sin modificaciones</span>`;

        } else {
            // ✅ Puede guardar — botón con leyenda según modificaciones restantes
            const btnGuardar = document.createElement("button");
            btnGuardar.className = "btn-guardar-fila";

            if (modRestantes === 1) {
                btnGuardar.innerHTML      = `💾 <small style="color:#e74c3c;">⚠️ Último cambio disponible</small>`;
                btnGuardar.style.borderColor = "rgba(231,76,60,.6)";
                btnGuardar.style.background  = "rgba(231,76,60,.08)";
            } else if (modRestantes === 2) {
                btnGuardar.innerHTML      = `💾 <small style="color:#f1c40f;">Guardar (te quedarán 2 cambios más)</small>`;
                btnGuardar.style.borderColor = "rgba(241,196,15,.5)";
            } else {
                btnGuardar.innerHTML = `💾 <small>Guardar pronóstico</small>`;
            }

            btnGuardar.addEventListener("click", () =>
                guardarPartidoIndividual(partido, inputLocal, inputVisitante, btnGuardar)
            );
            estadoDiv.appendChild(btnGuardar);
        }

        row.append(matchDiv, predictionDiv, dateDiv, estadoDiv);
        container.appendChild(row);
    });
}

async function guardarPartidoIndividual(partido, inputLocal, inputVisitante, btn) {
    const idUsuario    = parseInt(localStorage.getItem("idUsuario"));
    const gl           = parseInt(inputLocal.value)    || 0;
    const gv           = parseInt(inputVisitante.value) || 0;
    const memPartido   = pronosticosMemoria[partido.id] || { ModificacionesUsadas: 0 };
    const modRestantes = 3 - memPartido.ModificacionesUsadas;

    // Confirmación con leyenda
    let msgConfirm = `¿Guardar pronóstico ${partido.local} vs ${partido.visitante}?`;
    if (modRestantes === 2) {
        msgConfirm += `\n\n⚠️ Al guardar te quedará 1 último cambio para este partido.`;
    } else if (modRestantes === 1) {
        msgConfirm += `\n\n⚠️ Este es tu ÚLTIMO cambio para este partido. Después quedará sellado.`;
    }

    if (!confirm(msgConfirm)) return;

    try {
        btn.disabled  = true;
        btn.innerHTML = `⏳`;

        const res = await authFetch(`${API_URL}/api/guardar-quiniela`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                idUsuario,
                pronosticos: [{ partidoId: partido.id, golesLocal: gl, golesVisitante: gv }]
            })
        });
        const data = await res.json();
        mostrarMensaje(data.message, data.ok ? "success" : "error");

        if (data.ok) {
            // Actualizar modificaciones en memoria
            if (data.partidosDesbloqueados) {
                data.partidosDesbloqueados.forEach(d => {
                    pronosticosMemoria[d.PartidoId] = { ModificacionesUsadas: d.ModificacionesUsadas };
                });
            }
            partido.golesLocal = gl; partido.golesVisitante = gv;
            const memPartido = pronosticosMemoria[partido.id] || { ModificacionesUsadas: 0 };
            const nuevasMod = 3 - memPartido.ModificacionesUsadas;
            btn.disabled = false;

            if (nuevasMod === 0) {
                btn.innerHTML = `🔒 <small>Sin modificaciones</small>`;
                btn.disabled  = true;
                inputLocal.readOnly = inputVisitante.readOnly = true;
            } else if (nuevasMod === 1) {
                btn.innerHTML        = `💾 <small style="color:#e74c3c;">⚠️ Último cambio disponible</small>`;
                btn.style.borderColor = "rgba(231,76,60,.6)";
                btn.style.background  = "rgba(231,76,60,.08)";
            } else {
                btn.innerHTML        = `💾 <small style="color:#f1c40f;">Guardar (te quedarán 2 cambios más)</small>`;
                btn.style.borderColor = "rgba(241,196,15,.5)";
                btn.style.background  = "";
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

async function inicializarPronosticoCampeon() {
    const idUsuario = parseInt(localStorage.getItem("idUsuario"));
    const panel = document.getElementById("panelCampeon");
    if (!panel) return;

    const DEADLINE_CAMPEON = new Date("June 11, 2026 13:00:00 GMT-0600").getTime();
    const yaInicioMundial = Date.now() >= DEADLINE_CAMPEON;

    const selectCampeon = document.getElementById("selectCampeon");
    const inputGL      = document.getElementById("inputCampeonGL");
    const inputGV      = document.getElementById("inputCampeonGV");
    const btnCampeon   = document.getElementById("btnGuardarCampeon");

    try {
        const res  = await authFetch(`${API_URL}/api/campeon/${idUsuario}`);
        const data = await res.json();
        if (data.ok && data.campeon) {
            const { SeleccionCampeon, GolesLocal, GolesVisitante } = data.campeon;
            if (selectCampeon) {
                if (selectCampeon.options.length <= 1 && partidosGlobal.length > 0) {
                    poblarDropdownCampeon(partidosGlobal);
                }
                selectCampeon.value = SeleccionCampeon || "";
            }
            if (inputGL)      inputGL.value      = GolesLocal ?? "";
            if (inputGV)      inputGV.value      = GolesVisitante ?? "";
        }
    } catch (e) { console.error(e); }

    if (yaInicioMundial) {
        if (selectCampeon) selectCampeon.disabled = true;
        if (inputGL)      inputGL.disabled = true;
        if (inputGV)      inputGV.disabled = true;
        if (btnCampeon) {
            btnCampeon.disabled = true;
            btnCampeon.innerHTML = `🔒 Bloqueado`;
        }
        return;
    }

    if (!btnCampeon) return;

    btnCampeon.addEventListener("click", async () => {
        const idUsuario      = parseInt(localStorage.getItem("idUsuario"));
        const seleccion      = document.getElementById("selectCampeon")?.value;
        const golesLocal     = parseInt(document.getElementById("inputCampeonGL")?.value) ?? 0;
        const golesVisitante = parseInt(document.getElementById("inputCampeonGV")?.value) ?? 0;
        if (!seleccion) { mostrarMensaje("⚠️ Selecciona la selección campeona.", "error"); return; }
        try {
            btnCampeon.disabled = true;
            const res  = await authFetch(`${API_URL}/api/campeon`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ idUsuario, seleccionCampeon: seleccion, golesLocal, golesVisitante })
            });
            const data = await res.json();
            mostrarMensaje(data.message, data.ok ? "success" : "error");
        } catch { mostrarMensaje("Error al guardar campeón.", "error"); }
        finally  { btnCampeon.disabled = false; }
    });
}

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
    const fechaMundial    = new Date("June 11, 2026 13:00:00 GMT-0600").getTime();
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
        imgSidebar.src     = fotoGuardada;
        imgSidebar.onerror = () => { imgSidebar.src = "./img/user-icon.png"; };
    }
}

// ─── CONTROL DE GOLES Y DESBLOQUEO DE PARTIDOS ───────────────────────────────

function actualizarPanelGoles(suscripcion, partidosDesbloqueados) {
    const panel = document.getElementById("panelGoles");
    if (panel) panel.style.display = "none";
}

async function desbloquearPartido(partido, btn) {
    const idUsuario = parseInt(localStorage.getItem("idUsuario"));
    const horaLimpia = partido.hora.replace(" hrs", "");
    const fechaPartido = new Date(`${partido.fecha} ${horaLimpia}:00`);

    if (!confirm(`¿Desbloquear el partido ${partido.local} vs ${partido.visitante}?`)) return;

    try {
        btn.disabled = true;
        btn.innerHTML = `⏳`;

        const res = await authFetch(`${API_URL}/api/desbloquear-partido`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                idUsuario,
                partidoId: partido.id,
                fechaPartido: fechaPartido.toISOString()
            })
        });

        const data = await res.json();
        mostrarMensaje(data.message, data.ok ? "success" : "error");

        if (data.ok) {
            // Actualizar localmente la memoria para evitar esperas
            pronosticosMemoria[partido.id] = { ModificacionesUsadas: 0 };

            // Recargar datos actualizados del backend
            const [resQuiniela, resDatos] = await Promise.all([
                authFetch(`${API_URL}/api/obtener-quiniela/${idUsuario}`),
                authFetch(`${API_URL}/api/mis-datos/${idUsuario}`)
            ]);
            const datosDB = await resQuiniela.json();
            const datosSub = await resDatos.json();

            actualizarPanelGoles(datosSub.suscripcion, datosSub.partidosDesbloqueados);
            renderizarPartidos(partidosGlobal, datosDB.pronosticos);
        } else {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-lock-open"></i> <small>Desbloquear</small>`;
        }
    } catch (error) {
        mostrarMensaje("Error al conectar.", "error");
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-lock-open"></i> <small>Desbloquear</small>`;
    }
}

function poblarDropdownCampeon(partidos) {
    const selectCampeon = document.getElementById("selectCampeon");
    if (!selectCampeon) return;

    const paises = [...new Set(partidos.flatMap(p => [p.local, p.visitante]))].sort((a, b) => a.localeCompare(b));
    const valorActual = selectCampeon.value;

    selectCampeon.innerHTML = '<option value="">-- Selecciona país --</option>' +
        paises.map(p => `<option value="${p}">${p}</option>`).join('');

    if (valorActual) selectCampeon.value = valorActual;
}