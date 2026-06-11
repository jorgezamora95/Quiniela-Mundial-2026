let partidosGlobal        = [];
let temporizadorMensaje;
let suscripcionActiva     = false;
let pronosticosMemoria    = {};
let pronosticosGuardadosGlobal = [];
let grupoActivoActual     = 'TODOS';

async function authFetch(url, options = {}) {
    const token = localStorage.getItem("token");
    if (!options.headers) options.headers = {};
    if (token) options.headers["x-user-token"] = token;
    return fetch(url, options);
}

document.addEventListener("DOMContentLoaded", () => {
    inicializarQuiniela();
    iniciarTemporizador();
    cargarPerfilUsuario();
    inicializarPronosticoCampeon();
});

async function inicializarQuiniela() {
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

        partidosGlobal              = await resPartidos.json();
        poblarDropdownCampeon(partidosGlobal);
        const datosDB               = await resQuiniela.json();
        const datosSub              = await resDatos.json();
        pronosticosGuardadosGlobal  = datosDB.pronosticos || [];

        suscripcionActiva = datosSub.ok && datosSub.suscripcion !== null;
        actualizarPanelGoles(datosSub.suscripcion, datosSub.partidosDesbloqueados);

        if (datosSub.ok && datosSub.partidosDesbloqueados) {
            datosSub.partidosDesbloqueados.forEach(d => {
                pronosticosMemoria[d.PartidoId] = { ModificacionesUsadas: d.ModificacionesUsadas };
            });
        }

        // Renderizar tabs de grupos
        renderizarTabsGrupos();
        // Mostrar todos los partidos al inicio
        renderizarGrupoCompleto('TODOS');

    } catch (error) {
        console.error("Error al inicializar:", error);
    }
}

// ─── TABS DE GRUPOS ───────────────────────────────────────────────────────────
function renderizarTabsGrupos() {
    const container = document.getElementById("tabsGruposQuiniela");
    if (!container) return;
    container.innerHTML = '';

    const grupos = [...new Set(partidosGlobal.map(p => p.grupo))].sort();

    // Botón TODOS
    const btnTodos = document.createElement('button');
    btnTodos.className   = 'tab-grupo tab-grupo--activo';
    btnTodos.textContent = 'Todos';
    btnTodos.dataset.grupo = 'TODOS';
    btnTodos.style.padding  = '0 .8rem';
    btnTodos.style.width    = 'auto';
    btnTodos.style.minWidth = 'auto';
    btnTodos.addEventListener('click', () => seleccionarGrupo('TODOS', btnTodos));
    container.appendChild(btnTodos);

    grupos.forEach(g => {
        const btn = document.createElement('button');
        btn.className    = 'tab-grupo';
        btn.textContent  = g;
        btn.dataset.grupo = g;
        btn.addEventListener('click', () => seleccionarGrupo(g, btn));
        container.appendChild(btn);
    });
}

function seleccionarGrupo(grupo, btnActivo) {
    grupoActivoActual = grupo;
    document.querySelectorAll('#tabsGruposQuiniela .tab-grupo').forEach(b => b.classList.remove('tab-grupo--activo'));
    btnActivo.classList.add('tab-grupo--activo');
    renderizarGrupoCompleto(grupo);
}

function renderizarGrupoCompleto(grupo) {
    const lista = grupo === 'TODOS'
        ? partidosGlobal
        : partidosGlobal.filter(p => p.grupo === grupo);

    // Renderizar tabla de posiciones del usuario (solo si es un grupo específico)
    renderizarTablaPronosticosGrupo(grupo, lista);

    // Renderizar partidos
    renderizarPartidos(lista, pronosticosGuardadosGlobal);
}

// ─── TABLA DE POSICIONES (basada en pronósticos del usuario) ──────────────────
function renderizarTablaPronosticosGrupo(grupo, partidos) {
    const container = document.getElementById("tablaPronosticosGrupo");
    if (!container) return;

    if (grupo === 'TODOS') {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';

    // Obtener equipos del grupo
    const equipos = {};
    partidos.forEach(p => {
        if (!equipos[p.local])    equipos[p.local]    = { nombre:p.local,    cod:p.codLocal,    j:0,g:0,e:0,l:0,gf:0,gc:0,pts:0 };
        if (!equipos[p.visitante]) equipos[p.visitante] = { nombre:p.visitante, cod:p.codVisitante, j:0,g:0,e:0,l:0,gf:0,gc:0,pts:0 };
    });

    // Calcular posiciones según pronósticos del usuario
    partidos.forEach(p => {
        const pro = pronosticosGuardadosGlobal.find(pr => pr.PartidoId === p.id);
        if (!pro) return;

        const gl = pro.GolesLocal, gv = pro.GolesVisitante;
        const eqL = equipos[p.local], eqV = equipos[p.visitante];
        if (!eqL || !eqV) return;

        eqL.j++; eqV.j++;
        eqL.gf += gl; eqL.gc += gv;
        eqV.gf += gv; eqV.gc += gl;

        if (gl > gv) { eqL.g++; eqL.pts+=3; eqV.l++; }
        else if (gl < gv) { eqV.g++; eqV.pts+=3; eqL.l++; }
        else { eqL.e++; eqL.pts+=1; eqV.e++; eqV.pts+=1; }
    });

    // Ordenar por puntos, luego diferencia de goles
    const ranking = Object.values(equipos).sort((a,b) => {
        if (b.pts !== a.pts) return b.pts - a.pts;
        return (b.gf - b.gc) - (a.gf - a.gc);
    });

    const html = `
        <div class="tabla-grupo-wrapper" style="margin-bottom:1.5rem;">
            <div class="tabla-grupo-header">
                <h3>📊 Tu pronóstico — Grupo ${grupo}</h3>
                <span class="badge-pts-quiniela" style="background:rgba(52,152,219,.15);border-color:rgba(52,152,219,.3);color:#3498db;">
                    Simulación según tus pronósticos
                </span>
            </div>
            <div class="tabla-grupo-head">
                <div class="tg-pos">#</div>
                <div class="tg-equipo">Equipo</div>
                <div class="tg-stat">J</div>
                <div class="tg-stat">G</div>
                <div class="tg-stat">E</div>
                <div class="tg-stat">P</div>
                <div class="tg-stat">GF</div>
                <div class="tg-stat">GC</div>
                <div class="tg-stat">Dif</div>
                <div class="tg-pts">Pts</div>
            </div>
            ${ranking.map((eq, i) => {
                const dif = eq.gf - eq.gc;
                return `
                <div class="tabla-grupo-row ${i < 2 ? 'clasifica' : ''}">
                    <div class="tg-pos">
                        ${i < 2 ? '<span class="dot-clasifica"></span>' : ''}
                        ${i+1}
                    </div>
                    <div class="tg-equipo">
                        <span style="font-size:1.2rem;">${obtenerEmojiBandera(eq.cod)}</span>
                        <span>${eq.nombre}</span>
                    </div>
                    <div class="tg-stat">${eq.j}</div>
                    <div class="tg-stat">${eq.g}</div>
                    <div class="tg-stat">${eq.e}</div>
                    <div class="tg-stat">${eq.l}</div>
                    <div class="tg-stat">${eq.gf}</div>
                    <div class="tg-stat">${eq.gc}</div>
                    <div class="tg-stat ${dif>0?'dif-pos':dif<0?'dif-neg':''}">${dif>0?'+':''}${dif}</div>
                    <div class="tg-pts"><strong>${eq.pts}</strong></div>
                </div>`;
            }).join('')}
            <div class="tabla-grupo-legend">
                <span class="dot-clasifica"></span> Clasificaría a 16avos según tus pronósticos
            </div>
        </div>
    `;

    container.innerHTML = html;
}

// ─── RENDERIZAR PARTIDOS ──────────────────────────────────────────────────────
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

        const matchDiv  = document.createElement("div"); matchDiv.className = "match";
        const numSpan   = document.createElement("span"); numSpan.className = "num"; numSpan.textContent = partido.id;
        const localSpan = document.createElement("span"); localSpan.className = "team-name";
        localSpan.textContent = `${obtenerEmojiBandera(partido.codLocal)} ${partido.local}`;
        const vsSmall   = document.createElement("small"); vsSmall.textContent = "vs";
        const visitSpan = document.createElement("span"); visitSpan.className = "team-name";
        visitSpan.textContent = `${partido.visitante} ${obtenerEmojiBandera(partido.codVisitante)}`;
        matchDiv.append(numSpan, localSpan, vsSmall, visitSpan);

        const predictionDiv  = document.createElement("div"); predictionDiv.className = "prediction";
        const inputLocal     = document.createElement("input");
        inputLocal.type = "number"; inputLocal.className = "goles-local"; inputLocal.min = "0"; inputLocal.value = golesLocalActual;
        inputLocal.addEventListener("input", e => { partido.golesLocal = parseInt(e.target.value) || 0; });
        const dashSpan       = document.createElement("span"); dashSpan.className = "dash"; dashSpan.textContent = "-";
        const inputVisitante = document.createElement("input");
        inputVisitante.type = "number"; inputVisitante.className = "goles-visitante"; inputVisitante.min = "0"; inputVisitante.value = golesVisitanteActual;
        inputVisitante.addEventListener("input", e => { partido.golesVisitante = parseInt(e.target.value) || 0; });
        predictionDiv.append(inputLocal, dashSpan, inputVisitante);

        const dateDiv     = document.createElement("div"); dateDiv.className = "date";
        const clockIcon   = document.createElement("i"); clockIcon.className = "bx bx-time-five";
        const dateTextDiv = document.createElement("div"); dateTextDiv.className = "date-text";
        dateTextDiv.append(document.createTextNode(partido.fecha), document.createElement("br"));
        const hourSmall   = document.createElement("small"); hourSmall.textContent = partido.hora;
        dateTextDiv.appendChild(hourSmall); dateDiv.append(clockIcon, dateTextDiv);

        const estadoDiv = document.createElement("div");
        estadoDiv.className = "estado-col";

        if (yaEmpezó) {
            inputLocal.readOnly = inputVisitante.readOnly = true;
            row.style.opacity   = "0.4";
            estadoDiv.innerHTML = `<span class="badge-estado-partido en-juego">⏱ En juego</span>`;
        } else if (!suscripcionActiva) {
            inputLocal.readOnly = inputVisitante.readOnly = true;
            row.style.opacity   = "0.6";
            estadoDiv.innerHTML = `<span class="badge-estado-partido sin-plan">🔒 Esperando autorización...</span>`;
        } else if (modRestantes === 0) {
            inputLocal.readOnly = inputVisitante.readOnly = true;
            estadoDiv.innerHTML = `<span class="badge-estado-partido sin-mods">🔒 Sin modificaciones</span>`;
        } else {
            const btnGuardar = document.createElement("button");
            btnGuardar.className = "btn-guardar-fila";

            if (modRestantes === 1) {
                btnGuardar.innerHTML         = `💾 <small style="color:#e74c3c;">⚠️ Último cambio disponible</small>`;
                btnGuardar.style.borderColor = "rgba(231,76,60,.6)";
                btnGuardar.style.background  = "rgba(231,76,60,.08)";
            } else if (modRestantes === 2) {
                btnGuardar.innerHTML         = `💾 <small style="color:#f1c40f;">Guardar (te quedarán 2 cambios más)</small>`;
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

// ─── GUARDAR PARTIDO ──────────────────────────────────────────────────────────
async function guardarPartidoIndividual(partido, inputLocal, inputVisitante, btn) {
    const idUsuario    = parseInt(localStorage.getItem("idUsuario"));
    const gl           = parseInt(inputLocal.value)    || 0;
    const gv           = parseInt(inputVisitante.value) || 0;
    const memPartido   = pronosticosMemoria[partido.id] || { ModificacionesUsadas: 0 };
    const modRestantes = 3 - memPartido.ModificacionesUsadas;

    let msgConfirm = `¿Guardar pronóstico ${partido.local} vs ${partido.visitante}?`;
    if (modRestantes === 2) msgConfirm += `\n\n⚠️ Al guardar te quedará 1 último cambio para este partido.`;
    else if (modRestantes === 1) msgConfirm += `\n\n⚠️ Este es tu ÚLTIMO cambio para este partido. Después quedará sellado.`;
    if (!confirm(msgConfirm)) return;

    try {
        btn.disabled  = true;
        btn.innerHTML = `⏳`;

        const res = await authFetch(`${API_URL}/api/guardar-quiniela`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idUsuario, pronosticos: [{ partidoId: partido.id, golesLocal: gl, golesVisitante: gv }] })
        });
        const data = await res.json();
        mostrarMensaje(data.message, data.ok ? "success" : "error");

        if (data.ok) {
            if (data.partidosDesbloqueados) {
                data.partidosDesbloqueados.forEach(d => {
                    pronosticosMemoria[d.PartidoId] = { ModificacionesUsadas: d.ModificacionesUsadas };
                });
            }

            // Actualizar pronósticos en memoria global para reflejar en la tabla
            const idx = pronosticosGuardadosGlobal.findIndex(p => p.PartidoId === partido.id);
            if (idx >= 0) { pronosticosGuardadosGlobal[idx].GolesLocal = gl; pronosticosGuardadosGlobal[idx].GolesVisitante = gv; }
            else pronosticosGuardadosGlobal.push({ PartidoId: partido.id, GolesLocal: gl, GolesVisitante: gv });

            partido.golesLocal = gl; partido.golesVisitante = gv;
            const nuevasMod = 3 - (pronosticosMemoria[partido.id]?.ModificacionesUsadas || 0);
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

            // Actualizar tabla de posiciones del usuario en tiempo real
            if (grupoActivoActual !== 'TODOS') {
                const listaGrupo = partidosGlobal.filter(p => p.grupo === grupoActivoActual);
                renderizarTablaPronosticosGrupo(grupoActivoActual, listaGrupo);
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

// ─── CAMPEÓN ──────────────────────────────────────────────────────────────────
async function inicializarPronosticoCampeon() {
    const idUsuario = parseInt(localStorage.getItem("idUsuario"));
    const panel     = document.getElementById("panelCampeon");
    if (!panel) return;

    const DEADLINE     = new Date("June 11, 2026 13:00:00 GMT-0600").getTime();
    const yaInicio     = Date.now() >= DEADLINE;
    const selectCampeon = document.getElementById("selectCampeon");
    const inputGL       = document.getElementById("inputCampeonGL");
    const inputGV       = document.getElementById("inputCampeonGV");
    const btnCampeon    = document.getElementById("btnGuardarCampeon");

    try {
        const res  = await authFetch(`${API_URL}/api/campeon/${idUsuario}`);
        const data = await res.json();
        if (data.ok && data.campeon) {
            const { SeleccionCampeon, GolesLocal, GolesVisitante } = data.campeon;
            if (selectCampeon) {
                if (selectCampeon.options.length <= 1 && partidosGlobal.length > 0) poblarDropdownCampeon(partidosGlobal);
                selectCampeon.value = SeleccionCampeon || "";
            }
            if (inputGL) inputGL.value = GolesLocal ?? "";
            if (inputGV) inputGV.value = GolesVisitante ?? "";
        }
    } catch (e) { console.error(e); }

    if (yaInicio) {
        if (selectCampeon) selectCampeon.disabled = true;
        if (inputGL)       inputGL.disabled       = true;
        if (inputGV)       inputGV.disabled       = true;
        if (btnCampeon)  { btnCampeon.disabled = true; btnCampeon.innerHTML = `🔒 Bloqueado`; }
        return;
    }

    if (!btnCampeon) return;
    btnCampeon.addEventListener("click", async () => {
        const id         = parseInt(localStorage.getItem("idUsuario"));
        const seleccion  = document.getElementById("selectCampeon")?.value;
        const gl         = parseInt(document.getElementById("inputCampeonGL")?.value) || 0;
        const gv         = parseInt(document.getElementById("inputCampeonGV")?.value) || 0;
        if (!seleccion) { mostrarMensaje("⚠️ Selecciona la selección campeona.", "error"); return; }
        try {
            btnCampeon.disabled = true;
            const res  = await authFetch(`${API_URL}/api/campeon`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ idUsuario:id, seleccionCampeon:seleccion, golesLocal:gl, golesVisitante:gv })
            });
            const data = await res.json();
            mostrarMensaje(data.message, data.ok ? "success" : "error");
        } catch { mostrarMensaje("Error al guardar campeón.", "error"); }
        finally  { btnCampeon.disabled = false; }
    });
}

// ─── UTILIDADES ───────────────────────────────────────────────────────────────
function mostrarMensaje(texto, tipo) {
    const el = document.querySelector("#mensajeQuiniela");
    if (!el) return;
    clearTimeout(temporizadorMensaje);
    el.style.opacity = "1"; el.textContent = texto; el.className = `mensaje ${tipo}`;
    temporizadorMensaje = setTimeout(() => { el.style.opacity="0"; setTimeout(()=>{el.textContent="";},500); }, 4000);
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
        const d=Math.floor(distancia/86400000), h=Math.floor((distancia%86400000)/3600000),
              m=Math.floor((distancia%3600000)/60000), s=Math.floor((distancia%60000)/1000);
        contenedorReloj.textContent = `${String(d).padStart(2,"0")} : ${String(h).padStart(2,"0")} : ${String(m).padStart(2,"0")} : ${String(s).padStart(2,"0")}`;
    }, 1000);
}

function cargarPerfilUsuario() {
    const nombreGuardado = localStorage.getItem("Nombre");
    const fotoGuardada   = localStorage.getItem("FotoUrl");
    const nombreHeader   = document.querySelector(".profile-header h3");
    if (nombreHeader && nombreGuardado) nombreHeader.textContent = nombreGuardado;
    const imgSidebar = document.getElementById("imgAvatarSidebar");
    if (imgSidebar && fotoGuardada && fotoGuardada !== "") {
        imgSidebar.src     = fotoGuardada;
        imgSidebar.onerror = () => { imgSidebar.src = "./img/user-icon.png"; };
    }
}

function actualizarPanelGoles(suscripcion, partidosDesbloqueados) {
    const panel = document.getElementById("panelGoles");
    if (panel) panel.style.display = "none";
}

async function desbloquearPartido(partido, btn) {
    const idUsuario    = parseInt(localStorage.getItem("idUsuario"));
    const horaLimpia   = partido.hora.replace(" hrs", "");
    const fechaPartido = new Date(`${partido.fecha} ${horaLimpia}:00`);
    if (!confirm(`¿Desbloquear ${partido.local} vs ${partido.visitante}?`)) return;
    try {
        btn.disabled = true; btn.innerHTML = `⏳`;
        const res = await authFetch(`${API_URL}/api/desbloquear-partido`, {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ idUsuario, partidoId:partido.id, fechaPartido:fechaPartido.toISOString() })
        });
        const data = await res.json();
        mostrarMensaje(data.message, data.ok ? "success" : "error");
        if (data.ok) {
            pronosticosMemoria[partido.id] = { ModificacionesUsadas: 0 };
            const [resQ, resD] = await Promise.all([
                authFetch(`${API_URL}/api/obtener-quiniela/${idUsuario}`),
                authFetch(`${API_URL}/api/mis-datos/${idUsuario}`)
            ]);
            const datosQ = await resQ.json(); const datosD = await resD.json();
            pronosticosGuardadosGlobal = datosQ.pronosticos || [];
            actualizarPanelGoles(datosD.suscripcion, datosD.partidosDesbloqueados);
            renderizarGrupoCompleto(grupoActivoActual);
        } else { btn.disabled=false; btn.innerHTML=`🔓 <small>Desbloquear</small>`; }
    } catch (error) {
        mostrarMensaje("Error al conectar.", "error");
        btn.disabled=false; btn.innerHTML=`🔓 <small>Desbloquear</small>`;
    }
}

function poblarDropdownCampeon(partidos) {
    const selectCampeon = document.getElementById("selectCampeon");
    if (!selectCampeon) return;
    const paises    = [...new Set(partidos.flatMap(p => [p.local, p.visitante]))].sort((a,b) => a.localeCompare(b));
    const valorActual = selectCampeon.value;
    selectCampeon.innerHTML = '<option value="">-- Selecciona país --</option>' +
        paises.map(p => `<option value="${p}">${p}</option>`).join('');
    if (valorActual) selectCampeon.value = valorActual;
}