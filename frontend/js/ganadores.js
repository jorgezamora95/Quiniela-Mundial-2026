// =============================================
// ganadores.js — Agregar en TODAS las páginas
// (index.html, tabla-general.html, mis-resultados.html, mi-quiniela.html)
// <script src="./js/ganadores.js"></script>
// =============================================

async function verificarGanadores() {
    try {
        const res  = await fetch(`${API_URL}/api/estado-quiniela`);
        const data = await res.json();
        if (!data.ok || data.GanadoresRevelados !== '1') return;
        mostrarAnimacionGanadores(data.ganadores);
    } catch(e) { console.error(e); }
}

function mostrarAnimacionGanadores(ganadores) {
    // Evitar mostrar dos veces en la misma sesión
    if (sessionStorage.getItem('ganadoresMostrados')) return;
    sessionStorage.setItem('ganadoresMostrados', '1');

    const medallas = { 1: '🥇', 2: '🥈', 3: '🥉' };
    const fmt = n => `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`;

    // Overlay
    const overlay = document.createElement("div");
    overlay.id = "overlayGanadores";
    overlay.style.cssText = `
        position:fixed; inset:0; z-index:99999;
        background:rgba(0,0,0,.85);
        display:flex; align-items:center; justify-content:center;
        backdrop-filter:blur(8px);
        animation: fadeInOverlay .5s ease;
    `;

    const card = document.createElement("div");
    card.style.cssText = `
        background:linear-gradient(135deg,#0d1f33,#05101a);
        border:1px solid rgba(241,196,15,.4);
        border-radius:24px;
        padding:2.5rem;
        max-width:560px;
        width:90%;
        text-align:center;
        box-shadow:0 0 60px rgba(241,196,15,.2);
        animation: slideUpCard .6s ease;
        position:relative;
        overflow:hidden;
    `;

    // Confetti CSS
    const style = document.createElement("style");
    style.textContent = `
        @keyframes fadeInOverlay { from{opacity:0} to{opacity:1} }
        @keyframes slideUpCard { from{transform:translateY(60px);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes confettiDrop {
            0%   { transform: translateY(-20px) rotate(0deg); opacity:1; }
            100% { transform: translateY(110vh) rotate(720deg); opacity:0; }
        }
        .confetti-piece {
            position:fixed; width:10px; height:10px; border-radius:2px;
            animation: confettiDrop linear forwards;
            pointer-events:none; z-index:100000;
        }
        .trophy-icon { animation: float 2s ease-in-out infinite; display:inline-block; }
    `;
    document.head.appendChild(style);

    // Lanzar confetti
    const colores = ['#f1c40f','#2ecc71','#3498db','#e74c3c','#9b59b6','#fff'];
    for (let i = 0; i < 80; i++) {
        setTimeout(() => {
            const piece = document.createElement("div");
            piece.className = "confetti-piece";
            piece.style.left    = Math.random() * 100 + "vw";
            piece.style.top     = "-20px";
            piece.style.background = colores[Math.floor(Math.random() * colores.length)];
            piece.style.animationDuration = (Math.random() * 3 + 2) + "s";
            piece.style.animationDelay   = (Math.random() * 2) + "s";
            document.body.appendChild(piece);
            setTimeout(() => piece.remove(), 6000);
        }, i * 50);
    }

    // Contenido de la card
    const ganadoresHTML = ganadores.slice(0, 3).map(g => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:.8rem 1rem; background:rgba(255,255,255,.04); border-radius:12px; margin-bottom:.5rem;">
            <div style="display:flex; align-items:center; gap:.8rem;">
                ${g.FotoUrl
                    ? `<img src="${g.FotoUrl}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid rgba(241,196,15,.4);" onerror="this.src='./img/user-icon.png'">`
                    : `<div style="width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;font-size:1.2rem;">${medallas[g.Posicion]}</div>`
                }
                <div style="text-align:left;">
                    <strong style="color:white;">${g.Nombre}</strong>
                    <small style="display:block;color:#b8c2d6;">${g.Puntos} puntos</small>
                </div>
            </div>
            <strong style="color:#2ecc71;">${fmt(g.MontoPremio)}</strong>
        </div>
    `).join('');

    card.innerHTML = `
        <div class="trophy-icon" style="font-size:4rem; margin-bottom:1rem;">🏆</div>
        <h1 style="margin:0 0 .3rem; font-size:1.8rem; color:#f1c40f;">¡El Mundial ha terminado!</h1>
        <p style="color:#b8c2d6; margin-bottom:1.5rem;">Quiniela Mundial 2026 — torreslab</p>
        ${ganadoresHTML}
        <button id="btnCerrarGanadores" style="margin-top:1.5rem; background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.2); color:white; padding:.7rem 2rem; border-radius:10px; cursor:pointer; font-size:1rem; transition:.2s;">
            Ver tabla completa
        </button>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    document.getElementById("btnCerrarGanadores").addEventListener("click", () => {
        overlay.style.opacity = "0";
        overlay.style.transition = "opacity .3s";
        setTimeout(() => overlay.remove(), 300);
    });

    // Cerrar al hacer click fuera
    overlay.addEventListener("click", e => {
        if (e.target === overlay) {
            overlay.style.opacity = "0";
            overlay.style.transition = "opacity .3s";
            setTimeout(() => overlay.remove(), 300);
        }
    });
}

// Verificar al cargar la página
document.addEventListener("DOMContentLoaded", () => {
    // Pequeño delay para que cargue el resto de la página primero
    setTimeout(verificarGanadores, 1500);
});
