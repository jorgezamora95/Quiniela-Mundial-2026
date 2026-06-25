// =============================================
// resultados.js — Quiniela Mundial 2026
// Posiciones reales + Bracket eliminatorios
// =============================================

let tablaGlobal    = {};   // { A: [...equipos], B: [...], ... }
let partidosGlobal = [];
let eliminatorios  = [];
let resultadosGlobal = {}; // { partidoId: { GolesLocal, GolesVisitante } }
let grupoActivoRes = 'A';

document.addEventListener('DOMContentLoaded', () => {
    const idUsuario = parseInt(localStorage.getItem('idUsuario'));
    if (!idUsuario) { window.location.href = 'login.html'; return; }
    cargarDatos();
});

async function cargarDatos() {
    try {
        const [resStandings, resPartidos, resElim, resResultados] = await Promise.all([
            fetch(`${API_URL}/api/standings-reales`),
            fetch('./data/partidos.json'),
            fetch('./data/eliminatorios.json'),
            fetch(`${API_URL}/api/obtener-resultados`)
        ]);

        const dataStandings  = await resStandings.json();
        partidosGlobal       = await resPartidos.json();
        eliminatorios        = await resElim.json();
        const dataResultados = await resResultados.json();

        if (dataStandings.ok)  tablaGlobal = dataStandings.tablas;
        if (dataResultados.ok) {
            resultadosGlobal = {};
            dataResultados.resultados.forEach(r => {
                resultadosGlobal[r.PartidoId] = r;
            });
        }

        construirTabsGrupos();
        renderizarGrupo('A');
    } catch (err) {
        console.error(err);
        document.getElementById('contenidoGrupo').innerHTML =
            '<p style="text-align:center;color:#e74c3c;padding:2rem;">⚠️ Error al cargar datos.</p>';
    }
}

async function recargarDatos() {
    document.getElementById('contenidoGrupo').innerHTML =
        '<div class="res-loading"><i class="fa-solid fa-spinner fa-spin"></i> Actualizando...</div>';
    await cargarDatos();
}

// ── Tabs de grupos ─────────────────────────────────────────────────────────────
function construirTabsGrupos() {
    const container = document.getElementById('gruposTabs');
    const grupos = Object.keys(tablaGlobal).sort();
    container.innerHTML = grupos.map(g => `
        <button class="grupo-tab ${g === 'A' ? 'activo' : ''}"
            onclick="seleccionarGrupoRes('${g}', this)">
            Grupo ${g}
        </button>`).join('');
}

function seleccionarGrupoRes(grupo, btn) {
    grupoActivoRes = grupo;
    document.querySelectorAll('.grupo-tab').forEach(b => b.classList.remove('activo'));
    btn.classList.add('activo');
    renderizarGrupo(grupo);
}

// ── Render tabla de posiciones de un grupo ────────────────────────────────────
function renderizarGrupo(grupo) {
    const container = document.getElementById('contenidoGrupo');
    const equipos   = tablaGlobal[grupo] || [];
    const partidos  = partidosGlobal.filter(p => p.grupo === grupo);

    const tablaHTML = equipos.length > 0 ? `
        <table class="tabla-standings">
            <thead>
                <tr>
                    <th style="text-align:left; padding-left:1.2rem;">Equipo</th>
                    <th>J</th><th>G</th><th>E</th><th>P</th>
                    <th>GF</th><th>GC</th><th>Dif</th>
                    <th>Pts</th>
                </tr>
            </thead>
            <tbody>
                ${equipos.map((eq, i) => {
                    const dif = eq.gf - eq.gc;
                    const claseRow = i < 2 ? 'clasifica-directo' : i === 2 ? 'clasifica-mejor3' : i === 3 ? 'eliminado' : '';
                    return `
                    <tr class="${claseRow}">
                        <td>
                            <div class="equipo-cell">
                                <span class="pos-num">${i+1}</span>
                                <span style="font-size:1.1rem;">${obtenerEmoji(eq.cod)}</span>
                                <span>${escapeHTML(eq.nombre)}</span>
                            </div>
                        </td>
                        <td>${eq.j}</td>
                        <td>${eq.g}</td>
                        <td>${eq.e}</td>
                        <td>${eq.l}</td>
                        <td>${eq.gf}</td>
                        <td>${eq.gc}</td>
                        <td class="${dif>0?'dif-pos':dif<0?'dif-neg':''}">${dif>0?'+':''}${dif}</td>
                        <td class="pts-cell">${eq.pts}</td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>` : `<p style="text-align:center;color:#7a8aa0;padding:1.5rem;">Sin resultados aún en este grupo.</p>`;

    // Partidos del grupo
    const partidosHTML = `
        <div class="partidos-grupo">
            <div class="grupo-titulo" style="margin-top:1rem;">📅 Partidos del Grupo ${grupo}</div>
            <div class="grupo-block">
                ${partidos.map(p => {
                    const res = resultadosGlobal[p.id];
                    return `
                    <div class="partido-result-row">
                        <span class="pr-fecha">${p.fecha}</span>
                        <div class="pr-equipos">
                            <span class="pr-local">
                                ${obtenerEmoji(p.codLocal)} ${escapeHTML(p.local)}
                            </span>
                            ${res
                                ? `<span class="pr-marcador">${res.GolesLocal} - ${res.GolesVisitante}</span>`
                                : `<span class="pr-pendiente">vs</span>`}
                            <span class="pr-visitante">
                                ${escapeHTML(p.visitante)} ${obtenerEmoji(p.codVisitante)}
                            </span>
                        </div>
                        <span class="pr-fecha">${p.hora}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>`;

    container.innerHTML = `
        <div class="leyenda">
            <div class="leyenda-item"><div class="leyenda-bar" style="background:#16883f;"></div> Clasifica directo (1° y 2°)</div>
            <div class="leyenda-item"><div class="leyenda-bar" style="background:#f1c40f;"></div> Posible mejor 3°</div>
            <div class="leyenda-item"><div class="leyenda-bar" style="background:#7A7A7A;"></div> Equipo eliminado</div>
        </div>
        <div class="grupo-block">
            <div class="grupo-titulo">Grupo ${grupo}</div>
            ${tablaHTML}
        </div>
        ${partidosHTML}
    `;
}

// ── Cambiar vista grupos / bracket ────────────────────────────────────────────
function cambiarVista(vista) {
    document.getElementById('vistaGrupos').style.display  = vista === 'grupos'  ? 'block' : 'none';
    document.getElementById('vistaBracket').style.display = vista === 'bracket' ? 'block' : 'none';
    document.querySelectorAll('.res-tab').forEach((btn, i) => {
        btn.classList.toggle('activo', (i === 0 && vista === 'grupos') || (i === 1 && vista === 'bracket'));
    });
    if (vista === 'bracket') renderizarBracket();
}

// ── BRACKET ───────────────────────────────────────────────────────────────────
function resolverEquipo(descripcion) {
    // Si es "GXX" significa ganador del partido XX
    if (/^G\d+$/.test(descripcion)) {
        const id  = parseInt(descripcion.replace('G', ''));
        const res = resultadosGlobal[id];
        if (!res) return { nombre: descripcion, cod: '', pendiente: true };

        const partido = eliminatorios.find(p => p.id === id)
                     || partidosGlobal.find(p => p.id === id);
        if (!partido) return { nombre: descripcion, cod: '', pendiente: true };

        if (res.GolesLocal > res.GolesVisitante)
            return { nombre: partido.local,     cod: partido.codLocal };
        if (res.GolesLocal < res.GolesVisitante)
            return { nombre: partido.visitante, cod: partido.codVisitante };
        return { nombre: `${partido.local} / ${partido.visitante}`, cod: '', empate: true };
    }

    // Si es "1° Grupo X" buscar en tablaGlobal
    const m1 = descripcion.match(/^1° Grupo ([A-L])$/);
    if (m1) {
        const t = tablaGlobal[m1[1]];
        if (t && t[0]) return { nombre: t[0].nombre, cod: t[0].cod };
        return { nombre: descripcion, cod: '', pendiente: true };
    }

    const m2 = descripcion.match(/^2° Grupo ([A-L])$/);
    if (m2) {
        const t = tablaGlobal[m2[1]];
        if (t && t[1]) return { nombre: t[1].nombre, cod: t[1].cod };
        return { nombre: descripcion, cod: '', pendiente: true };
    }

    // Mejor 3° — mostrar como pendiente hasta definirse
    if (descripcion.includes('Mejor 3°')) {
        return { nombre: 'Mejor 3°', cod: '', pendiente: true };
    }

    // Perdedor GXX
    if (/^Perdedor G\d+$/.test(descripcion)) {
        const id  = parseInt(descripcion.replace('Perdedor G', ''));
        const res = resultadosGlobal[id];
        if (!res) return { nombre: descripcion, cod: '', pendiente: true };
        const partido = eliminatorios.find(p => p.id === id);
        if (!partido) return { nombre: descripcion, cod: '', pendiente: true };
        if (res.GolesLocal < res.GolesVisitante)
            return { nombre: partido.local,     cod: partido.codLocal };
        if (res.GolesLocal > res.GolesVisitante)
            return { nombre: partido.visitante, cod: partido.codVisitante };
        return { nombre: descripcion, cod: '', pendiente: true };
    }

    return { nombre: descripcion, cod: '', pendiente: true };
}

// ─── BRACKET VISUAL v7 ───────────────────────────────────────────────────────
// SF y Final se posicionan dinámicamente según posición real de QF/SF en DOM

function renderizarBracket() {
    const container = document.getElementById('contenidoBracket');

    const byId = id => eliminatorios.find(p => p.id === id);

    const r32L = [74,77,73,75,83,84,81,82].map(byId).filter(Boolean);
    const r32R = [76,78,79,80,86,88,85,87].map(byId).filter(Boolean);
    const r16L = [89,90,93,94].map(byId).filter(Boolean);
    const r16R = [91,92,95,96].map(byId).filter(Boolean);
    const qfL  = [97,98].map(byId).filter(Boolean);
    const qfR  = [99,100].map(byId).filter(Boolean);
    const sfL  = byId(101);
    const sfR  = byId(102);
    const final   = byId(104);
    const tercero = byId(103);

    function resolverEq(desc) {
        if (!desc) return {nombre:desc,cod:'',pendiente:true};
        if (/^G\d+$/.test(desc)) {
            const id=parseInt(desc.replace('G','')),res=resultadosGlobal[id];
            if (!res) return {nombre:`W${id}`,cod:'',pendiente:true};
            const p=eliminatorios.find(x=>x.id===id)||partidosGlobal.find(x=>x.id===id);
            if (!p) return {nombre:`W${id}`,cod:'',pendiente:true};
            const lR=resolverEq(p.local),vR=resolverEq(p.visitante);
            return res.GolesLocal>res.GolesVisitante?lR:res.GolesLocal<res.GolesVisitante?vR:{nombre:`W${id}`,cod:'',pendiente:true};
        }
        if (/^Perdedor G\d+$/.test(desc)) {
            const id=parseInt(desc.replace('Perdedor G','')),res=resultadosGlobal[id];
            if (!res) return {nombre:`RU${id}`,cod:'',pendiente:true};
            const p=eliminatorios.find(x=>x.id===id);
            if (!p) return {nombre:`RU${id}`,cod:'',pendiente:true};
            const lR=resolverEq(p.local),vR=resolverEq(p.visitante);
            return res.GolesLocal<res.GolesVisitante?lR:res.GolesLocal>res.GolesVisitante?vR:{nombre:`RU${id}`,cod:'',pendiente:true};
        }
        const m1=desc.match(/^1° Grupo ([A-L])$/);
        if (m1){const t=tablaGlobal[m1[1]];return t&&t[0]?{nombre:t[0].nombre,cod:t[0].cod,pendiente:false}:{nombre:`1${m1[1]}`,cod:'',pendiente:true};}
        const m2=desc.match(/^2° Grupo ([A-L])$/);
        if (m2){const t=tablaGlobal[m2[1]];return t&&t[1]?{nombre:t[1].nombre,cod:t[1].cod,pendiente:false}:{nombre:`2${m2[1]}`,cod:'',pendiente:true};}
        if (desc.includes('Mejor 3°')){const g=desc.replace('Mejor 3° ','').replace(/\//g,'');return {nombre:`3${g}`,cod:'',pendiente:true};}
        return {nombre:desc,cod:'',pendiente:false};
    }

    function teamLabel(desc){
        const eq=resolverEq(desc);
        return {label:(eq.cod?obtenerEmoji(eq.cod)+' ':'')+eq.nombre,pendiente:eq.pendiente};
    }

    function renderMatch(p,isFinal,isBronze){
        if(!p) return '';
        const res=resultadosGlobal[p.id];
        const loc=teamLabel(p.local),vis=teamLabel(p.visitante);
        let lC='',vC='';
        if(res){
            lC=res.GolesLocal>res.GolesVisitante?'winner':res.GolesLocal<res.GolesVisitante?'loser':'';
            vC=res.GolesVisitante>res.GolesLocal?'winner':res.GolesVisitante<res.GolesLocal?'loser':'';
        }
        const bC=isFinal?'final-match':isBronze?'bronze-match':res?'has-result':'';
        return `<div class="bk3-match" data-id="${p.id}">
            <div class="bk3-num">P${p.id}</div>
            <div class="bk3-inner">
                <div class="bk3-date">${p.fecha} · ${p.hora}</div>
                <div class="bk3-box ${bC}">
                    <div class="bk3-team ${lC} ${!res&&loc.pendiente?'pending':''}">
                        <span class="bk3-name">${escapeHTML(loc.label)}</span>
                        ${res?`<span class="bk3-score">${res.GolesLocal}</span>`:''}
                    </div>
                    <div class="bk3-team ${vC} ${!res&&vis.pendiente?'pending':''}">
                        <span class="bk3-name">${escapeHTML(vis.label)}</span>
                        ${res?`<span class="bk3-score">${res.GolesVisitante}</span>`:''}
                    </div>
                </div>
            </div>
        </div>`;
    }

    // Espaciados matemáticos exactos
    const MH  = 74;
    const GAP = 8;
    const S   = MH + GAP; // 82px

    const topR32 = 0;
    const topR16 = 41;   // S/2
    const topQF  = 123;  // S*1.5
    const gapR16 = 82;   // gap uniforme entre los 4 octavos
    const gapQF  = 246;  // gap entre QF0 y QF1

    function colHTML(title, matches, topPad, gap, isGolden, isCenter, isSF) {
        const tC = isGolden ? 'bk3-title golden' : 'bk3-title';

        if (isCenter) return `<div class="bk3-col bk3-col-center">
            <div class="${tC}">Final</div>
            <div class="bk3-slots bk3-slots-center" id="bk3-final-slot">
                <div class="bk3-final-inner" id="bk3-final-inner">
                    <div style="font-size:22px;text-align:center;margin-bottom:4px;">🏆</div>
                    ${renderMatch(final,true,false)}
                    <div style="font-size:11px;font-weight:600;color:#B8860B;text-align:center;margin-top:4px;">19 Jul · Nueva York/NJ</div>
                    ${tercero ? renderMatch(tercero,false,true) + '<div style="text-align:center;font-size:9px;color:#8B5E3C;margin-top:2px;">🥉 3er Lugar · 18 Jul · Miami</div>' : ''}
                </div>
            </div>
        </div>`;

        if (isSF) {
            const id = matches[0]?.id;
            return `<div class="bk3-col">
                <div class="${tC}">${title}</div>
                <div class="bk3-slots" id="bk3-sf-slot-${id}" style="padding-top:0;">
                    ${renderMatch(matches[0],false,false)}
                </div>
            </div>`;
        }

        let html = `<div class="bk3-col"><div class="${tC}">${title}</div><div class="bk3-slots" style="padding-top:${topPad}px;">`;
        matches.filter(Boolean).forEach((p,i) => {
            html += renderMatch(p,false,false);
            if (gap > 0 && i < matches.length-1)
                html += `<div style="height:${gap}px;flex-shrink:0;"></div>`;
        });
        return html + `</div></div>`;
    }

    const gridHTML = [
        colHTML('Dieciseisavos de final', r32L,  topR32, 0,      false, false, false),
        colHTML('Octavos de final',       r16L,  topR16, gapR16, false, false, false),
        colHTML('Cuartos de final',       qfL,   topQF,  gapQF,  false, false, false),
        colHTML('Semifinal',              [sfL], 0,      0,      false, false, true),
        colHTML('Final',                  [final],0,     0,      true,  true,  false),
        colHTML('Semifinal',              [sfR], 0,      0,      false, false, true),
        colHTML('Cuartos de final',       qfR,   topQF,  gapQF,  false, false, false),
        colHTML('Octavos de final',       r16R,  topR16, gapR16, false, false, false),
        colHTML('Dieciseisavos de final', r32R,  topR32, 0,      false, false, false),
    ].join('');

    container.innerHTML = `
    <style>
    .bk3-wrap{width:100%;overflow-x:auto;padding:.5rem 0;}
    .bk3-outer{position:relative;min-width:1320px;}
    .bk3-grid{
        display:grid;
        grid-template-columns:185px 165px 150px 138px 165px 138px 150px 165px 185px;
        align-items:start;position:relative;z-index:2;
    }
    .bk3-col{display:flex;flex-direction:column;}
    .bk3-col-center{display:flex;flex-direction:column;}
    .bk3-title{text-align:center;font-size:10px;font-weight:600;color:#7a8aa0;padding:4px 2px 10px;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;}
    .bk3-title.golden{color:#B8860B;}
    .bk3-slots{display:flex;flex-direction:column;padding:0 2px;}
    .bk3-slots-center{display:flex;flex-direction:column;padding:0 2px;}
    .bk3-final-inner{display:flex;flex-direction:column;align-items:center;}
    .bk3-match{display:flex;align-items:flex-start;position:relative;}
    .bk3-num{font-size:9px;color:#556070;min-width:22px;padding-top:16px;text-align:right;padding-right:3px;flex-shrink:0;}
    .bk3-inner{flex:1;min-width:0;}
    .bk3-date{font-size:9px;color:#7a8aa0;margin-bottom:2px;padding-left:1px;}
    .bk3-box{border:1px solid rgba(255,255,255,.13);border-radius:6px;overflow:hidden;background:rgba(255,255,255,.06);}
    .bk3-box.has-result{border-color:rgba(255,255,255,.25);}
    .bk3-box.final-match{border:1.5px solid #B8860B;box-shadow:0 0 18px rgba(184,134,11,.25);}
    .bk3-box.bronze-match{border:1.5px solid #8B5E3C;}
    .bk3-team{display:flex;justify-content:space-between;align-items:center;padding:4px 7px;font-size:11px;min-height:25px;color:#cdd6e0;border-bottom:1px solid rgba(255,255,255,.05);gap:3px;font-family:"Twemoji Mozilla","Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif;}
    .bk3-team:last-child{border-bottom:none;}
    .bk3-team.winner{background:rgba(22,136,63,.15);color:#2ecc71;font-weight:600;}
    .bk3-team.loser{opacity:.35;}
    .bk3-team.pending{color:#3a4a5a;font-style:italic;font-size:10px;}
    .bk3-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .bk3-score{font-weight:700;font-size:12px;min-width:13px;text-align:right;flex-shrink:0;}
    .bk3-svg{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1;overflow:visible;}
    .bk3-leyenda{display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;font-size:.78rem;color:#7a8aa0;align-items:center;}
    .bk3-ley{display:flex;align-items:center;gap:.4rem;}
    .bk3-ley-box{width:12px;height:12px;border-radius:3px;flex-shrink:0;}
    .bk3-bronze-wrap{margin-top:1.5rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,.07);text-align:center;}
    .bk3-bronze-title{font-size:11px;color:#7a8aa0;margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em;}
    </style>

    <div class="bk3-leyenda">
        <div class="bk3-ley"><div class="bk3-ley-box" style="background:rgba(22,136,63,.25);border:1px solid #16883f;"></div>Ganador</div>
        <div class="bk3-ley"><div class="bk3-ley-box" style="border:1.5px solid #B8860B;"></div>Final</div>
        <div class="bk3-ley"><div class="bk3-ley-box" style="border:1px solid rgba(255,255,255,.2);opacity:.5;"></div>Por definir</div>
    </div>
    <div class="bk3-wrap">
        <div class="bk3-outer" id="bk3outer">
            <svg class="bk3-svg" id="bk3svg"></svg>
            <div class="bk3-grid" id="bk3grid">${gridHTML}</div>
        </div>
    </div>
    `;

    requestAnimationFrame(() => posicionarDinamico());
}

function posicionarDinamico() {
    const outer = document.getElementById('bk3outer');
    if (!outer) return;
    const oRect = outer.getBoundingClientRect();

    function getMatchMid(id) {
        const el = outer.querySelector(`[data-id="${id}"] .bk3-box`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
            x: r.left - oRect.left, y: r.top - oRect.top,
            w: r.width, h: r.height,
            midY: r.top - oRect.top + r.height/2,
            right: r.right - oRect.left,
            left:  r.left  - oRect.left,
        };
    }

    // ── Centrar SF izquierda entre QF97 y QF98 ──
    function centrarMatch(matchId, refId1, refId2, slotSelector) {
        const r1 = getMatchMid(refId1), r2 = getMatchMid(refId2);
        const slot = outer.querySelector(slotSelector);
        const matchEl = outer.querySelector(`[data-id="${matchId}"]`);
        if (!r1 || !r2 || !slot || !matchEl) return;

        const targetMidY  = (r1.midY + r2.midY) / 2;
        const slotTop     = slot.getBoundingClientRect().top - oRect.top;
        const matchH      = matchEl.getBoundingClientRect().height;
        const marginTop   = Math.max(0, targetMidY - slotTop - matchH/2);
        matchEl.style.marginTop = marginTop + 'px';
    }

    centrarMatch(101, 97, 98, `#bk3-sf-slot-101`);
    centrarMatch(102, 99, 100, `#bk3-sf-slot-102`);

    // ── Centrar Final entre SF101 y SF102 (después de centrar SF) ──
    requestAnimationFrame(() => {
        const sf1 = getMatchMid(101), sf2 = getMatchMid(102);
        const finalEl = outer.querySelector('[data-id="104"]');
        const finalSlot = outer.querySelector('#bk3-final-inner');
        if (!sf1 || !sf2 || !finalEl || !finalSlot) return;

        const targetMidY = (sf1.midY + sf2.midY) / 2;
        const slotTop    = finalSlot.getBoundingClientRect().top - oRect.top;
        const finalH     = finalEl.getBoundingClientRect().height;
        const marginTop  = Math.max(0, targetMidY - slotTop - finalH/2 - 30); // -30 por el trofeo
        finalEl.style.marginTop = marginTop + 'px';

        // ── Dibujar líneas SVG ──
        drawConnectors();
    });
}

function drawConnectors() {
    const svg   = document.getElementById('bk3svg');
    const outer = document.getElementById('bk3outer');
    if (!svg || !outer) return;

    const oRect = outer.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${oRect.width} ${oRect.height}`);

    const LC = 'rgba(255,255,255,0.18)';
    const SW = 1;
    let paths = '';

    function getMatchMid(id) {
        const el = outer.querySelector(`[data-id="${id}"] .bk3-box`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
            midY:  r.top  - oRect.top + r.height/2,
            right: r.right - oRect.left,
            left:  r.left  - oRect.left,
        };
    }

    function hLine(x1,x2,y){ paths+=`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${LC}" stroke-width="${SW}"/>`; }
    function vLine(x,y1,y2){ paths+=`<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${LC}" stroke-width="${SW}"/>`; }

    function connectLeft(id1, id2, idNext) {
        const a1=getMatchMid(id1), a2=getMatchMid(id2), b=getMatchMid(idNext);
        if (!a1||!a2||!b) return;
        const midX = a1.right + (b.left - a1.right)*0.5;
        hLine(a1.right, midX, a1.midY);
        hLine(a2.right, midX, a2.midY);
        vLine(midX, a1.midY, a2.midY);
        hLine(midX, b.left, b.midY);
    }

    function connectRight(id1, id2, idNext) {
        const a1=getMatchMid(id1), a2=getMatchMid(id2), b=getMatchMid(idNext);
        if (!a1||!a2||!b) return;
        const midX = b.right + (a1.left - b.right)*0.5;
        hLine(a1.left, midX, a1.midY);
        hLine(a2.left, midX, a2.midY);
        vLine(midX, a1.midY, a2.midY);
        hLine(b.right, midX, b.midY);
    }

    // Lado izquierdo
    connectLeft(74, 77, 89);
    connectLeft(73, 75, 90);
    connectLeft(83, 84, 93);
    connectLeft(81, 82, 94);
    connectLeft(89, 90, 97);
    connectLeft(93, 94, 98);
    connectLeft(97, 98, 101);

    // Lado derecho
    connectRight(76, 78, 91);
    connectRight(79, 80, 92);
    connectRight(86, 88, 95);
    connectRight(85, 87, 96);
    connectRight(91, 92, 99);
    connectRight(95, 96, 100);
    connectRight(99, 100, 102);

    // SF → Final
    const sf1=getMatchMid(101), sf2=getMatchMid(102), fin=getMatchMid(104);
    if (sf1&&fin) {
        const midX = sf1.right + (fin.left - sf1.right)*0.5;
        hLine(sf1.right, midX, sf1.midY);
        vLine(midX, sf1.midY, fin.midY);
        hLine(midX, fin.left, fin.midY);
    }
    if (sf2&&fin) {
        const midX = fin.right + (sf2.left - fin.right)*0.5;
        hLine(sf2.left, midX, sf2.midY);
        vLine(midX, sf2.midY, fin.midY);
        hLine(fin.right, midX, fin.midY);
    }

    svg.innerHTML = paths;
}

function posicionarDinamico() {
    const outer = document.getElementById('bk3outer');
    if (!outer) return;
    const oRect = outer.getBoundingClientRect();

    function getMatchMid(id) {
        const el = outer.querySelector(`[data-id="${id}"] .bk3-box`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
            x: r.left - oRect.left, y: r.top - oRect.top,
            w: r.width, h: r.height,
            midY: r.top - oRect.top + r.height/2,
            right: r.right - oRect.left,
            left:  r.left  - oRect.left,
        };
    }

    // ── Centrar SF izquierda entre QF97 y QF98 ──
    function centrarMatch(matchId, refId1, refId2, slotSelector) {
        const r1 = getMatchMid(refId1), r2 = getMatchMid(refId2);
        const slot = outer.querySelector(slotSelector);
        const matchEl = outer.querySelector(`[data-id="${matchId}"]`);
        if (!r1 || !r2 || !slot || !matchEl) return;

        const targetMidY  = (r1.midY + r2.midY) / 2;
        const slotTop     = slot.getBoundingClientRect().top - oRect.top;
        const matchH      = matchEl.getBoundingClientRect().height;
        const marginTop   = Math.max(0, targetMidY - slotTop - matchH/2);
        matchEl.style.marginTop = marginTop + 'px';
    }

    centrarMatch(101, 97, 98, `#bk3-sf-slot-101`);
    centrarMatch(102, 99, 100, `#bk3-sf-slot-102`);

    // ── Centrar Final entre SF101 y SF102 (después de centrar SF) ──
    requestAnimationFrame(() => {
        const sf1 = getMatchMid(101), sf2 = getMatchMid(102);
        const finalEl = outer.querySelector('[data-id="104"]');
        const finalSlot = outer.querySelector('#bk3-final-inner');
        if (!sf1 || !sf2 || !finalEl || !finalSlot) return;

        const targetMidY = (sf1.midY + sf2.midY) / 2;
        const slotTop    = finalSlot.getBoundingClientRect().top - oRect.top;
        const finalH     = finalEl.getBoundingClientRect().height;
        const marginTop  = Math.max(0, targetMidY - slotTop - finalH/2 - 30); // -30 por el trofeo
        finalEl.style.marginTop = marginTop + 'px';

        // ── Dibujar líneas SVG ──
        drawConnectors();
    });
}

function drawConnectors() {
    const svg   = document.getElementById('bk3svg');
    const outer = document.getElementById('bk3outer');
    if (!svg || !outer) return;

    const oRect = outer.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${oRect.width} ${oRect.height}`);

    const LC = 'rgba(255,255,255,0.18)';
    const SW = 1;
    let paths = '';

    function getMatchMid(id) {
        const el = outer.querySelector(`[data-id="${id}"] .bk3-box`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
            midY:  r.top  - oRect.top + r.height/2,
            right: r.right - oRect.left,
            left:  r.left  - oRect.left,
        };
    }

    function hLine(x1,x2,y){ paths+=`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${LC}" stroke-width="${SW}"/>`; }
    function vLine(x,y1,y2){ paths+=`<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${LC}" stroke-width="${SW}"/>`; }

    function connectLeft(id1, id2, idNext) {
        const a1=getMatchMid(id1), a2=getMatchMid(id2), b=getMatchMid(idNext);
        if (!a1||!a2||!b) return;
        const midX = a1.right + (b.left - a1.right)*0.5;
        hLine(a1.right, midX, a1.midY);
        hLine(a2.right, midX, a2.midY);
        vLine(midX, a1.midY, a2.midY);
        hLine(midX, b.left, b.midY);
    }

    function connectRight(id1, id2, idNext) {
        const a1=getMatchMid(id1), a2=getMatchMid(id2), b=getMatchMid(idNext);
        if (!a1||!a2||!b) return;
        const midX = b.right + (a1.left - b.right)*0.5;
        hLine(a1.left, midX, a1.midY);
        hLine(a2.left, midX, a2.midY);
        vLine(midX, a1.midY, a2.midY);
        hLine(b.right, midX, b.midY);
    }

    // Lado izquierdo
    connectLeft(74, 77, 89);
    connectLeft(73, 75, 90);
    connectLeft(83, 84, 93);
    connectLeft(81, 82, 94);
    connectLeft(89, 90, 97);
    connectLeft(93, 94, 98);
    connectLeft(97, 98, 101);

    // Lado derecho
    connectRight(76, 78, 91);
    connectRight(79, 80, 92);
    connectRight(86, 88, 95);
    connectRight(85, 87, 96);
    connectRight(91, 92, 99);
    connectRight(95, 96, 100);
    connectRight(99, 100, 102);

    // SF → Final
    const sf1=getMatchMid(101), sf2=getMatchMid(102), fin=getMatchMid(104);
    if (sf1&&fin) {
        const midX = sf1.right + (fin.left - sf1.right)*0.5;
        hLine(sf1.right, midX, sf1.midY);
        vLine(midX, sf1.midY, fin.midY);
        hLine(midX, fin.left, fin.midY);
    }
    if (sf2&&fin) {
        const midX = fin.right + (sf2.left - fin.right)*0.5;
        hLine(sf2.left, midX, sf2.midY);
        vLine(midX, sf2.midY, fin.midY);
        hLine(fin.right, midX, fin.midY);
    }

    svg.innerHTML = paths;
}

function drawConnectors() {
    const svg    = document.getElementById('bk3svg');
    const outer  = document.getElementById('bk3outer');
    if (!svg || !outer) return;

    const oRect  = outer.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${oRect.width} ${oRect.height}`);

    const lineColor = 'rgba(255,255,255,0.15)';
    const stroke    = 1;
    let paths       = '';

    function getMatchMid(id) {
        const el = outer.querySelector(`[data-id="${id}"] .bk3-box`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
            x: r.left - oRect.left,
            y: r.top  - oRect.top,
            w: r.width,
            h: r.height,
            midY: r.top - oRect.top + r.height / 2,
            right: r.right - oRect.left,
            left:  r.left  - oRect.left,
        };
    }

    function hLine(x1,x2,y) {
        paths += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${lineColor}" stroke-width="${stroke}"/>`;
    }
    function vLine(x,y1,y2) {
        paths += `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${lineColor}" stroke-width="${stroke}"/>`;
    }

    // Conectar pares de matches de ronda A → ronda B (lado izquierdo)
    // Línea: desde right de A1, horizontal hasta mitad del gap, vertical al midY de A2, horizontal hasta left de B
    function connectPairLeft(idA1, idA2, idB) {
        const a1 = getMatchMid(idA1), a2 = getMatchMid(idA2), b = getMatchMid(idB);
        if (!a1||!a2||!b) return;
        const midX = a1.right + (b.left - a1.right) * 0.5;
        hLine(a1.right, midX, a1.midY);
        hLine(a2.right, midX, a2.midY);
        vLine(midX, a1.midY, a2.midY);
        hLine(midX, b.left, b.midY);
    }

    // Lado derecho: desde left de A hacia B
    function connectPairRight(idA1, idA2, idB) {
        const a1 = getMatchMid(idA1), a2 = getMatchMid(idA2), b = getMatchMid(idB);
        if (!a1||!a2||!b) return;
        const midX = b.right + (a1.left - b.right) * 0.5;
        hLine(a1.left, midX, a1.midY);
        hLine(a2.left, midX, a2.midY);
        vLine(midX, a1.midY, a2.midY);
        hLine(b.right, midX, b.midY);
    }

    // ── Lado izquierdo ──
    // R32 → R16
    connectPairLeft(74, 77, 89);
    connectPairLeft(73, 75, 90);
    connectPairLeft(83, 84, 93);
    connectPairLeft(81, 82, 94);
    // R16 → QF
    connectPairLeft(89, 90, 97);
    connectPairLeft(93, 94, 98);
    // QF → SF
    connectPairLeft(97, 98, 101);

    // ── Lado derecho ──
    // R32 → R16
    connectPairRight(76, 78, 91);
    connectPairRight(79, 80, 92);
    connectPairRight(86, 88, 95);
    connectPairRight(85, 87, 96);
    // R16 → QF
    connectPairRight(91, 92, 99);
    connectPairRight(95, 96, 100);
    // QF → SF
    connectPairRight(99, 100, 102);

    // ── SF → Final ──
    const sf1 = getMatchMid(101), sf2 = getMatchMid(102), fin = getMatchMid(104);
    if (sf1 && fin) {
        const midX = sf1.right + (fin.left - sf1.right) * 0.5;
        hLine(sf1.right, midX, sf1.midY);
        hLine(midX, fin.left, fin.midY);
        vLine(midX, sf1.midY, fin.midY);
    }
    if (sf2 && fin) {
        const midX = fin.right + (sf2.left - fin.right) * 0.5;
        hLine(sf2.left, midX, sf2.midY);
        hLine(fin.right, midX, fin.midY);
        vLine(midX, sf2.midY, fin.midY);
    }

    svg.innerHTML = paths;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function obtenerEmoji(cod) {
    if (!cod) return '';
    const c = cod.toUpperCase().trim();
    if (c === 'GB-ENG') return '🏴󠁧󠁢󠁥󠁮󠁧󠁿';
    if (c === 'GB-SCT') return '🏴󠁧󠁢󠁳󠁣󠁴󠁿';
    if (c === 'GB-WLS') return '🏴󠁧󠁢󠁷󠁬󠁳󠁿';
    if (c.length !== 2)  return '';
    const [a, b] = c.split('');
    return String.fromCodePoint(0x1F1E6+a.charCodeAt(0)-65, 0x1F1E6+b.charCodeAt(0)-65);
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}