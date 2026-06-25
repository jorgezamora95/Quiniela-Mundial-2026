let eliminatoriosData = [];
let faseActiva = '16avos';
window.resultadosRealesGlobal = window.resultadosRealesGlobal || [];
let tablasStandings = {}; // { A: [...], B: [...], ... }

async function inicializarFases() {
    const container = document.getElementById('fasesContainer');
    if (!container) return;

    try {
        const [resElim, resQuiniela, resResultados, resStandings] = await Promise.all([
            fetch('./data/eliminatorios.json'),
            authFetch(`${API_URL}/api/obtener-quiniela/${localStorage.getItem('idUsuario')}`),
            fetch(`${API_URL}/api/obtener-resultados`).catch(() => null),
            fetch(`${API_URL}/api/standings-reales`).catch(() => null)
        ]);

        eliminatoriosData = await resElim.json();
        const datosQ      = await resQuiniela.json();
        const pronosticos = datosQ.pronosticos || [];

        if (resResultados) {
            const dataRes = await resResultados.json();
            if (dataRes.ok) window.resultadosRealesGlobal = dataRes.resultados || [];
        }

        if (resStandings) {
            const dataS = await resStandings.json();
            if (dataS.ok) tablasStandings = dataS.tablas || {};
        }

        // Sincronizar pronósticos guardados
        pronosticos.forEach(p => {
            const partido = eliminatoriosData.find(e => e.id === p.PartidoId);
            if (partido) {
                partido.golesLocal     = p.GolesLocal;
                partido.golesVisitante = p.GolesVisitante;
            }
        });

        renderizarTabsFases();
        renderizarFase(faseActiva);
    } catch (error) {
        console.error('Error al cargar fases:', error);
        if (container) container.innerHTML = `<div style="text-align:center;padding:2rem;color:#b8c2d6;">⏳ Error al cargar eliminatorias.</div>`;
    }
}

// ─── RESOLVER EQUIPO DESDE STANDINGS / RESULTADOS ────────────────────────────
function resolverEquipoFase(desc) {
    if (!desc) return { nombre: desc, cod: '', pendiente: true };

    // Ganador de partido eliminatorio: "G74", "G89", etc.
    if (/^G\d+$/.test(desc)) {
        const id  = parseInt(desc.replace('G', ''));
        const res = (window.resultadosRealesGlobal || []).find(r => r.PartidoId === id);
        if (!res) return { nombre: `M${id}`, cod: '', pendiente: true };
        const p = eliminatoriosData.find(x => x.id === id);
        if (!p) return { nombre: `M${id}`, cod: '', pendiente: true };
        const lR = resolverEquipoFase(p.local), vR = resolverEquipoFase(p.visitante);
        if (res.GolesLocal  > res.GolesVisitante) return lR;
        if (res.GolesLocal  < res.GolesVisitante) return vR;
        return { nombre: `M${id}`, cod: '', pendiente: true };
    }

    // Perdedor de partido: "Perdedor G101"
    if (/^Perdedor G\d+$/.test(desc)) {
        const id  = parseInt(desc.replace('Perdedor G', ''));
        const res = (window.resultadosRealesGlobal || []).find(r => r.PartidoId === id);
        if (!res) return { nombre: desc, cod: '', pendiente: true };
        const p = eliminatoriosData.find(x => x.id === id);
        if (!p) return { nombre: desc, cod: '', pendiente: true };
        const lR = resolverEquipoFase(p.local), vR = resolverEquipoFase(p.visitante);
        if (res.GolesLocal  < res.GolesVisitante) return lR;
        if (res.GolesLocal  > res.GolesVisitante) return vR;
        return { nombre: desc, cod: '', pendiente: true };
    }

    // 1° Grupo X
    const m1 = desc.match(/^1° Grupo ([A-L])$/);
    if (m1) {
        const t = tablasStandings[m1[1]];
        if (t && t[0]) return { nombre: t[0].nombre, cod: t[0].cod, pendiente: false };
        return { nombre: desc, cod: '', pendiente: true };
    }

    // 2° Grupo X
    const m2 = desc.match(/^2° Grupo ([A-L])$/);
    if (m2) {
        const t = tablasStandings[m2[1]];
        if (t && t[1]) return { nombre: t[1].nombre, cod: t[1].cod, pendiente: false };
        return { nombre: desc, cod: '', pendiente: true };
    }

    // Mejor 3° — pendiente hasta definirse
    if (desc.includes('Mejor 3°')) return { nombre: 'Mejor 3°', cod: '', pendiente: true };

    // Texto ya resuelto (nombre de selección directamente)
    return { nombre: desc, cod: '', pendiente: false };
}

// ─── TABS DE FASES ────────────────────────────────────────────────────────────
function renderizarTabsFases() {
    const tabs = document.getElementById('tabsFases');
    if (!tabs) return;
    tabs.innerHTML = '';

    const fases = ['16avos', '8vos', 'Cuartos', 'Semis', '3er Lugar', 'Final'];
    fases.forEach(fase => {
        const btn = document.createElement('button');
        btn.className   = `tab-grupo ${fase === faseActiva ? 'tab-grupo--activo' : ''}`;
        btn.textContent = fase;
        btn.style.minWidth = '70px';
        btn.addEventListener('click', () => {
            faseActiva = fase;
            document.querySelectorAll('#tabsFases .tab-grupo').forEach(b => b.classList.remove('tab-grupo--activo'));
            btn.classList.add('tab-grupo--activo');
            renderizarFase(fase);
        });
        tabs.appendChild(btn);
    });
}

// ─── RENDER FASE ─────────────────────────────────────────────────────────────
function renderizarFase(fase) {
    const container = document.getElementById('fasesContainer');
    if (!container) return;

    const partidos = eliminatoriosData.filter(p => p.fase === fase);
    if (partidos.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:2rem;color:#b8c2d6;">Sin partidos para esta fase.</div>`;
        return;
    }

    const porFecha = {};
    partidos.forEach(p => {
        if (!porFecha[p.fecha]) porFecha[p.fecha] = [];
        porFecha[p.fecha].push(p);
    });

    container.innerHTML = '';

    Object.entries(porFecha).forEach(([fecha, ps]) => {
        const fechaDiv = document.createElement('div');
        fechaDiv.style.marginBottom = '1.5rem';
        fechaDiv.innerHTML = `
            <div style="padding:.5rem 0; margin-bottom:.5rem; color:#b8c2d6; font-size:.8rem; font-weight:bold; text-transform:uppercase; letter-spacing:.5px; border-bottom:1px solid rgba(255,255,255,.06);">
                📅 ${formatearFecha(fecha)}
            </div>
        `;
        ps.forEach(partido => fechaDiv.appendChild(crearFilaPartidoFase(partido)));
        container.appendChild(fechaDiv);
    });
}

// ─── FILA DE PARTIDO ─────────────────────────────────────────────────────────
function crearFilaPartidoFase(partido) {
    const horaLimpia   = partido.hora.replace(' hrs', '');
    const fechaPartido = new Date(`${partido.fecha} ${horaLimpia}:00 GMT-0600`);
    const msHasta      = fechaPartido.getTime() - Date.now();
    const yaEmpezó     = msHasta <= 0;
    const memPartido   = pronosticosMemoria[partido.id] || null;
    const modUsadas    = memPartido ? memPartido.ModificacionesUsadas : 0;
    const modRestantes = 3 - modUsadas;

    // ── Resolver equipos reales desde standings ──
    const eqLocal     = resolverEquipoFase(partido.local);
    const eqVisitante = resolverEquipoFase(partido.visitante);
    const esPorDefinir = eqLocal.pendiente || eqVisitante.pendiente;

    const row = document.createElement('div');
    row.style.cssText = `
        display:grid; grid-template-columns:2fr 1fr 1fr 1fr;
        align-items:center; gap:.8rem;
        background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.06);
        border-radius:12px; padding:.8rem 1.2rem; margin-bottom:.5rem;
        ${yaEmpezó ? 'opacity:0.5;' : ''}
    `;

    // Equipos — ahora con nombres resueltos y banderas
    const matchDiv = document.createElement('div');
    matchDiv.style.cssText = 'display:flex; flex-direction:column; gap:.2rem;';

    const flagLocal     = eqLocal.cod     ? obtenerEmojiBanderaFase(eqLocal.cod)     : (esPorDefinir ? '🏳️' : '');
    const flagVisitante = eqVisitante.cod ? obtenerEmojiBanderaFase(eqVisitante.cod) : (esPorDefinir ? '🏳️' : '');

    matchDiv.innerHTML = `
        <div style="display:flex; align-items:center; gap:.4rem; font-size:.9rem;">
            <span>${flagLocal}</span>
            <span ${eqLocal.pendiente ? 'style="color:#6b7a8d;font-size:.8rem;"' : ''}>${eqLocal.nombre}</span>
        </div>
        <div style="font-size:.7rem; color:#6b7a8d;">vs</div>
        <div style="display:flex; align-items:center; gap:.4rem; font-size:.9rem;">
            <span>${flagVisitante}</span>
            <span ${eqVisitante.pendiente ? 'style="color:#6b7a8d;font-size:.8rem;"' : ''}>${eqVisitante.nombre}</span>
        </div>
        <div style="font-size:.7rem; color:#6b7a8d; margin-top:.2rem;">
            #${partido.num} · ${partido.hora} · 📍 ${partido.sede}
        </div>
    `;

    // Inputs pronóstico
    const predDiv        = document.createElement('div');
    predDiv.className    = 'prediction';
    const inputLocal     = document.createElement('input');
    inputLocal.type      = 'number'; inputLocal.min = '0'; inputLocal.className = 'goles-local';
    inputLocal.value     = partido.golesLocal ?? '0';
    const dash           = document.createElement('span');
    dash.className       = 'dash'; dash.textContent = '-';
    const inputVisitante = document.createElement('input');
    inputVisitante.type  = 'number'; inputVisitante.min = '0'; inputVisitante.className = 'goles-visitante';
    inputVisitante.value = partido.golesVisitante ?? '0';
    predDiv.append(inputLocal, dash, inputVisitante);

    // Fecha
    const dateDiv = document.createElement('div');
    dateDiv.className = 'date';
    dateDiv.innerHTML = `<small style="color:#b8c2d6;">${partido.fecha}</small>`;

    // Estado
    const estadoDiv = document.createElement('div');
    estadoDiv.className = 'estado-col';

    const realResult = (window.resultadosRealesGlobal || []).find(r => r.PartidoId === partido.id);

    if (esPorDefinir) {
        inputLocal.readOnly = inputVisitante.readOnly = true;
        inputLocal.style.opacity = inputVisitante.style.opacity = '0.4';
        estadoDiv.innerHTML = `<span class="badge-estado-partido sin-plan" style="font-size:.75rem;">⏳ Por definir</span>`;
    } else if (realResult) {
        inputLocal.readOnly = inputVisitante.readOnly = true;
        estadoDiv.innerHTML = `<span class="badge-estado-partido finalizado" style="font-size:.75rem;">🏁 ${realResult.GolesLocal} - ${realResult.GolesVisitante}</span>`;
    } else if (yaEmpezó) {
        inputLocal.readOnly = inputVisitante.readOnly = true;
        estadoDiv.innerHTML = `<span class="badge-estado-partido en-juego">
            <span style="width:6px;height:6px;border-radius:50%;background:#e74c3c;flex-shrink:0;animation:pulse 1.4s ease-in-out infinite;"></span>
            En juego
        </span>`;
    } else if (!suscripcionActiva) {
        inputLocal.readOnly = inputVisitante.readOnly = true;
        estadoDiv.innerHTML = `<span class="badge-estado-partido sin-plan" style="font-size:.75rem;">🔒 Sin acceso</span>`;
    } else if (modRestantes === 0) {
        inputLocal.readOnly = inputVisitante.readOnly = true;
        estadoDiv.innerHTML = `<span class="badge-estado-partido sin-mods">🔒 Sin mods</span>`;
    } else {
        inputLocal.addEventListener('input',     e => { partido.golesLocal     = parseInt(e.target.value) || 0; });
        inputVisitante.addEventListener('input', e => { partido.golesVisitante = parseInt(e.target.value) || 0; });

        const btn = document.createElement('button');
        btn.className = 'btn-guardar-fila';
        if (modRestantes === 1) {
            btn.innerHTML         = `💾 <small style="color:#e74c3c;">⚠️ Último cambio</small>`;
            btn.style.borderColor = 'rgba(231,76,60,.6)';
            btn.style.background  = 'rgba(231,76,60,.08)';
        } else if (modRestantes === 2) {
            btn.innerHTML         = `💾 <small style="color:#f1c40f;">Guardar (quedan 2 más)</small>`;
            btn.style.borderColor = 'rgba(241,196,15,.5)';
        } else {
            btn.innerHTML = `💾 <small>Guardar pronóstico</small>`;
        }
        btn.addEventListener('click', () => guardarPartidoIndividual(partido, inputLocal, inputVisitante, btn));
        estadoDiv.appendChild(btn);
    }

    row.append(matchDiv, predDiv, dateDiv, estadoDiv);
    return row;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function formatearFecha(fechaStr) {
    const meses    = { 'Jun': 5, 'Jul': 6 };
    const diasSem  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const mesesNom = { 'Jun': 'Junio', 'Jul': 'Julio' };
    try {
        const partes = fechaStr.split(' ');
        const date   = new Date(2026, meses[partes[1]], parseInt(partes[0]));
        return `${diasSem[date.getDay()]}, ${partes[0]} de ${mesesNom[partes[1]]} de 2026`;
    } catch { return fechaStr; }
}

function obtenerEmojiBanderaFase(cod) {
    if (!cod) return '';
    if (cod === 'GB-ENG') return '🏴󠁧󠁢󠁥󠁮󠁧󠁿';
    if (cod === 'GB-SCT') return '🏴󠁧󠁢󠁳󠁣󠁴󠁿';
    if (cod.length !== 2)  return '';
    const [a, b] = cod.toUpperCase().split('');
    return String.fromCodePoint(0x1F1E6 + a.charCodeAt(0) - 65, 0x1F1E6 + b.charCodeAt(0) - 65);
}