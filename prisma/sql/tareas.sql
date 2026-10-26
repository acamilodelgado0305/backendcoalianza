-- TAREAS (tablero tipo Trello) + avisos al celular (Web Push)
-- ------------------------------------------------------------
-- Proyectos (tableros) → listas → tarjetas, con etiquetas por proyecto,
-- subtareas, comentarios, adjuntos y fecha de vencimiento con recordatorio.
-- Todo cuelga del negocio activo (business_id del token), igual que el resto
-- del BACKEND.
--
-- Solo agrega tablas nuevas: no toca nada existente. Se puede correr más de
-- una vez (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS tareas_tableros (
    id           SERIAL PRIMARY KEY,
    business_id  INT          NOT NULL,
    nombre       VARCHAR(120) NOT NULL,
    descripcion  TEXT,
    color        VARCHAR(7)   NOT NULL DEFAULT '#1d4ed8',
    icono        VARCHAR(16),                       -- emoji del proyecto
    posicion     DOUBLE PRECISION NOT NULL DEFAULT 0,
    favorito     BOOLEAN      NOT NULL DEFAULT false,
    archivado    BOOLEAN      NOT NULL DEFAULT false,
    created_by   INT,
    created_at   TIMESTAMPTZ  DEFAULT now(),
    updated_at   TIMESTAMPTZ  DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tareas_tableros_business ON tareas_tableros (business_id);

CREATE TABLE IF NOT EXISTS tareas_listas (
    id          SERIAL PRIMARY KEY,
    tablero_id  INT          NOT NULL REFERENCES tareas_tableros(id) ON DELETE CASCADE,
    nombre      VARCHAR(120) NOT NULL,
    posicion    DOUBLE PRECISION NOT NULL DEFAULT 0,
    -- Lista de cierre ("✅ Hecho"): lo que entra aquí queda completado.
    es_final    BOOLEAN      NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ  DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tareas_listas_tablero ON tareas_listas (tablero_id);

CREATE TABLE IF NOT EXISTS tareas_etiquetas (
    id          SERIAL PRIMARY KEY,
    tablero_id  INT         NOT NULL REFERENCES tareas_tableros(id) ON DELETE CASCADE,
    nombre      VARCHAR(60) NOT NULL DEFAULT '',
    color       VARCHAR(7)  NOT NULL,
    posicion    DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tareas_etiquetas_tablero ON tareas_etiquetas (tablero_id);

CREATE TABLE IF NOT EXISTS tareas_tarjetas (
    id               SERIAL PRIMARY KEY,
    tablero_id       INT          NOT NULL REFERENCES tareas_tableros(id) ON DELETE CASCADE,
    lista_id         INT          NOT NULL REFERENCES tareas_listas(id)   ON DELETE CASCADE,
    titulo           VARCHAR(500) NOT NULL,
    descripcion      TEXT,
    posicion         DOUBLE PRECISION NOT NULL DEFAULT 0,
    fecha_inicio     DATE,
    -- Vencimiento. Sin hora (vence_con_hora = false) se guarda a las 9:00 de
    -- Colombia de ese día y solo cuenta como vencida cuando el día termina.
    vence_at         TIMESTAMPTZ,
    vence_con_hora   BOOLEAN      NOT NULL DEFAULT true,
    -- Minutos antes del vencimiento para avisar al celular (NULL = sin aviso).
    recordatorio_min INT,
    recordado_at     TIMESTAMPTZ,                   -- cuándo salió el aviso (evita repetirlo)
    -- Tarea que se repite (clases, pagos…): {frecuencia, cada, dias, hasta, lista_id}.
    -- Al completarla, o cuando pasa su fecha, se crea sola la siguiente.
    repeticion       JSONB,
    repetida_at      TIMESTAMPTZ,                   -- ya se creó la siguiente de la serie
    serie_id         INT,                           -- id de la primera tarjeta de la serie
    completada       BOOLEAN      NOT NULL DEFAULT false,
    completada_at    TIMESTAMPTZ,
    archivada        BOOLEAN      NOT NULL DEFAULT false,
    created_by       INT,
    created_by_name  VARCHAR(120),
    created_at       TIMESTAMPTZ  DEFAULT now(),
    updated_at       TIMESTAMPTZ  DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tareas_tarjetas_tablero ON tareas_tarjetas (tablero_id, lista_id);
CREATE INDEX IF NOT EXISTS idx_tareas_tarjetas_vence   ON tareas_tarjetas (vence_at) WHERE NOT completada AND NOT archivada;
CREATE INDEX IF NOT EXISTS idx_tareas_tarjetas_repite  ON tareas_tarjetas (vence_at) WHERE repeticion IS NOT NULL AND repetida_at IS NULL;

CREATE TABLE IF NOT EXISTS tareas_tarjeta_etiquetas (
    tarjeta_id   INT NOT NULL REFERENCES tareas_tarjetas(id)  ON DELETE CASCADE,
    etiqueta_id  INT NOT NULL REFERENCES tareas_etiquetas(id) ON DELETE CASCADE,
    PRIMARY KEY (tarjeta_id, etiqueta_id)
);
CREATE INDEX IF NOT EXISTS idx_tareas_tarjeta_etiquetas_etiqueta ON tareas_tarjeta_etiquetas (etiqueta_id);

CREATE TABLE IF NOT EXISTS tareas_subtareas (
    id          SERIAL PRIMARY KEY,
    tarjeta_id  INT          NOT NULL REFERENCES tareas_tarjetas(id) ON DELETE CASCADE,
    texto       VARCHAR(500) NOT NULL,
    hecha       BOOLEAN      NOT NULL DEFAULT false,
    posicion    DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tareas_subtareas_tarjeta ON tareas_subtareas (tarjeta_id);

CREATE TABLE IF NOT EXISTS tareas_comentarios (
    id          SERIAL PRIMARY KEY,
    tarjeta_id  INT          NOT NULL REFERENCES tareas_tarjetas(id) ON DELETE CASCADE,
    user_id     INT,
    user_name   VARCHAR(120),
    texto       TEXT         NOT NULL,
    created_at  TIMESTAMPTZ  DEFAULT now(),
    updated_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tareas_comentarios_tarjeta ON tareas_comentarios (tarjeta_id);

CREATE TABLE IF NOT EXISTS tareas_adjuntos (
    id          SERIAL PRIMARY KEY,
    tarjeta_id  INT          NOT NULL REFERENCES tareas_tarjetas(id) ON DELETE CASCADE,
    tipo        VARCHAR(10)  NOT NULL DEFAULT 'archivo',   -- 'archivo' (GCS) | 'enlace'
    nombre      VARCHAR(255) NOT NULL,
    url         TEXT         NOT NULL,
    mime        VARCHAR(100),
    bytes       INT,
    created_by  INT,
    created_at  TIMESTAMPTZ  DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tareas_adjuntos_tarjeta ON tareas_adjuntos (tarjeta_id);

-- Celulares/navegadores que aceptaron notificaciones. Un dispositivo = un
-- endpoint del servicio de push (Apple, Google, Mozilla…).
CREATE TABLE IF NOT EXISTS push_suscripciones (
    id               SERIAL PRIMARY KEY,
    user_id          INT          NOT NULL,
    endpoint         TEXT         NOT NULL UNIQUE,
    p256dh           TEXT         NOT NULL,
    auth             TEXT         NOT NULL,
    dispositivo      VARCHAR(200),
    created_at       TIMESTAMPTZ  DEFAULT now(),
    ultimo_envio_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_push_suscripciones_user ON push_suscripciones (user_id);

-- Qué avisos de Tareas quiere cada usuario en cada negocio.
CREATE TABLE IF NOT EXISTS tareas_avisos (
    user_id         INT       NOT NULL,
    business_id     INT       NOT NULL,
    activo          BOOLEAN   NOT NULL DEFAULT true,
    resumen_diario  BOOLEAN   NOT NULL DEFAULT true,
    hora_resumen    SMALLINT  NOT NULL DEFAULT 7,      -- hora de Colombia (0-23)
    ultimo_resumen  DATE,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, business_id)
);
