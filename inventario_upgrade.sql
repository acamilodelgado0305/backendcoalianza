-- Migración: Nuevas columnas para inventario (BACKEND / negocio)
-- Ejecutar una sola vez en la BD del BACKEND (puerto 8080)

-- Columna business_id (si no existe aún)
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS business_id INTEGER;

-- Nuevos campos de producto/servicio
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS tipo_item           VARCHAR(20)     DEFAULT 'producto';
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS sku                 VARCHAR(100);
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS precio_compra_unitario NUMERIC(12,2) DEFAULT 0;
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS stock_minimo        INTEGER         DEFAULT 0;
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS categoria           VARCHAR(100);
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS impuesto            NUMERIC(5,2)    DEFAULT 0;
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS imagen_url          TEXT;

-- Permitir NULL en columnas de stock para que los servicios puedan tener stock_null
ALTER TABLE inventario ALTER COLUMN cantidad        DROP NOT NULL;
ALTER TABLE inventario ALTER COLUMN unidades_por_caja DROP NOT NULL;

-- Índice para búsqueda por negocio
CREATE INDEX IF NOT EXISTS idx_inventario_business_id ON inventario(business_id);

-- Marcar ítems existentes como 'producto' si no tienen tipo
UPDATE inventario SET tipo_item = 'producto' WHERE tipo_item IS NULL;
