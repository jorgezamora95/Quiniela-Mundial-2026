const API_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"        // Live Server
    : `http://${window.location.hostname}:3000`; // Producción