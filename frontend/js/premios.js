// =============================================
// premios.js — Quiniela Mundial 2026
// =============================================
async function authFetch(url, options = {}) {
    const token = localStorage.getItem("token");
    if (!options.headers) options.headers = {};
    if (token) options.headers["x-user-token"] = token;
    return fetch(url, options);
}
document.addEventListener('DOMContentLoaded', () => {
    cargarPremios();
});

async function cargarPremios() {
    const container = document.getElementById('premiosContainer');
    try {
        const token = localStorage.getItem('token');
        const res   = await authFetch(`${API_URL}/api/bolsa-premios`);
        const data = await res.json();
        if (!data.ok) throw new Error(data.message);
        renderizarPremios(data);
    } catch (err) {
        console.error(err);
        container.innerHTML = `<p style="text-align:center; color:#e74c3c; padding:2rem;">⚠️ Error al cargar la bolsa.</p>`;
    }
}

function renderizarPremios(data) {
    const container = document.getElementById('premiosContainer');
    const fmt = n => `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`;
    const medallas = ['🥇', '🥈', '🥉'];
    const clases   = ['oro', 'plata', 'bronce'];
    const posNames = ['1° Lugar', '2° Lugar', '3° Lugar'];
    const premios  = [data.premio1, data.premio2, data.premio3];
    const pcts     = [data.pctPremio1, data.pctPremio2, data.pctPremio3];

    // Top 3 rows
    const top3HTML = data.ranking.length > 0
        ? data.ranking.slice(0, 3).map((u, i) => `
            <div class="top3-row">
                <span class="top3-pos">${medallas[i] || (i + 1)}</span>
                <img class="top3-avatar"
                     src="${u.FotoUrl || './img/user-icon.png'}"
                     onerror="this.src='./img/user-icon.png'"
                     alt="${escapeHTML(u.Nombre)}">
                <div>
                    <div class="top3-nombre">${escapeHTML(u.Nombre)}</div>
                    <div class="top3-puntos">${u.Puntos} pts</div>
                </div>
                <span class="top3-premio">${fmt(premios[i] || 0)}</span>
            </div>`).join('')
        : `<div style="padding:1.5rem; text-align:center; color:#7a8aa0;">Aún no hay puntos registrados.</div>`;

    container.innerHTML = `
        <!-- Hero bolsa total -->
        <div class="premios-hero">
            <div class="bolsa-label">Bolsa Total Acumulada</div>
            <div class="bolsa-monto">${fmt(data.bolsaPremios)}</div>
            <div class="bolsa-label" style="font-size:.78rem; margin-top:.3rem;">disponible para premios</div>
            <div class="bolsa-participantes">
                <i class="fa-solid fa-users"></i>
                ${data.totalParticipantes} participante${data.totalParticipantes !== 1 ? 's' : ''} registrados
            </div>
        </div>

        <!-- Cards de premios -->
        <div class="premios-grid">
            ${[0, 1, 2].map(i => `
                <div class="premio-card ${clases[i]}">
                    <div class="premio-emoji">${medallas[i]}</div>
                    <div class="premio-pos">${posNames[i]}</div>
                    <div class="premio-monto">${fmt(premios[i])}</div>
                    <div class="premio-pct">${pcts[i]}% de la bolsa</div>
                </div>`).join('')}
        </div>

        <!-- Top 3 actual -->
        <!-- div class="top3-card">
            <div class="top3-header">
                <h3>📊 Posiciones actuales</h3>
                <p>Basado en los puntos acumulados hasta ahora. Puede cambiar con cada partido.</p>
            </div>
            ${top3HTML}
        </div -->

        <!-- Info -->
        <div class="premios-info">
            <strong>¿Cómo se distribuyen los premios?</strong><br>
            La bolsa total se divide: <strong>${(100 - (100 - data.pctPremio1 - data.pctPremio2 - data.pctPremio3 + 100 - 100)).toFixed(0)}%</strong> va a premios
            (${data.pctPremio1}% al 1°, ${data.pctPremio2}% al 2°, ${data.pctPremio3}% al 3°).
            En caso de empate, los premios correspondientes se reparten equitativamente entre los empatados.
            Los premios se revelan al finalizar el torneo.
        </div>
    `;
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}