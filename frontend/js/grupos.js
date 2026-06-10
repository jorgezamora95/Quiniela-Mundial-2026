// ─── grupos.js — Tabla de grupos con standings de API-Sports ─────────────────
// Agregar en mi-quiniela.html: <script src="./js/grupos.js"></script>

let standingsGlobal   = {};
let puntosPorGrupoUser = {};
let grupoActivo       = 'A';

async function inicializarTablaGrupos() {
    const idUsuario = localStorage.getItem('idUsuario');
    const container = document.getElementById('tablaGruposContainer');
    if (!container) return;

    try {
        container.innerHTML = `<div style="text-align:center;padding:2rem;color:#b8c2d6;">⏳ Cargando tabla de grupos...</div>`;

        const [resStandings, resPuntos] = await Promise.all([
            fetch(`${API_URL}/api/standings`),
            authFetch(`${API_URL}/api/mis-puntos-grupo/${idUsuario}`)
        ]);

        const dataStandings = await resStandings.json();
        const dataPuntos    = await resPuntos.json();

        if (!dataStandings.ok || Object.keys(dataStandings.grupos).length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:2rem;color:#b8c2d6;">⏳ Los standings estarán disponibles cuando inicien los partidos.</div>`;
            return;
        }

        standingsGlobal    = dataStandings.grupos;
        puntosPorGrupoUser = dataPuntos.ok ? dataPuntos.puntosPorGrupo : {};

        renderizarTabsGrupos();
        renderizarTablaGrupo(grupoActivo);

    } catch (error) {
        console.error(error);
        container.innerHTML = `<div style="text-align:center;padding:2rem;color:#e74c3c;">❌ Error al cargar standings.</div>`;
    }
}

function renderizarTabsGrupos() {
    const tabs = document.getElementById('tabsGrupos');
    if (!tabs) return;
    tabs.innerHTML = '';

    const grupos = Object.keys(standingsGlobal).sort();
    grupos.forEach(letra => {
        const btn = document.createElement('button');
        btn.className   = `tab-grupo ${letra === grupoActivo ? 'tab-grupo--activo' : ''}`;
        btn.textContent = letra;
        btn.dataset.grupo = letra;
        btn.addEventListener('click', () => {
            grupoActivo = letra;
            document.querySelectorAll('.tab-grupo').forEach(t => t.classList.remove('tab-grupo--activo'));
            btn.classList.add('tab-grupo--activo');
            renderizarTablaGrupo(letra);
        });
        tabs.appendChild(btn);
    });
}

function renderizarTablaGrupo(letra) {
    const container = document.getElementById('tablaGruposContainer');
    if (!container) return;

    const equipos = standingsGlobal[letra];
    if (!equipos) { container.innerHTML = ''; return; }

    const ptsQuiniela = puntosPorGrupoUser[letra] || 0;

    const html = `
        <div class="tabla-grupo-wrapper">
            <div class="tabla-grupo-header">
                <h3>Grupo ${letra}</h3>
                <span class="badge-pts-quiniela">⭐ ${ptsQuiniela} pts en tu quiniela</span>
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

            ${equipos.map((eq, i) => `
                <div class="tabla-grupo-row ${i < 2 ? 'clasifica' : ''}">
                    <div class="tg-pos">
                        ${i < 2 ? `<span class="dot-clasifica"></span>` : ''}
                        ${eq.posicion}
                    </div>
                    <div class="tg-equipo">
                        <img src="${eq.logo}" alt="${eq.nombre}" class="logo-equipo" onerror="this.style.display='none'">
                        <span>${eq.nombre}</span>
                    </div>
                    <div class="tg-stat">${eq.jugados}</div>
                    <div class="tg-stat">${eq.ganados}</div>
                    <div class="tg-stat">${eq.empates}</div>
                    <div class="tg-stat">${eq.perdidos}</div>
                    <div class="tg-stat">${eq.golesFavor}</div>
                    <div class="tg-stat">${eq.golesContra}</div>
                    <div class="tg-stat ${eq.diferencia > 0 ? 'dif-pos' : eq.diferencia < 0 ? 'dif-neg' : ''}">
                        ${eq.diferencia > 0 ? '+' : ''}${eq.diferencia}
                    </div>
                    <div class="tg-pts"><strong>${eq.puntos}</strong></div>
                </div>
            `).join('')}

            <div class="tabla-grupo-legend">
                <span class="dot-clasifica"></span> Clasifica a 16avos de final
            </div>
        </div>
    `;

    container.innerHTML = html;
}