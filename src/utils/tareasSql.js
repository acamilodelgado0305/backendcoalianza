// src/utils/tareasSql.js — condiciones de fecha de Tareas (alias de tabla `c`).
// Una tarjeta sin hora solo cuenta como vencida cuando su día ya terminó en Colombia.
import { Prisma } from '@prisma/client';

export const SQL_VENCIDA = Prisma.sql`(c.vence_at IS NOT NULL AND CASE WHEN c.vence_con_hora THEN c.vence_at < now()
    ELSE (c.vence_at AT TIME ZONE 'America/Bogota')::date < (now() AT TIME ZONE 'America/Bogota')::date END)`;

export const SQL_VENCE_HOY = Prisma.sql`(c.vence_at IS NOT NULL
    AND (c.vence_at AT TIME ZONE 'America/Bogota')::date = (now() AT TIME ZONE 'America/Bogota')::date)`;
