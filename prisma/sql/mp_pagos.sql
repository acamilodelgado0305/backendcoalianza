-- Pagos de Mercado Pago (Checkout Pro) que llegan por el webhook.
-- Ejecutar una vez en la base de datos PostgreSQL del backend POS (controlapos).
--
-- payment_id UNIQUE es lo que hace idempotente la entrega: Mercado Pago repite
-- los avisos (y a veces manda dos a la vez), pero un mismo pago nunca genera dos
-- ventas ni dos correos.
--
-- estado_proceso:
--   RECIBIDO       aviso guardado, aún sin procesar (o pago no aprobado todavía)
--   PROCESANDO     un webhook lo tiene tomado en este momento
--   ENTREGADO      venta registrada, lead GANADO y certificado + carnet enviados
--   SIN_LEAD       no hay lead con ese documento → revisar a mano y reprocesar
--   MONTO_DISTINTO el monto/moneda no coincide con el precio → revisar a mano
--   SIN_CORREO     no hay correo al cual enviar los documentos
--   ERROR          falló algo (correo, base de datos…) → Mercado Pago reintenta
--
-- ingreso_id y correo_enviado_at marcan los dos pasos por separado: si el correo
-- falla después de registrar la venta, el reintento solo vuelve a enviar el correo.

CREATE TABLE IF NOT EXISTS mp_pagos (
  id                 SERIAL PRIMARY KEY,
  payment_id         VARCHAR(40)  NOT NULL UNIQUE,
  external_reference VARCHAR(64),
  producto           VARCHAR(30),
  status             VARCHAR(30),
  status_detail      VARCHAR(80),
  monto              NUMERIC(12, 2),
  moneda             VARCHAR(5),
  payer_email        VARCHAR(150),
  estado_proceso     VARCHAR(20)  NOT NULL DEFAULT 'RECIBIDO',
  intentos           INTEGER      NOT NULL DEFAULT 0,
  lead_id            INTEGER,
  ingreso_id         BIGINT,
  correo_enviado_a   VARCHAR(150),
  correo_enviado_at  TIMESTAMP,
  error              TEXT,
  raw                JSONB,
  created_at         TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mp_pagos_estado    ON mp_pagos (estado_proceso);
CREATE INDEX IF NOT EXISTS idx_mp_pagos_reference ON mp_pagos (external_reference);
