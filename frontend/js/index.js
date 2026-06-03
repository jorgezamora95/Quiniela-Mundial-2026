document.addEventListener("DOMContentLoaded", () => {
    inicializarDashboard();
});

async function inicializarDashboard() {
    const miNombre = localStorage.getItem("Nombre");
    const idUsuario = localStorage.getItem("idUsuario");

    // Redirección de seguridad si intentan saltarse el login
    if (!idUsuario && !window.location.href.includes("login.html")) {
        window.location.href = "login.html";
        return;
    }

    // Personalizar el mensaje de bienvenida con su nombre real
    const txtBienvenida = document.getElementById("txtBienvenidaDashboard");
    if (txtBienvenida && miNombre) {
        txtBienvenida.textContent = `👋 ¡Hola, ${miNombre}!`;
    }

    try {
        // Consumimos tu API global de posiciones
        const response = await fetch(`${API_URL}/api/tabla-general`);
        const data = await response.json();

        if (!data.ok) return;
        const ranking = data.ranking;

        // Convertimos el ID de la sesión a número entero
        const miIdUsuario = parseInt(idUsuario);

        // 🚩 CORRECCIÓN: Buscamos tu fila en el ranking usando el ID numérico único de SQL
        const miIndex = ranking.findIndex(u => parseInt(u.IdUsuario) === miIdUsuario);
        
        // Rellenamos las 4 tarjetas superiores con los datos reales cruzados de SQL Server
        const txtPosicion = document.getElementById("dashPosicion");
        if (txtPosicion) {
            txtPosicion.textContent = miIndex !== -1 ? `#${ranking[miIndex].PosicionReal}` : "#1"; 
        }

        const txtPuntos = document.getElementById("dashPuntos");
        if (txtPuntos) {
            txtPuntos.textContent = miIndex !== -1 ? ranking[miIndex].Puntos : "0";
        }

        const txtAciertos = document.getElementById("dashAciertos");
        if (txtAciertos) {
            txtAciertos.textContent = miIndex !== -1 ? ranking[miIndex].Aciertos : "0";
        }

        const txtParticipantes = document.getElementById("dashParticipantes");
        if (txtParticipantes) {
            txtParticipantes.textContent = ranking.length;
        }

        // 📋 RENDERIZADO INLINE DE LAS FILAS DE LA TABLA GENERAL COMPACTA
        const contenedorFilas = document.getElementById("dashTablaRows");
        if (contenedorFilas) {
            contenedorFilas.textContent = ""; // Limpieza nativa anti-XSS

            ranking.forEach((usuario, index) => {
                const fila = document.createElement("div");
                fila.className = "fila-usuario-avanzada";
                fila.style.gridTemplateColumns = "50px 2fr 1fr"; 

                // 🚩 CORRECCIÓN: Iluminamos tu propia fila en verde usando comparación por ID numérico
                if (parseInt(usuario.IdUsuario) === miIdUsuario) {
                    fila.className += " usuario-actual-resaltado";
                }

                // Posición o Medalla para el top 3
                const colRango = document.createElement("div");
                if ((index + 1) <= 3) {
                    const medalla = document.createElement("div");
                    medalla.className = `medal-badge badge-${index + 1}`;
                    medalla.textContent = (index + 1) === 1 ? "🥇" : (index + 1) === 2 ? "🥈" : "🥉";
                    colRango.appendChild(medalla);
                } else {
                    const numeroNormal = document.createElement("span");
                    numeroNormal.className = "badge-default";
                    numeroNormal.style.paddingLeft = "0.4rem";
                    numeroNormal.textContent = index + 1;
                    colRango.appendChild(numeroNormal);
                }

                // Nombre del participante
                const colNombre = document.createElement("div");
                colNombre.style.fontWeight = "bold";
                colNombre.textContent = usuario.Nombre;

                // Puntaje total
                const colPuntos = document.createElement("div");
                colPuntos.className = "text-right";
                colPuntos.textContent = `${usuario.Puntos} pts`;

                fila.append(colRango, colNombre, colPuntos);
                contenedorFilas.appendChild(fila);
            });
        }

    } catch (error) {
        console.error("Error al cargar los datos del Dashboard:", error);
    }
}
