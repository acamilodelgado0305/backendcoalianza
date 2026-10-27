// src/services/tareasAvisos.js
//
// Avisos de Tareas que salen solos (los dispara un cron cada pocos minutos:
// POST /api/tareas/avisos/procesar, ver tareasRoutes.js):
//  1. Recordatorio de una tarjeta: X minutos antes de que venza.
//  2. Resumen del día: a la hora elegida (7 a. m. por defecto), lo vencido y
//     lo que vence hoy en todos los proyectos del usuario.
//
// Los dos son idempotentes: la fila se marca (recordado_at / ultimo_resumen)
// en el mismo UPDATE que la elige, así que dos crons a la vez nunca mandan el
// mismo aviso dos veces.
import prisma from '../prisma.js';
import { enviarPushAUsuarios, pushDisponible } from './pushService.js';
import { generarRepeticionesVencidas } from './tareasRepeticion.js';

const ZONA = 'America/Bogota';

const diaCO = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(d);
const horaCO = (d) => new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, hour: 'numeric', minute: '2-digit' }).format(d);

/** "Vence hoy a las 3:00 p. m." / "Vence en 25 min" / "Vence mañana" */
export const describirVence = (vence, conHora, ahora = new Date()) => {
    const fecha = new Date(vence);
    const dia = diaCO(fecha);
    const cuando = dia === diaCO(ahora)
        ? 'hoy'
        : dia === diaCO(new Date(ahora.getTime() + 86400000))
            ? 'mañana'
            : new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'short' }).format(fecha);
    if (!conHora) return `Vence ${cuando}`;
    const minutos = Math.round((fecha - ahora) / 60000);
    if (minutos <= 0) return `Venció ${cuando === 'hoy' ? 'hoy' : cuando} a las ${horaCO(fecha)}`;
    if (minutos < 60) return `Vence en ${minutos} min (${horaCO(fecha)})`;
    return `Vence ${cuando} a las ${horaCO(fecha)}`;
};

const urlTarjeta = (t) => `/inicio/tareas?tablero=${t.tablero_id}&tarjeta=${t.id}`;

// Las tareas son de cada usuario: el aviso va solo a su dueño, si tiene los
// avisos encendidos.
const avisosActivos = async (userId) => {
    const fila = await prisma.tareas_avisos.findUnique({ where: { user_id: userId }, select: { activo: true } });
    return !!fila?.activo;
};

const enviarRecordatorios = async () => {
    // Solo tarjetas vivas cuyo momento de aviso ya llegó. Las que vencieron hace
    // más de 12 h no se avisan (p. ej. al poner una fecha vieja por error).
    const tarjetas = await prisma.$queryRaw`
        UPDATE tareas_tarjetas c
           SET recordado_at = now()
          FROM tareas_tableros t
         WHERE c.tablero_id = t.id
           AND NOT c.completada AND NOT c.archivada AND NOT t.archivado
           AND c.vence_at IS NOT NULL
           AND c.recordatorio_min IS NOT NULL
           AND c.recordado_at IS NULL
           AND c.vence_at - make_interval(mins => c.recordatorio_min) <= now()
           AND c.vence_at > now() - interval '12 hours'
     RETURNING c.id, c.tablero_id, c.titulo, c.vence_at, c.vence_con_hora,
               t.user_id, t.nombre AS tablero, t.icono`;

    let enviados = 0;
    const activos = new Map();
    for (const t of tarjetas) {
        if (!activos.has(t.user_id)) activos.set(t.user_id, await avisosActivos(t.user_id));
        if (!activos.get(t.user_id)) continue;
        const r = await enviarPushAUsuarios([t.user_id], {
            title: `⏰ ${t.titulo}`,
            body: `${describirVence(t.vence_at, t.vence_con_hora)} · ${t.icono ? `${t.icono} ` : ''}${t.tablero}`,
            url: urlTarjeta(t),
            tag: `tarjeta-${t.id}`,
        });
        enviados += r.enviados;
    }
    return { tarjetas: tarjetas.length, enviados };
};

const enviarResumenes = async () => {
    // Ventana de 3 horas desde la hora elegida: si el cron estuvo caído toda la
    // mañana no llega un "tu día" a las 4 de la tarde.
    const elegidos = await prisma.$queryRaw`
        UPDATE tareas_avisos a
           SET ultimo_resumen = (now() AT TIME ZONE 'America/Bogota')::date
         WHERE a.activo AND a.resumen_diario
           AND EXTRACT(HOUR FROM now() AT TIME ZONE 'America/Bogota') BETWEEN a.hora_resumen AND a.hora_resumen + 2
           AND (a.ultimo_resumen IS NULL OR a.ultimo_resumen < (now() AT TIME ZONE 'America/Bogota')::date)
     RETURNING a.user_id`;

    let enviados = 0;
    for (const { user_id } of elegidos) {
        const pendientes = await prisma.$queryRaw`
            SELECT c.id, c.titulo,
                   CASE WHEN c.vence_con_hora THEN c.vence_at < now()
                        ELSE (c.vence_at AT TIME ZONE 'America/Bogota')::date < (now() AT TIME ZONE 'America/Bogota')::date
                   END AS vencida
              FROM tareas_tarjetas c
              JOIN tareas_tableros t ON t.id = c.tablero_id
             WHERE t.user_id = ${user_id} AND NOT t.archivado
               AND NOT c.completada AND NOT c.archivada
               AND c.vence_at IS NOT NULL
               AND (c.vence_at AT TIME ZONE 'America/Bogota')::date <= (now() AT TIME ZONE 'America/Bogota')::date
               AND c.vence_at > now() - interval '60 days'
             ORDER BY c.vence_at ASC
             LIMIT 50`;
        if (!pendientes.length) continue;

        const vencidas = pendientes.filter((p) => p.vencida).length;
        const hoy = pendientes.length - vencidas;
        const partes = [];
        if (hoy) partes.push(`${hoy} para hoy`);
        if (vencidas) partes.push(`${vencidas} vencida${vencidas === 1 ? '' : 's'}`);
        const titulos = pendientes.slice(0, 3).map((p) => p.titulo).join(' · ');

        const r = await enviarPushAUsuarios([user_id], {
            title: `☀️ Tu día: ${partes.join(' y ')}`,
            body: pendientes.length > 3 ? `${titulos} y ${pendientes.length - 3} más` : titulos,
            url: '/inicio/tareas',
            tag: 'resumen',
        });
        enviados += r.enviados;
    }
    return { usuarios: elegidos.length, enviados };
};

export const procesarAvisosTareas = async () => {
    // Primero nacen las repeticiones (la clase del jueves), así su aviso puede
    // salir en esta misma vuelta.
    const repeticiones = await generarRepeticionesVencidas();
    // Sin llaves VAPID no se marca nada como avisado: cuando se configuren,
    // los recordatorios pendientes salen en la siguiente vuelta.
    if (!pushDisponible()) return { ok: false, repeticiones, motivo: 'Faltan las llaves VAPID' };
    const recordatorios = await enviarRecordatorios();
    const resumenes = await enviarResumenes();
    return { ok: true, repeticiones, recordatorios, resumenes };
};
