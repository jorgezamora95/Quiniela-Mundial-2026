-- Usuarios
CREATE TABLE usuarios (
    id_usuario          SERIAL PRIMARY KEY,
    nombre              VARCHAR(100) NOT NULL,
    correo              VARCHAR(150) NOT NULL UNIQUE,
    password_hash       VARCHAR(255) NOT NULL,
    pregunta_seguridad  VARCHAR(255),
    respuesta_seguridad_hash VARCHAR(255),
    foto_url            VARCHAR(500),
    activo              BOOLEAN DEFAULT TRUE,
    fecha_registro      TIMESTAMP DEFAULT NOW()
);

-- Códigos de invitación
CREATE TABLE codigos_invitacion (
    id_codigo   SERIAL PRIMARY KEY,
    codigo      VARCHAR(100) NOT NULL UNIQUE,
    utilizado   BOOLEAN DEFAULT FALSE,
    fecha_uso   TIMESTAMP,
    id_usuario  INT REFERENCES usuarios(id_usuario)
);

-- Paquetes
CREATE TABLE paquetes (
    id_paquete   SERIAL PRIMARY KEY,
    nombre       VARCHAR(50)    NOT NULL,
    precio       DECIMAL(10,2)  NOT NULL,
    goles        INT            NOT NULL,
    max_partidos INT            NOT NULL,
    descripcion  VARCHAR(255)
);

INSERT INTO paquetes (nombre, precio, goles, max_partidos, descripcion) VALUES
('Premium',  1000.00, 110, 104, 'Acceso total a los 104 partidos'),

-- Suscripciones
CREATE TABLE suscripciones (
    id_suscripcion   SERIAL PRIMARY KEY,
    id_usuario       INT NOT NULL REFERENCES usuarios(id_usuario),
    id_paquete       INT NOT NULL REFERENCES paquetes(id_paquete),
    goles_restantes  INT NOT NULL,
    activa           BOOLEAN DEFAULT TRUE,
    fecha_activacion TIMESTAMP DEFAULT NOW(),
    notas            VARCHAR(255)
);

-- Partidos desbloqueados
CREATE TABLE partidos_desbloqueados (
    id_desbloqueo        SERIAL PRIMARY KEY,
    id_usuario           INT NOT NULL REFERENCES usuarios(id_usuario),
    partido_id           INT NOT NULL,
    modificaciones_usadas INT DEFAULT 0,
    goles_gastados       INT DEFAULT 1,
    fecha_desbloqueo     TIMESTAMP DEFAULT NOW(),
    UNIQUE (id_usuario, partido_id)
);

-- Quinielas
CREATE TABLE quinielas (
    id_quiniela      SERIAL PRIMARY KEY,
    id_usuario       INT NOT NULL UNIQUE REFERENCES usuarios(id_usuario),
    estatus          VARCHAR(20) DEFAULT 'Borrador',
    fecha_actualizacion TIMESTAMP DEFAULT NOW()
);

-- Pronósticos
CREATE TABLE pronosticos (
    id_pronostico   SERIAL PRIMARY KEY,
    id_usuario      INT NOT NULL REFERENCES usuarios(id_usuario),
    partido_id      INT NOT NULL,
    goles_local     INT NOT NULL DEFAULT 0,
    goles_visitante INT NOT NULL DEFAULT 0,
    UNIQUE (id_usuario, partido_id)
);

-- Resultados reales
CREATE TABLE resultados_reales (
    id_resultado    SERIAL PRIMARY KEY,
    partido_id      INT NOT NULL UNIQUE,
    goles_local     INT NOT NULL,
    goles_visitante INT NOT NULL
);

-- Puntajes
CREATE TABLE puntajes (
    id_puntaje      SERIAL PRIMARY KEY,
    id_usuario      INT NOT NULL UNIQUE REFERENCES usuarios(id_usuario),
    puntos_totales  INT DEFAULT 0
);

-- Pronósticos campeón
CREATE TABLE pronosticos_campeon (
    id_pronostico    SERIAL PRIMARY KEY,
    id_usuario       INT NOT NULL UNIQUE REFERENCES usuarios(id_usuario),
    seleccion_campeon VARCHAR(100) NOT NULL,
    goles_local      INT,
    goles_visitante  INT,
    fecha_registro   TIMESTAMP DEFAULT NOW(),
    fecha_actualizacion TIMESTAMP
);

-- Resultado campeón real
CREATE TABLE resultado_campeon (
    id_resultado      SERIAL PRIMARY KEY,
    seleccion_campeon VARCHAR(100) NOT NULL,
    goles_local       INT NOT NULL,
    goles_visitante   INT NOT NULL,
    fecha_registro    TIMESTAMP DEFAULT NOW()
);

-- Bolsa acumulada
CREATE TABLE bolsa (
    id_pago     SERIAL PRIMARY KEY,
    id_usuario  INT NOT NULL REFERENCES usuarios(id_usuario),
    monto       DECIMAL(10,2) NOT NULL,
    concepto    VARCHAR(255),
    fecha_pago  TIMESTAMP DEFAULT NOW()
);

-- Ganadores finales
CREATE TABLE ganadores_finales (
    id_ganador        SERIAL PRIMARY KEY,
    id_usuario        INT NOT NULL REFERENCES usuarios(id_usuario),
    posicion          INT NOT NULL,
    puntos            INT NOT NULL,
    porcentaje_premio DECIMAL(5,2) NOT NULL,
    monto_premio      DECIMAL(10,2) NOT NULL,
    fecha_revelo      TIMESTAMP DEFAULT NOW()
);

-- Config quiniela
CREATE TABLE config_quiniela (
    clave  VARCHAR(50) PRIMARY KEY,
    valor  VARCHAR(255) NOT NULL
);

INSERT INTO config_quiniela (clave, valor) VALUES
('MundialFinalizado',   '0'),
('GanadoresRevelados',  '0');

-- Resultados pendientes (API-Sports)
CREATE TABLE resultados_pendientes (
    id_pendiente      SERIAL PRIMARY KEY,
    fixture_id        INT NOT NULL,
    local_nombre      VARCHAR(100) NOT NULL,
    visitante_nombre  VARCHAR(100) NOT NULL,
    goles_local       INT NOT NULL,
    goles_visitante   INT NOT NULL,
    fecha_partido     TIMESTAMP NOT NULL,
    validado          BOOLEAN DEFAULT FALSE,
    fecha_validacion  TIMESTAMP,
    partido_id        INT
);

-- Tokens (sistema anterior — por compatibilidad)
CREATE TABLE tokens (
    id_token         SERIAL PRIMARY KEY,
    id_usuario       INT NOT NULL REFERENCES usuarios(id_usuario),
    tipo             VARCHAR(10) NOT NULL,
    partido_id       INT,
    activo           BOOLEAN DEFAULT TRUE,
    fecha_activacion TIMESTAMP DEFAULT NOW(),
    monto            DECIMAL(10,2),
    notas            VARCHAR(255)
);
