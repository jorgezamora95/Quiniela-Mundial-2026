let partidosGlobal = [];
let temporizadorMensaje;

document.addEventListener("DOMContentLoaded", () => {
    inicializarQuiniela();
    configurarBotonGuardar();
    iniciarTemporizador();
    cargarPerfilUsuario();
});

async function inicializarQuiniela() {
    const selectGrupo = document.querySelector("#selectGrupo");
    const idUsuario = localStorage.getItem("idUsuario");
    const nombreGuardado = localStorage.getItem("Nombre");

    if (!idUsuario && !window.location.href.includes("login.html")) {
        window.location.href = "login.html";
        return;
    }

    const txtNombreSidebar = document.querySelector(".user-data h3") || document.getElementById("txtNombreUsuarioSidebar");
    if (txtNombreSidebar) {
        txtNombreSidebar.textContent =
            nombreGuardado && nombreGuardado !== "null" && nombreGuardado !== "undefined"
                ? nombreGuardado
                : "Participante";
    }

    try {
        const responsePartidos = await fetch("./data/partidos.json");
        partidosGlobal = await responsePartidos.json();

        const responseDB = await fetch(`http://localhost:3000/api/obtener-quiniela/${idUsuario}`);
        const datosDB = await responseDB.json();

        renderizarPartidos(partidosGlobal, datosDB.pronosticos);

        if (datosDB.ok && datosDB.estatus === "Enviada") {
            bloquearTodaLaInterfaz();
            const mensaje = document.querySelector("#mensajeQuiniela");
            if (mensaje) {
                mensaje.textContent = "🔒 Tu quiniela está enviada y bloqueada de forma definitiva.";
                mensaje.className = "mensaje error";
                mensaje.style.opacity = "1";
            }
        }

        if (selectGrupo) {
            selectGrupo.addEventListener("change", (e) => {
                const grupoSeleccionado = e.target.value;
                if (grupoSeleccionado === "TODOS") {
                    renderizarPartidos(partidosGlobal, datosDB.pronosticos);
                } else {
                    const partidosFiltrados = partidosGlobal.filter(p => p.grupo === grupoSeleccionado);
                    renderizarPartidos(partidosFiltrados, datosDB.pronosticos);
                }
                if (datosDB.estatus === "Enviada") bloquearTodaLaInterfaz();
            });
        }
    } catch (error) {
        console.error("Error al inicializar los datos:", error);
    }
}

function renderizarPartidos(partidosAMostrar, pronosticosGuardados = []) {
    const container = document.querySelector("#quinielaContainer");
    if (!container) return;
    container.textContent = "";

    partidosAMostrar.forEach((partido) => {
        const horaLimpia = partido.hora.replace(" hrs", "");
        const fechaPartido = new Date(`${partido.fecha} ${horaLimpia}:00`);
        const ahora = new Date();

        const recordGuardado = pronosticosGuardados.find(p => p.PartidoId === partido.id);
        const golesLocalActual = partido.golesLocal !== undefined ? partido.golesLocal : (recordGuardado ? recordGuardado.GolesLocal : "0");
        const golesVisitanteActual = partido.golesVisitante !== undefined ? partido.golesVisitante : (recordGuardado ? recordGuardado.GolesVisitante : "0");

        const row = document.createElement("div");
        row.className = "quiniela-row";
        row.dataset.id = partido.id;

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
        inputLocal.value = golesLocalActual;
        inputLocal.addEventListener("input", (e) => {
            partido.golesLocal = parseInt(e.target.value) || 0;
        });

        const dashSpan = document.createElement("span");
        dashSpan.className = "dash";
        dashSpan.textContent = "-";

        const inputVisitante = document.createElement("input");
        inputVisitante.type = "number";
        inputVisitante.className = "goles-visitante";
        inputVisitante.min = "0";
        inputVisitante.value = golesVisitanteActual;
        inputVisitante.addEventListener("input", (e) => {
            partido.golesVisitante = parseInt(e.target.value) || 0;
        });

        if (ahora >= fechaPartido) {
            inputLocal.readOnly = true;
            inputVisitante.readOnly = true;
            row.style.opacity = "0.4";
        }

        predictionDiv.append(inputLocal, dashSpan, inputVisitante);

        const dateDiv = document.createElement("div");
        dateDiv.className = "date";
        const clockIcon = document.createElement("i");
        clockIcon.className = "bx bx-time-five";
        const dateTextDiv = document.createElement("div");
        dateTextDiv.className = "date-text";
        const dayText = document.createTextNode(partido.fecha);
        const br = document.createElement("br");
        const hourSmall = document.createElement("small");
        hourSmall.textContent = partido.hora;
        dateTextDiv.append(dayText, br, hourSmall);
        dateDiv.append(clockIcon, dateTextDiv);

        row.append(matchDiv, predictionDiv, dateDiv);
        container.appendChild(row);
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
    return String.fromCodePoint(
        0x1F1E6 + a.charCodeAt(0) - 65,
        0x1F1E6 + b.charCodeAt(0) - 65
    );
}

function configurarBotonGuardar() {
    const btnGuardar = document.querySelector(".btn-guardar");
    const btnEnviar = document.querySelector(".btn-enviar");

    if (btnGuardar) btnGuardar.addEventListener("click", () => procesarQuiniela("guardar"));

    if (btnEnviar) {
        btnEnviar.addEventListener("click", () => {
            const seguro = confirm("⚠️ ¿Estás seguro de enviar la quiniela definitiva?\nUna vez enviada, NO podrás modificar ningún marcador.");
            if (seguro) procesarQuiniela("enviar");
        });
    }
}

async function procesarQuiniela(accionDestino) {
    const mensaje = document.querySelector("#mensajeQuiniela");
    const idUsuario = parseInt(localStorage.getItem("idUsuario"));

    if (!idUsuario) {
        mensaje.textContent = "Error: Sesión expirada.";
        mensaje.className = "mensaje error";
        return;
    }

    const filasPantalla = document.querySelectorAll(".quiniela-row[data-id]");
    filasPantalla.forEach(fila => {
        const id = parseInt(fila.dataset.id);
        const inputLocal = fila.querySelector(".goles-local");
        const inputVisitante = fila.querySelector(".goles-visitante");
        if (!inputLocal || !inputVisitante) return;
        const gLocal = parseInt(inputLocal.value) || 0;
        const gVisitante = parseInt(inputVisitante.value) || 0;
        const partidoMatch = partidosGlobal.find(p => p.id === id);
        if (partidoMatch) {
            partidoMatch.golesLocal = gLocal;
            partidoMatch.golesVisitante = gVisitante;
        }
    });

    const pronosticos = partidosGlobal.map(partido => ({
        partidoId: parseInt(partido.id),
        golesLocal: parseInt(partido.golesLocal) || 0,
        golesVisitante: parseInt(partido.golesVisitante) || 0
    }));

    try {
        const response = await fetch("http://localhost:3000/api/guardar-quiniela", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idUsuario, accion: accionDestino, pronosticos })
        });

        const data = await response.json();
        clearTimeout(temporizadorMensaje);
        mensaje.style.opacity = "1";
        mensaje.textContent = data.message;
        mensaje.className = data.ok ? "mensaje success" : "mensaje error";

        if (data.ok && data.isFinal) {
            bloquearTodaLaInterfaz();
        } else {
            temporizadorMensaje = setTimeout(() => {
                mensaje.style.opacity = "0";
                setTimeout(() => { mensaje.textContent = ""; }, 500);
            }, 4000);
        }
    } catch (error) {
        mensaje.style.opacity = "1";
        mensaje.textContent = "Error de comunicación con el servidor.";
        mensaje.className = "mensaje error";
    }
}

function bloquearTodaLaInterfaz() {
    const inputs = document.querySelectorAll(".prediction input");
    const botones = document.querySelectorAll(".btn-guardar, .btn-enviar");

    inputs.forEach(input => { input.readOnly = true; });
    botones.forEach(boton => {
        boton.disabled = true;
        boton.style.opacity = "0.25";
        boton.style.cursor = "not-allowed";
        boton.style.pointerEvents = "none";
    });

    const btnGuardar = document.querySelector(".btn-guardar");
    if (btnGuardar) btnGuardar.textContent = "🔒 Quiniela Bloqueada";
}

// ✅ FIX: Variable 'minutes' eliminada — era una variable global accidental
function iniciarTemporizador() {
    const fechaMundial = new Date("June 11, 2026 13:00:00").getTime();
    const contenedorReloj = document.querySelector(".timer-card h3");

    if (!contenedorReloj) return;

    const intervalo = setInterval(() => {
        const ahora = new Date().getTime();
        const distancia = fechaMundial - ahora;

        if (distancia < 0) {
            clearInterval(intervalo);
            contenedorReloj.textContent = "00 : 00 : 00 : 00";
            return;
        }

        const dias = Math.floor(distancia / (1000 * 60 * 60 * 24));
        const horas = Math.floor((distancia % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutos = Math.floor((distancia % (1000 * 60 * 60)) / (1000 * 60));
        const segundos = Math.floor((distancia % (1000 * 60)) / 1000);

        const fDias = dias < 10 ? "0" + dias : dias;
        const fHoras = horas < 10 ? "0" + horas : horas;
        const fMinutos = minutos < 10 ? "0" + minutos : minutos; // ✅ Sin 'minutes ='
        const fSegundos = segundos < 10 ? "0" + segundos : segundos;

        contenedorReloj.textContent = `${fDias} : ${fHoras} : ${fMinutos} : ${fSegundos}`;
    }, 1000);
}

function cargarPerfilUsuario() {
    const nombreHeader = document.querySelector(".profile-header h3");
    const nombreGuardado = localStorage.getItem("Nombre");
    const fotoGuardada = localStorage.getItem("FotoUrl");

    if (nombreHeader && nombreGuardado) {
        nombreHeader.textContent = nombreGuardado;
    }

    const imgSidebar = document.getElementById("imgAvatarSidebar");
    if (imgSidebar && fotoGuardada && fotoGuardada !== "") {
        imgSidebar.src = fotoGuardada;
        imgSidebar.onerror = () => { imgSidebar.src = "./img/user-icon.png"; };
    }
}
