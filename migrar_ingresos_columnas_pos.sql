-- =====================================================
-- MIGRACIÓN: Agregar columnas faltantes a "ingresos"
--             para que el módulo POS (entrega de pedidos)
--             pueda registrar ingresos correctamente.
--
-- Ejecutar UNA SOLA VEZ en la base de datos del BACKEND.
-- Es seguro relanzar: todas las sentencias usan IF NOT EXISTS.
-- =====================================================

BEGIN;

-- 1. business_id: para asociar el ingreso al negocio del usuario
ALTER TABLE "public"."ingresos"
    ADD COLUMN IF NOT EXISTS "business_id" INTEGER;

CREATE INDEX IF NOT EXISTS idx_ingresos_business_id
    ON "public"."ingresos"("business_id");

-- 2. comprobante_url: URL del comprobante (puede quedar vacío en POS)
ALTER TABLE "public"."ingresos"
    ADD COLUMN IF NOT EXISTS "comprobante_url" TEXT DEFAULT '';

-- 3. persona_id: FK al cliente en la tabla personas
ALTER TABLE "public"."ingresos"
    ADD COLUMN IF NOT EXISTS "persona_id" INTEGER
    REFERENCES "public"."personas"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ingresos_persona_id
    ON "public"."ingresos"("persona_id");

-- 4. pedido_id: FK al pedido que generó este ingreso
ALTER TABLE "public"."ingresos"
    ADD COLUMN IF NOT EXISTS "pedido_id" INTEGER
    REFERENCES "public"."pedidos"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ingresos_pedido_id
    ON "public"."ingresos"("pedido_id");

COMMIT;

-- =====================================================
-- VERIFICACIÓN (ejecutar manualmente luego del COMMIT)
-- =====================================================
/*
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'ingresos'
ORDER BY ordinal_position;
*/
