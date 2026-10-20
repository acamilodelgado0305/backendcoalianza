-- Pagos Nequi que n8n confirma leyendo el correo de notificación de Nequi.
-- Ejecutar una vez en la base de datos PostgreSQL del backend POS (controlapos).
--
-- n8n solo lee el correo y manda { referencia, documento, monto }; el backend
-- hace el resto (lead GANADO, venta en `ingresos`, Purchase a Meta y documentos
-- por correo). `referencia` UNIQUE es lo que hace idempotente la entrega: el mismo
-- correo procesado dos veces nunca genera dos ventas ni dos correos.
--
-- estado_proceso:
--   RECIBIDO       aviso guardado, aún sin procesar
--   PROCESANDO     una petición lo tiene tomado en este momento
--   ENTREGADO      venta registrada, lead GANADO y documentos enviados
--   SIN_LEAD       no hay lead con ese documento (se reintenta si n8n lo reenvía)
--   SIN_CORREO     el lead no tiene correo válido (se reintenta si n8n lo reenvía)
--   MONTO_DISTINTO el monto no corresponde a ningún curso → revisar y reprocesar
--   YA_REGISTRADO  la venta ya estaba registrada a mano → revisar y reprocesar
--   ERROR          falló algo (correo, base de datos…) → se reintenta
--
-- ingreso_id, capi_estado y correo_enviado_at marcan cada paso por separado: si el
-- correo falla después de registrar la venta, el reintento solo vuelve a enviarlo.
-- capi_estado: PENDIENTE (falta mandar el Purchase) | ENVIADO | OMITIDO (el lead ya
-- estaba GANADO, así que Meta ya recibió su Purchase, o la CAPI está apagada).

CREATE TABLE IF NOT EXISTS nequi_pagos (
  id                SERIAL PRIMARY KEY,
  referencia        VARCHAR(64)    NOT NULL UNIQUE,
  documento         VARCHAR(20)    NOT NULL,
  monto             NUMERIC(12, 2) NOT NULL,
  fecha_pago        TIMESTAMPTZ,
  estado_proceso    VARCHAR(20)    NOT NULL DEFAULT 'RECIBIDO',
  intentos          INTEGER        NOT NULL DEFAULT 0,
  lead_id           INTEGER,
  inventario_id     INTEGER,
  ingreso_id        BIGINT,
  capi_estado       VARCHAR(20),
  correo_enviado_a  VARCHAR(150),
  correo_enviado_at TIMESTAMP,
  error             TEXT,
  raw               JSONB,
  created_at        TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP      NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nequi_pagos_estado    ON nequi_pagos (estado_proceso);
CREATE INDEX IF NOT EXISTS idx_nequi_pagos_documento ON nequi_pagos (documento);
