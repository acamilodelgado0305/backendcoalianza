-- ============================================================
-- MIGRACIÓN COMPLETA: Clientes de ingresos → personas
--                     + vincular ingresos a personas y pedidos
--
-- PASOS:
--   1. Agregar columnas persona_id y pedido_id a ingresos
--   2. Migrar clientes únicos de ingresos → personas
--   3. Vincular ingresos a su persona por numero_documento
--   4. Vincular ingresos generados por pedidos a su pedido
--
-- Ejecutar UNA SOLA VEZ. Es seguro relanzar (IF NOT EXISTS / ON CONFLICT).
-- ============================================================

BEGIN;

-- ============================================================
-- PASO 1: Agregar columnas FK a ingresos
-- ============================================================
ALTER TABLE "public"."ingresos"
    ADD COLUMN IF NOT EXISTS "persona_id" INT REFERENCES "public"."personas"(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS "pedido_id"  INT REFERENCES "public"."pedidos"(id)  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ingresos_persona_id ON "public"."ingresos"("persona_id");
CREATE INDEX IF NOT EXISTS idx_ingresos_pedido_id  ON "public"."ingresos"("pedido_id");

-- ============================================================
-- PASO 2: Insertar en personas los clientes únicos de ingresos
--         que aún no existen en personas (por documento + negocio)
-- ============================================================
--
-- Tomamos UN registro representativo por (numeroDeDocumento, business_id)
-- para no duplicar cuando un cliente aparece en varios ingresos.
--
INSERT INTO "public"."personas" (
    tipo_documento,
    numero_documento,
    nombre,
    apellido,
    email,
    celular,
    tipo,
    usuario,
    business_id,
    created_at,
    updated_at
)
SELECT DISTINCT ON (i."numeroDeDocumento", i.business_id)
    LEFT(COALESCE(NULLIF(i."tipoDocumento", ''), 'CC'), 20) AS tipo_documento,
    i."numeroDeDocumento"                           AS numero_documento,
    COALESCE(NULLIF(i."nombre", ''), 'Sin nombre') AS nombre,
    COALESCE(i."apellido", '')                      AS apellido,
    NULLIF(i."customer_email", '')                  AS email,
    ''                                              AS celular,   -- ingresos no tiene teléfono
    'CLIENTE'                                       AS tipo,
    i."usuario"                                     AS usuario,
    i.business_id,
    i."createdAt"::timestamp                         AS created_at,
    i."createdAt"::timestamp                         AS updated_at
FROM "public"."ingresos" i
WHERE
    -- Solo documentos válidos (descartar placeholders)
    i."numeroDeDocumento" IS NOT NULL
    AND i."numeroDeDocumento" NOT IN ('0', '', 'null')
    -- Solo si ese documento aún no existe en personas para ese negocio
    AND NOT EXISTS (
        SELECT 1 FROM "public"."personas" p
        WHERE p.numero_documento = i."numeroDeDocumento"
          AND p.business_id      = i.business_id
    )
ORDER BY i."numeroDeDocumento", i.business_id, i."createdAt" ASC
ON CONFLICT DO NOTHING;

-- ============================================================
-- PASO 3: Vincular cada ingreso a su persona por numero_documento
-- ============================================================
UPDATE "public"."ingresos" i
SET persona_id = p.id
FROM "public"."personas" p
WHERE p.numero_documento = i."numeroDeDocumento"
  AND p.business_id      = i.business_id
  AND i.persona_id IS NULL;

-- ============================================================
-- PASO 4: Vincular ingresos generados por pedidos (PEDIDO-{id}-...)
--         a su pedido_id (backfill del payment_reference)
-- ============================================================
UPDATE "public"."ingresos" i
SET pedido_id = p.id
FROM "public"."pedidos" p
WHERE i."payment_reference" LIKE 'PEDIDO-' || p.id || '-%'
  AND i.pedido_id IS NULL;

COMMIT;

-- ============================================================
-- VERIFICACIÓN — ejecutar manualmente después de la migración
-- ============================================================
/*
SELECT
    COUNT(*)                                                AS total_ingresos,
    COUNT(*) FILTER (WHERE persona_id IS NOT NULL)          AS vinculados_a_persona,
    COUNT(*) FILTER (WHERE persona_id IS NULL)              AS sin_persona,
    COUNT(*) FILTER (WHERE pedido_id  IS NOT NULL)          AS vinculados_a_pedido
FROM "public"."ingresos";

-- Clientes migrados desde ingresos (tienen celular = NULL como indicador)
SELECT COUNT(*) AS clientes_migrados_desde_ingresos
FROM "public"."personas"
WHERE celular IS NULL AND tipo = 'CLIENTE';
*/
