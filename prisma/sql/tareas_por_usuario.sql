-- TAREAS: de cada USUARIO, no del negocio (2026-10-26)
-- ----------------------------------------------------
-- Los proyectos y tareas son personales: se ven en cualquier negocio en que
-- esté la sesión y nadie más del negocio los ve. `business_id` se queda solo
-- como referencia de dónde se creó el proyecto.
-- Los avisos (resumen del día) pasan a ser uno por usuario.
-- Se puede correr más de una vez.

ALTER TABLE tareas_tableros ADD COLUMN IF NOT EXISTS user_id INT;
UPDATE tareas_tableros SET user_id = created_by WHERE user_id IS NULL;
ALTER TABLE tareas_tableros ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE tareas_tableros ALTER COLUMN business_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tareas_tableros_user ON tareas_tableros (user_id);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'tareas_avisos' AND column_name = 'business_id') THEN
        ALTER TABLE tareas_avisos DROP CONSTRAINT IF EXISTS tareas_avisos_pkey;
        -- Si alguien tenía avisos en varios negocios, queda la fila más reciente.
        DELETE FROM tareas_avisos a USING tareas_avisos b
         WHERE a.user_id = b.user_id AND a.updated_at < b.updated_at;
        ALTER TABLE tareas_avisos DROP COLUMN business_id;
        ALTER TABLE tareas_avisos ADD PRIMARY KEY (user_id);
    END IF;
END $$;
