// =============================================
// REEMPLAZA COMPLETAMENTE tu admin.js
// =============================================

let partidosAdminGlobal   = [];
let resultadosGuardadosBD = [];
let paquetesGlobal        = [];

(function comprobarAccesoAdmin() {
    const usuarioActivo = JSON.parse(localStorage.getItem("idUsuario"));
    if (usuarioActivo !== 1) {
        alert("⛔ Acceso denegado.");
        window.location.href = "login.html";
    }
})();

// Helper fetch wrapper to attach x-admin-token header
async function adminFetch(url, options = {}) {
    const adminToken = localStorage.getItem("adminToken");
    if (!options.headers) {
        options.headers = {};
    }
    if (adminToken) {
        options.headers["x-admin-token"] = adminToken;
    }
    return fetch(url, options);
}

// Helper for escaping HTML to prevent Stored XSS
function escapeHTML(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

document.addEventListener("DOMContentLoaded", () => {
    inicializarAdmin();
    configurarBotonRecalcular();
    inicializarPanelSuscripciones();
    inicializarPanelBolsa();
    inicializarPanelPendientes();
    inicializarPanelCampeonAdmin();
    configurarBotonRevelarGanadores();
    inicializarLogsAdmin();
});

// ─── RESULTADOS OFICIALES ────────────────────────────────────────────────────
async function inicializarAdmin() {
    const selectGrupo = document.querySelector("#selectGrupoAdmin");
    try {
        const [resPartidos, resDB] = await Promise.all([
            fetch("./data/partidos.json"),
            adminFetch(`${API_URL}/api/obtener-resultados`)
        ]);
        partidosAdminGlobal   = await resPartidos.json();
        poblarDropdownCampeonAdmin(partidosAdminGlobal);
        const datosDB         = await resDB.json();
        if (datosDB.ok) resultadosGuardadosBD = datosDB.resultados;
        renderizarPartidosAdmin(partidosAdminGlobal);
        if (selectGrupo) {
            selectGrupo.addEventListener("change", (e) => {
                const g = e.target.value;
                renderizarPartidosAdmin(g === "TODOS" ? partidosAdminGlobal : partidosAdminGlobal.filter(p => p.grupo === g));
            });
        }
    } catch (error) { console.error(error); }
}

function renderizarPartidosAdmin(lista) {
    const container = document.querySelector("#adminPartidosContainer");
    if (!container) return;
    container.textContent = "";
    lista.forEach(partido => {
        const reg = resultadosGuardadosBD.find(r => r.PartidoId === partido.id);
        const gL  = partido.resultadoLocal     !== undefined ? partido.resultadoLocal     : (reg ? reg.GolesLocal     : "");
        const gV  = partido.resultadoVisitante !== undefined ? partido.resultadoVisitante : (reg ? reg.GolesVisitante : "");

        const row = document.createElement("div");
        row.className = "quiniela-row";
        row.style.gridTemplateColumns = "1.5fr 1fr .8fr 0.8fr";

        const matchDiv = document.createElement("div"); matchDiv.className = "match";
        const numSpan  = document.createElement("span"); numSpan.className = "num"; numSpan.textContent = partido.id;
        const lSpan    = document.createElement("span"); lSpan.className = "team-name";
        lSpan.textContent = `${obtenerEmojiBandera(partido.codLocal)} ${partido.local}`;
        const vs = document.createElement("small"); vs.textContent = "vs";
        const vSpan = document.createElement("span"); vSpan.className = "team-name";
        vSpan.textContent = `${partido.visitante} ${obtenerEmojiBandera(partido.codVisitante)}`;
        matchDiv.append(numSpan, lSpan, vs, vSpan);

        const predDiv = document.createElement("div"); predDiv.className = "prediction";
        const iL = document.createElement("input"); iL.type="number"; iL.className="goles-local"; iL.min="0"; iL.placeholder="-"; iL.value=gL;
        iL.addEventListener("input", e => { partido.resultadoLocal = e.target.value; });
        const dash = document.createElement("span"); dash.className="dash"; dash.textContent="-";
        const iV = document.createElement("input"); iV.type="number"; iV.className="goles-visitante"; iV.min="0"; iV.placeholder="-"; iV.value=gV;
        iV.addEventListener("input", e => { partido.resultadoVisitante = e.target.value; });
        predDiv.append(iL, dash, iV);

        const dateDiv = document.createElement("div"); dateDiv.className="date";
        const ci = document.createElement("i"); ci.className="bx bx-time-five";
        const dtDiv = document.createElement("div"); dtDiv.className="date-text";
        dtDiv.append(document.createTextNode(partido.fecha), document.createElement("br"));
        const hs = document.createElement("small"); hs.textContent=partido.hora;
        dtDiv.appendChild(hs); dateDiv.append(ci, dtDiv);

        const btn = document.createElement("button");
        btn.className = "btn-registrar-fila"; btn.textContent = "✔ Registrar";
        btn.addEventListener("click", () => enviarResultadoOficial(partido.id, iL.value, iV.value, btn, partido.local, partido.visitante));

        if (reg) {
            iL.readOnly = iV.readOnly = true;
            row.classList.add("partido-registrado-admin");
            btn.disabled = true; btn.textContent = "Guardado 🟢";
        }
        row.append(matchDiv, predDiv, dateDiv, btn);
        container.appendChild(row);
    });
}

async function enviarResultadoOficial(partidoId, gL, gV, btn, local, visitante) {
    const msg = document.getElementById("adminMensaje");
    if (gL===""||gV==="") { msg.textContent="⚠️ Ingresa ambos marcadores."; msg.style.color="#e74c3c"; return; }
    try {
        const res  = await adminFetch(`${API_URL}/api/guardar-resultado`, {
            method:"POST", headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ partidoId:parseInt(partidoId), golesLocal:parseInt(gL), golesVisitante:parseInt(gV), local, visitante })
        });
        const data = await res.json();
        msg.textContent = data.message;
        msg.style.color = data.ok ? "#2ecc71" : "#e74c3c";
        if (data.ok && btn) {
            btn.textContent = "Guardado 🟢"; btn.disabled = true;
            const fila = btn.closest(".quiniela-row");
            if (fila) { fila.classList.add("partido-registrado-admin"); fila.querySelectorAll(".prediction input").forEach(i=>i.readOnly=true); }
            const idx = partidosAdminGlobal.findIndex(p=>p.id===partidoId);
            if (idx!==-1) { partidosAdminGlobal[idx].resultadoLocal=gL; partidosAdminGlobal[idx].resultadoVisitante=gV; }
            // Actualizar bolsa después de registrar
            inicializarPanelBolsa();
        }
    } catch(e) { console.error(e); }
}

function configurarBotonRecalcular() {
    const btn = document.getElementById("btnAdminCalcular");
    const msg = document.getElementById("adminMensaje");
    if (!btn) return;
    btn.addEventListener("click", async () => {
        try {
            msg.textContent="⏳ Procesando..."; msg.style.color="#f1c40f";
            const res  = await adminFetch(`${API_URL}/api/calcular-puntos`, { method:"POST" });
            const data = await res.json();
            msg.textContent=data.message; msg.style.color=data.ok?"#2ecc71":"#e74c3c";
            if (data.ok) inicializarPanelBolsa();
        } catch(e) { msg.textContent="Error al calcular."; msg.style.color="#e74c3c"; }
    });
}

// ─── PANEL BOLSA ──────────────────────────────────────────────────────────────
async function inicializarPanelBolsa() {
    try {
        const res  = await adminFetch(`${API_URL}/api/admin/bolsa`);
        const data = await res.json();
        if (!data.ok) return;
        renderizarPanelBolsa(data);
    } catch(e) { console.error(e); }
}

function renderizarPanelBolsa(data) {
    const container = document.getElementById("panelBolsaAdmin");
    if (!container) return;

    const fmt = n => `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`;

    container.innerHTML = `
        <!-- Resumen financiero -->
        <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:1rem; padding:1.5rem; border-bottom:1px solid rgba(255,255,255,.07);">
            <div style="text-align:center;">
                <small style="color:#b8c2d6;">Total recaudado</small>
                <h2 style="margin:.3rem 0; color:white;">${fmt(data.totalRecaudado)}</h2>
                <small style="color:#b8c2d6;">${data.totalParticipantes} participantes</small>
            </div>
            <div style="text-align:center;">
                <small style="color:#b8c2d6;">💰 Bolsa de premios (85%)</small>
                <h2 style="margin:.3rem 0; color:#2ecc71;">${fmt(data.bolsaPremios)}</h2>
            </div>
            <div style="text-align:center;">
                <small style="color:#b8c2d6;">⚙️ Cuota admin (15%)</small>
                <h2 style="margin:.3rem 0; color:#f1c40f;">${fmt(data.cuotaAdmin)}</h2>
            </div>
        </div>

        <!-- Distribución de premios -->
        <div style="padding:1.5rem;">
            <h3 style="margin:0 0 1rem; color:#b8c2d6;">Distribución actual de premios</h3>
            ${data.distribucion.map(g => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:.8rem; background:rgba(255,255,255,.04); border-radius:8px; margin-bottom:.5rem;">
                    <div style="display:flex; align-items:center; gap:.8rem;">
                        <span style="font-size:1.5rem;">${g.Posicion===1?'🥇':g.Posicion===2?'🥈':'🥉'}</span>
                        <div>
                            <strong>${g.Nombre}</strong>
                            <small style="display:block; color:#b8c2d6;">${g.Puntos} pts · ${g.porcentaje}% de la bolsa</small>
                        </div>
                    </div>
                    <strong style="color:#2ecc71; font-size:1.2rem;">${fmt(g.montoPremio)}</strong>
                </div>
            `).join('')}

            <!-- Premios base si nadie juega aún -->
            ${data.distribucion.length === 0 ? `
                <div style="color:#b8c2d6; text-align:center; padding:1rem;">Sin puntos registrados aún.</div>
                <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:1rem; margin-top:1rem;">
                    <div style="text-align:center; padding:1rem; background:rgba(255,255,255,.04); border-radius:8px;">
                        <span style="font-size:1.5rem;">🥇</span>
                        <p style="margin:.3rem 0; color:#2ecc71; font-weight:bold;">${fmt(data.premio1)}</p>
                        <small style="color:#b8c2d6;">50% · 1° lugar</small>
                    </div>
                    <div style="text-align:center; padding:1rem; background:rgba(255,255,255,.04); border-radius:8px;">
                        <span style="font-size:1.5rem;">🥈</span>
                        <p style="margin:.3rem 0; color:#2ecc71; font-weight:bold;">${fmt(data.premio2)}</p>
                        <small style="color:#b8c2d6;">30% · 2° lugar</small>
                    </div>
                    <div style="text-align:center; padding:1rem; background:rgba(255,255,255,.04); border-radius:8px;">
                        <span style="font-size:1.5rem;">🥉</span>
                        <p style="margin:.3rem 0; color:#2ecc71; font-weight:bold;">${fmt(data.premio3)}</p>
                        <small style="color:#b8c2d6;">20% · 3° lugar</small>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}

// ─── PANEL SUSCRIPCIONES ──────────────────────────────────────────────────────
async function inicializarPanelSuscripciones() {
    try {
        const [resUsers, resPaq] = await Promise.all([
            adminFetch(`${API_URL}/api/admin/usuarios-suscripciones`),
            adminFetch(`${API_URL}/api/paquetes`)
        ]);
        const dataUsers = await resUsers.json();
        const dataPaq   = await resPaq.json();
        if (dataPaq.ok) paquetesGlobal = dataPaq.paquetes;
        if (dataUsers.ok) renderizarPanelSuscripciones(dataUsers.usuarios);
    } catch(e) { console.error(e); }
}

function renderizarPanelSuscripciones(usuarios) {
    const container = document.getElementById("panelSuscripcionesAdmin");
    if (!container) return;
    container.textContent = "";

    usuarios.forEach(u => {
        const wrapper = document.createElement("div");
        wrapper.style.cssText = "border-bottom:1px solid rgba(255,255,255,.07); padding:1rem 1.2rem;";

        // ─── FILA PRINCIPAL ───────────────────────────────────────────
        const card = document.createElement("div");
        card.style.cssText = "display:grid; grid-template-columns:2fr 1.5fr 1fr; align-items:center; gap:1rem;";

        // Info usuario
        const userDiv = document.createElement("div");
        let estadoBadge = '<span style="color:#b8c2d6; font-size:.8rem;">Sin suscripción</span>';
        if (u.TieneSuscripcion) {
            estadoBadge = `<span style="color:#2ecc71; font-size:.8rem;">✅ ${escapeHTML(u.Paquete)}</span>`;
        }
        userDiv.innerHTML = `<strong>${escapeHTML(u.Nombre)}</strong><small style="display:block;color:#b8c2d6;">${escapeHTML(u.Correo)}</small>${estadoBadge}`;

        // Controles de paquete
        const ctrlDiv = document.createElement("div");
        ctrlDiv.style.cssText = "display:flex; flex-direction:column; gap:.5rem;";

        const selectPaq = document.createElement("select");
        selectPaq.style.cssText = "background:#0d1f33; color:white; border:1px solid rgba(255,255,255,.2); padding:.4rem; border-radius:8px;";
        selectPaq.innerHTML = `<option value="">-- Selecciona paquete --</option>`;
        paquetesGlobal.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.IdPaquete;
            opt.textContent = `${p.Nombre} — $${p.Precio} (${p.Goles} goles)`;
            if (u.IdPaquete === p.IdPaquete) opt.selected = true;
            selectPaq.appendChild(opt);
        });

        const inputNotas = document.createElement("input");
        inputNotas.type = "text";
        inputNotas.placeholder = "Nota (ej: Pagó en efectivo)";
        inputNotas.style.cssText = "background:#0d1f33; color:white; border:1px solid rgba(255,255,255,.2); padding:.4rem .8rem; border-radius:8px;";
        ctrlDiv.append(selectPaq, inputNotas);

        // Botón activar — se deshabilita si ya tiene suscripción
        const btnActivar = document.createElement("button");
        btnActivar.textContent = u.TieneSuscripcion ? "✅ Activado" : "✅ Activar";
        btnActivar.className   = "btn-registrar-fila";
        btnActivar.style.cssText = "background:#2ecc71; color:#000; font-weight:bold; cursor:pointer; white-space:nowrap;";

        if (u.TieneSuscripcion) {
            btnActivar.disabled = true;
            btnActivar.style.opacity = "0.45";
            btnActivar.style.cursor  = "not-allowed";
            selectPaq.disabled       = true;
            inputNotas.disabled      = true;
        }

        btnActivar.addEventListener("click", async () => {
            const idPaquete = parseInt(selectPaq.value);
            const notas     = inputNotas.value.trim();
            const msgEl     = document.getElementById("adminMensajeSubs");
            if (!idPaquete) { msgEl.textContent = "⚠️ Selecciona un paquete."; msgEl.style.color = "#e74c3c"; return; }
            try {
                btnActivar.disabled = true;
                const res  = await adminFetch(`${API_URL}/api/admin/activar-suscripcion`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ idUsuario: u.IdUsuario, idPaquete, notas })
                });
                const data = await res.json();
                msgEl.textContent = data.message;
                msgEl.style.color = data.ok ? "#2ecc71" : "#e74c3c";
                if (data.ok) {
                    setTimeout(() => inicializarPanelSuscripciones(), 1000);
                    inicializarPanelBolsa();
                } else {
                    btnActivar.disabled = false;
                }
            } catch(e) { console.error(e); btnActivar.disabled = false; }
        });

        card.append(userDiv, ctrlDiv, btnActivar);

        wrapper.appendChild(card);

        container.appendChild(wrapper);
    });
}

// ─── PANEL PENDIENTES ────────────────────────────────────────────────────────
async function inicializarPanelPendientes() {
    try {
        const res  = await adminFetch(`${API_URL}/api/admin/pendientes`);
        const data = await res.json();
        if (!data.ok) return;
        renderizarPendientes(data.pendientes);
    } catch(e) { console.error(e); }
}

function renderizarPendientes(pendientes) {
    const container = document.getElementById("panelPendientesAdmin");
    if (!container) return;
    container.textContent = "";
    if (pendientes.length === 0) {
        container.innerHTML = `<div style="padding:1.5rem; text-align:center; color:#b8c2d6;">✅ Sin resultados pendientes de validar</div>`;
        return;
    }
    fetch("./data/partidos.json").then(r => r.json()).then(partidos => {
        pendientes.forEach(p => {
            const row = document.createElement("div");
            row.style.cssText = "display:grid; grid-template-columns:2fr 1fr 2fr 1fr 1fr; align-items:center; gap:1rem; padding:1rem 1.2rem; border-bottom:1px solid rgba(255,255,255,.07);";
            const infoDiv = document.createElement("div");
            infoDiv.innerHTML = `<strong>${escapeHTML(p.LocalNombre)} ${p.GolesLocal} - ${p.GolesVisitante} ${escapeHTML(p.VisitanteNombre)}</strong><small style="display:block; color:#b8c2d6;">${new Date(p.FechaPartido).toLocaleDateString('es-MX')}</small>`;
            const badgeDiv = document.createElement("div");
            badgeDiv.innerHTML = `<span style="background:rgba(46,204,113,.15); border:1px solid rgba(46,204,113,.3); color:#2ecc71; padding:.3rem .6rem; border-radius:8px;">${p.GolesLocal} - ${p.GolesVisitante}</span>`;
            const selectPartido = document.createElement("select");
            selectPartido.style.cssText = "background:#0d1f33; color:white; border:1px solid rgba(255,255,255,.2); padding:.4rem; border-radius:8px; width:100%;";
            selectPartido.innerHTML = `<option value="">-- Selecciona partido --</option>`;
            partidos.forEach(part => {
                const opt = document.createElement("option");
                opt.value = part.id;
                opt.textContent = `#${part.id} ${part.local} vs ${part.visitante}`;
                if (part.local.toLowerCase().includes(p.LocalNombre.toLowerCase().split(' ')[0])) opt.selected = true;
                selectPartido.appendChild(opt);
            });
            const btnValidar = document.createElement("button");
            btnValidar.textContent = "✅ Validar"; btnValidar.className = "btn-registrar-fila";
            btnValidar.style.cssText = "background:#2ecc71; color:#000; font-weight:bold; cursor:pointer;";
            btnValidar.addEventListener("click", async () => {
                const partidoId = parseInt(selectPartido.value);
                const msgEl = document.getElementById("adminMensajePendientes");
                if (!partidoId) { msgEl.textContent="⚠️ Selecciona el partido."; msgEl.style.color="#e74c3c"; return; }
                try {
                    btnValidar.disabled = true;
                    const res  = await adminFetch(`${API_URL}/api/admin/validar-pendiente`, {
                        method:"POST", headers:{"Content-Type":"application/json"},
                        body: JSON.stringify({ idPendiente: p.IdPendiente, partidoId })
                    });
                    const data = await res.json();
                    msgEl.textContent = data.message; msgEl.style.color = data.ok ? "#2ecc71" : "#e74c3c";
                    if (data.ok) { setTimeout(() => inicializarPanelPendientes(), 1000); inicializarPanelBolsa(); }
                } catch(e) { console.error(e); } finally { btnValidar.disabled = false; }
            });
            const btnRechazar = document.createElement("button");
            btnRechazar.textContent = "❌"; btnRechazar.title = "Descartar";
            btnRechazar.style.cssText = "background:rgba(231,76,60,.15); border:1px solid rgba(231,76,60,.3); color:#e74c3c; padding:.4rem .8rem; border-radius:8px; cursor:pointer;";
            btnRechazar.addEventListener("click", async () => {
                if (!confirm("¿Descartar?")) return;
                await adminFetch(`${API_URL}/api/admin/rechazar-pendiente`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ idPendiente: p.IdPendiente }) });
                setTimeout(() => inicializarPanelPendientes(), 500);
            });
            row.append(infoDiv, badgeDiv, selectPartido, btnValidar, btnRechazar);
            container.appendChild(row);
        });
    });
}

document.getElementById("btnSincronizarAhora")?.addEventListener("click", async () => {
    const msgEl = document.getElementById("adminMensajePendientes");
    msgEl.textContent = "⏳ Sincronizando..."; msgEl.style.color = "#f1c40f";
    try {
        const res  = await adminFetch(`${API_URL}/api/admin/sincronizar`, { method:"POST" });
        const data = await res.json();
        msgEl.textContent = data.message; msgEl.style.color = data.ok ? "#2ecc71" : "#e74c3c";
        if (data.ok) setTimeout(() => inicializarPanelPendientes(), 1000);
    } catch(e) { msgEl.textContent = "Error de conexión."; }
});

// ─── PANEL CAMPEÓN REAL ───────────────────────────────────────────────────────
function inicializarPanelCampeonAdmin() {
    const btn = document.getElementById("btnRegistrarCampeonReal");
    if (!btn) return;
    btn.addEventListener("click", async () => {
        const seleccion = document.getElementById("selectCampeonReal")?.value;
        const gl        = parseInt(document.getElementById("inputCampeonRealGL")?.value) ?? 0;
        const gv        = parseInt(document.getElementById("inputCampeonRealGV")?.value) ?? 0;
        const msgEl     = document.getElementById("adminMensajeCampeon");
        if (!seleccion) { msgEl.textContent="⚠️ Selecciona la selección campeona."; msgEl.style.color="#e74c3c"; return; }
        try {
            btn.disabled = true;
            const res  = await adminFetch(`${API_URL}/api/admin/campeon-real`, {
                method:"POST", headers:{"Content-Type":"application/json"},
                body: JSON.stringify({ seleccionCampeon:seleccion, golesLocal:gl, golesVisitante:gv })
            });
            const data = await res.json();
            msgEl.textContent = data.message; msgEl.style.color = data.ok ? "#2ecc71" : "#e74c3c";
        } catch(e) { msgEl.textContent="Error."; msgEl.style.color="#e74c3c"; }
        finally { btn.disabled = false; }
    });
}

// ─── REVELAR GANADORES ────────────────────────────────────────────────────────
function configurarBotonRevelarGanadores() {
    const btn = document.getElementById("btnRevelarGanadores");
    if (!btn) return;
    btn.addEventListener("click", async () => {
        const confirmar = confirm("⚠️ ¿Estás seguro de revelar los ganadores?\n\nEsto enviará correos a TODOS los participantes y no se puede deshacer.");
        if (!confirmar) return;
        const msgEl = document.getElementById("adminMensajeGanadores");
        try {
            btn.disabled = true;
            btn.textContent = "⏳ Revelando...";
            msgEl.textContent = "⏳ Calculando ganadores y enviando correos...";
            msgEl.style.color = "#f1c40f";
            const res  = await adminFetch(`${API_URL}/api/admin/revelar-ganadores`, { method:"POST" });
            const data = await res.json();
            msgEl.textContent = data.message;
            msgEl.style.color = data.ok ? "#2ecc71" : "#e74c3c";
            if (data.ok) {
                btn.textContent = "✅ Ganadores Revelados";
                inicializarPanelBolsa();
            } else {
                btn.disabled = false;
                btn.textContent = "🏆 Revelar Ganadores";
            }
        } catch(e) {
            msgEl.textContent = "Error al revelar ganadores.";
            msgEl.style.color = "#e74c3c";
            btn.disabled = false;
            btn.textContent = "🏆 Revelar Ganadores";
        }
    });
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


document.getElementById("btnExportarPronosticos")?.addEventListener("click", async () => {
    try {
        // Jalar todos los pronósticos del backend
        const res  = await adminFetch(`${API_URL}/api/admin/exportar-pronosticos`);
        const data = await res.json();
        if (!data.ok) return;

        // Cargar SheetJS desde CDN
        if (!window.XLSX) {
            await new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

        // Crear el Excel
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data.pronosticos);
        XLSX.utils.book_append_sheet(wb, ws, "Pronósticos");
        XLSX.writeFile(wb, `Quiniela_Mundial_2026_${new Date().toLocaleDateString('es-MX')}.xlsx`);

    } catch(e) {
        console.error(e);
        alert("Error al exportar.");
    }
});

// ─── AUDIT LOGS VIEW ─────────────────────────────────────────────────────────
async function inicializarLogsAdmin() {
    const cuerpo = document.getElementById("tablaLogsCuerpo");
    const btnRefrescar = document.getElementById("btnRefrescarLogs");
    if (!cuerpo) return;

    if (btnRefrescar) {
        btnRefrescar.onclick = () => inicializarLogsAdmin();
    }

    try {
        const res = await adminFetch(`${API_URL}/api/admin/logs`);
        const data = await res.json();
        if (!data.ok) {
            cuerpo.innerHTML = `<tr><td colspan="6" style="padding:1.5rem; text-align:center; color:#e74c3c;">Error: ${escapeHTML(data.message)}</td></tr>`;
            return;
        }

        if (data.logs.length === 0) {
            cuerpo.innerHTML = `<tr><td colspan="6" style="padding:1.5rem; text-align:center; color:#b8c2d6;">No hay registros de actividad aún.</td></tr>`;
            return;
        }

        cuerpo.innerHTML = data.logs.map(log => {
            const fechaStr = new Date(log.Fecha).toLocaleString('es-MX');
            const exitoBadge = log.Exito 
                ? '<span style="color:#2ecc71; font-weight:bold;">✅ Éxito</span>' 
                : `<span style="color:#e74c3c; font-weight:bold;" title="${escapeHTML(log.ErrorMessage || '')}">❌ Fallo: ${escapeHTML(log.ErrorMessage || 'Error desconocido')}</span>`;
            
            const partidoStr = log.PartidoId ? `Partido #${log.PartidoId}` : '-';
            const usuarioStr = log.NombreUsuario ? `${escapeHTML(log.NombreUsuario)} (ID: ${log.IdUsuario})` : `Usuario ID: ${log.IdUsuario || '-'}`;

            return `
                <tr style="border-bottom:1px solid rgba(255,255,255,.05);">
                    <td style="padding:.8rem; white-space:nowrap;">${fechaStr}</td>
                    <td style="padding:.8rem;">${usuarioStr}</td>
                    <td style="padding:.8rem; font-weight:bold; color:white;">${escapeHTML(log.Accion)}</td>
                    <td style="padding:.8rem;">${partidoStr}</td>
                    <td style="padding:.8rem; color:#fff;">${escapeHTML(log.Detalle || '-')}</td>
                    <td style="padding:.8rem;">${exitoBadge}</td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error(error);
        cuerpo.innerHTML = `<tr><td colspan="6" style="padding:1.5rem; text-align:center; color:#e74c3c;">Error al obtener logs de actividad.</td></tr>`;
    }
}

function poblarDropdownCampeonAdmin(partidos) {
    const selectCampeonReal = document.getElementById("selectCampeonReal");
    if (!selectCampeonReal) return;

    const paises = [...new Set(partidos.flatMap(p => [p.local, p.visitante]))].sort((a, b) => a.localeCompare(b));
    const valorActual = selectCampeonReal.value;

    selectCampeonReal.innerHTML = '<option value="">-- Selecciona país --</option>' +
        paises.map(p => `<option value="${p}">${p}</option>`).join('');

    if (valorActual) selectCampeonReal.value = valorActual;
}