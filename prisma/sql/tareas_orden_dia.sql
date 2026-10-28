-- Orden manual de las tareas dentro de cada día en el Resumen de Tareas.
-- NULL = se ordena por la hora (vence_at). Se guarda como una clave numérica
-- en la misma escala que vence_at (milisegundos), por eso al cambiar la fecha
-- o la hora vuelve a NULL y la tarea retoma su lugar por hora.
ALTER TABLE tareas_tarjetas ADD COLUMN IF NOT EXISTS orden_dia DOUBLE PRECISION;
