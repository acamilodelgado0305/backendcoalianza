// src/services/tareasRepeticion.js
//
// Crea la siguiente ocurrencia de una tarea que se repite. Se llama:
//  - al completarla (check o al soltarla en la lista de cierre), y
//  - desde el cron, cuando su fecha ya pasó sin completarse: la clase del
//    jueves aparece aunque no se haya marcado la del martes (que queda vencida
//    como señal).
//
// `repetida_at` se marca en el mismo UPDATE que la reclama, así nunca nacen
// dos "siguientes" de la misma tarjeta.
import prisma from '../prisma.js';
import { siguienteFecha } from '../utils/repeticion.js';
import { SQL_VENCIDA } from '../utils/tareasSql.js';

const PASO = 1024;

// Dónde nace la siguiente: la lista elegida en la regla, si no la de la
// tarjeta, y nunca la de cierre ("✅ Hecho").
const listaDestino = async (tarjeta, regla) => {
    const listas = await prisma.tareas_listas.findMany({
        where: { tablero_id: tarjeta.tablero_id },
        orderBy: [{ posicion: 'asc' }, { id: 'asc' }],
    });
    const abiertas = listas.filter((l) => !l.es_final);
    return abiertas.find((l) => l.id === regla.lista_id)
        || abiertas.find((l) => l.id === tarjeta.lista_id)
        || abiertas[0]
        || listas.find((l) => l.id === tarjeta.lista_id);
};

/** @returns {Promise<object|null>} la tarjeta nueva, o null si no tocaba. */
export const generarSiguiente = async (tarjetaId) => {
    const actual = await prisma.tareas_tarjetas.findUnique({ where: { id: tarjetaId } });
    if (!actual?.repeticion || actual.repetida_at || !actual.vence_at || actual.archivada) return null;

    const fecha = siguienteFecha(actual.repeticion, actual.vence_at, actual.vence_con_hora);
    const reclamada = await prisma.tareas_tarjetas.updateMany({
        where: { id: actual.id, repetida_at: null },
        data: { repetida_at: new Date() },
    });
    if (!reclamada.count || !fecha) return null; // otro la creó, o la serie terminó

    const lista = await listaDestino(actual, actual.repeticion);
    const [etiquetas, subtareas, ultima] = await Promise.all([
        prisma.tareas_tarjeta_etiquetas.findMany({ where: { tarjeta_id: actual.id } }),
        prisma.tareas_subtareas.findMany({ where: { tarjeta_id: actual.id }, orderBy: [{ posicion: 'asc' }, { id: 'asc' }] }),
        prisma.tareas_tarjetas.findFirst({ where: { lista_id: lista.id, archivada: false }, orderBy: { posicion: 'desc' }, select: { posicion: true } }),
    ]);

    return prisma.tareas_tarjetas.create({
        data: {
            tablero_id: actual.tablero_id,
            lista_id: lista.id,
            posicion: (ultima?.posicion ?? 0) + PASO,
            titulo: actual.titulo,
            descripcion: actual.descripcion,
            vence_at: fecha,
            vence_con_hora: actual.vence_con_hora,
            recordatorio_min: actual.recordatorio_min,
            repeticion: actual.repeticion,
            serie_id: actual.serie_id || actual.id,
            completada: lista.es_final,
            completada_at: lista.es_final ? new Date() : null,
            created_by: actual.created_by,
            created_by_name: actual.created_by_name,
            etiquetas: { create: etiquetas.map((e) => ({ etiqueta_id: e.etiqueta_id })) },
            subtareas: { create: subtareas.map((s) => ({ texto: s.texto, hecha: false, posicion: s.posicion })) },
        },
    });
};

/** Cron: series cuya ocurrencia actual ya venció sin completarse. */
export const generarRepeticionesVencidas = async () => {
    const pendientes = await prisma.$queryRaw`
        SELECT c.id
          FROM tareas_tarjetas c
          JOIN tareas_tableros t ON t.id = c.tablero_id
         WHERE c.repeticion IS NOT NULL AND c.repetida_at IS NULL
           AND NOT c.archivada AND NOT t.archivado
           AND ${SQL_VENCIDA}
         LIMIT 200`;
    let creadas = 0;
    for (const { id } of pendientes) {
        if (await generarSiguiente(id)) creadas += 1;
    }
    return creadas;
};
