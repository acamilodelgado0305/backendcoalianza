// src/controllers/tareasController.js
//
// TAREAS — tablero tipo Trello dentro de Rapictrl
// ------------------------------------------------
// Proyecto (tablero) → listas (columnas del kanban) → tarjetas. Cada tarjeta
// lleva etiquetas del proyecto, subtareas, comentarios, adjuntos y una fecha de
// vencimiento con recordatorio al celular (ver services/tareasAvisos.js).
//
// Todo es del USUARIO (`req.user.id`), no del negocio: sus proyectos se ven
// en cualquier negocio en que esté y nadie más los ve. Cada consulta confirma
// que el tablero es suyo antes de leer o tocar algo.
//
// Orden: listas, tarjetas, subtareas y proyectos guardan una `posicion`
// decimal. Mover algo = ponerle el promedio de sus dos vecinos, sin reescribir
// toda la lista. Si los decimales se agotan, se renumera (ver `reubicar`).
import prisma from '../prisma.js';
import { Prisma } from '@prisma/client';
import { dateOnlyStr, toDateOnly } from '../utils/fechas.js';
import { normalizarRepeticion } from '../utils/repeticion.js';
import { SQL_VENCIDA, SQL_VENCE_HOY } from '../utils/tareasSql.js';
import { uploadComprobanteToGCS, deleteComprobanteFromGCS } from '../services/gcsComprobantes.js';
import { clavePublicaPush, enviarPushAUsuarios, pushDisponible } from '../services/pushService.js';
import { procesarAvisosTareas } from '../services/tareasAvisos.js';
import { generarSiguiente } from '../services/tareasRepeticion.js';
import crypto from 'crypto';

const PASO = 1024;

// ─── Plantillas al crear un proyecto ─────────────────────────────────────────
// "Mi flujo" es el que ya se usaba en Trello (Centro de Control).
const PLANTILLAS = {
    flujo:       ['📥 Bandeja', '📌 Por hacer', '📆 Esta semana', '⚙️ En proceso', '⏳ Esperando a otros', '✅ Hecho'],
    simple:      ['Por hacer', 'En proceso', '✅ Hecho'],
    universidad: ['📚 Pendientes', '✍️ Haciendo', '📤 Entregado', '✅ Calificado'],
    vacio:       [],
};
const ETIQUETAS_BASE = [
    { nombre: 'Urgente', color: '#ef4444' },
    { nombre: 'Alta',    color: '#f97316' },
    { nombre: 'Leve',    color: '#0ea5e9' },
];
const esListaFinal = (nombre) => /✅|hecho|terminad|listo|calificado|complet/i.test(nombre);

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const limpiarColor = (c, porDefecto) => (COLOR_RE.test(String(c || '')) ? String(c).toLowerCase() : porDefecto);
const texto = (v, max) => (v === undefined ? undefined : String(v ?? '').trim().slice(0, max));

// ─── Errores ─────────────────────────────────────────────────────────────────
class ErrorTareas extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
const noEncontrado = (que) => new ErrorTareas(404, `${que} no existe o no es tuyo`);

// Envuelve cada handler: un solo lugar para la sesión sin usuario y los errores.
const handler = (fn) => async (req, res) => {
    try {
        const duenoId = Number(req.user?.id);
        if (!duenoId) return res.status(401).json({ message: 'Sesión sin usuario' });
        await fn(req, res, duenoId);
    } catch (error) {
        if (error instanceof ErrorTareas) return res.status(error.status).json({ message: error.message });
        console.error('[tareas]', req.method, req.originalUrl, error);
        res.status(500).json({ message: 'Error en Tareas', detalle: error.message });
    }
};

const idParam = (req, nombre = 'id') => {
    const n = Number(req.params[nombre]);
    if (!Number.isInteger(n) || n <= 0) throw new ErrorTareas(400, 'Identificador inválido');
    return n;
};

// ─── Pertenencia al usuario ──────────────────────────────────────────────────
const tableroDelUsuario = async (id, duenoId) => {
    const t = await prisma.tareas_tableros.findFirst({ where: { id, user_id: duenoId } });
    if (!t) throw noEncontrado('El proyecto');
    return t;
};
const listaDelUsuario = async (id, duenoId) => {
    const l = await prisma.tareas_listas.findFirst({ where: { id, tablero: { user_id: duenoId } } });
    if (!l) throw noEncontrado('La lista');
    return l;
};
const tarjetaDelUsuario = async (id, duenoId) => {
    const c = await prisma.tareas_tarjetas.findFirst({
        where: { id, tablero: { user_id: duenoId } },
        include: { lista: true },
    });
    if (!c) throw noEncontrado('La tarjeta');
    return c;
};

// ─── Orden ───────────────────────────────────────────────────────────────────
/**
 * Posición para dejar un elemento justo debajo de `despuesDe` (null = arriba
 * del todo; undefined = al final) entre `vecinos` (sin el que se mueve).
 * `modelo` + `where` sirven para renumerar si ya no caben decimales.
 */
const reubicar = async (modelo, where, idMovido, despuesDe) => {
    const leer = () => prisma[modelo].findMany({
        where: idMovido ? { ...where, NOT: { id: idMovido } } : where,
        orderBy: [{ posicion: 'asc' }, { id: 'asc' }],
        select: { id: true, posicion: true },
    });
    const calcular = (vecinos) => {
        let i = vecinos.length; // al final
        if (despuesDe === null) i = 0;
        else if (despuesDe !== undefined) {
            const k = vecinos.findIndex((v) => v.id === Number(despuesDe));
            if (k >= 0) i = k + 1;
        }
        const antes = vecinos[i - 1]?.posicion;
        const despues = vecinos[i]?.posicion;
        if (antes === undefined && despues === undefined) return { pos: PASO, ok: true };
        if (antes === undefined) return { pos: despues - PASO, ok: true };
        if (despues === undefined) return { pos: antes + PASO, ok: true };
        return { pos: (antes + despues) / 2, ok: despues - antes > 1e-6 };
    };

    let vecinos = await leer();
    let { pos, ok } = calcular(vecinos);
    if (!ok) {
        await prisma.$transaction(vecinos.map((v, k) =>
            prisma[modelo].update({ where: { id: v.id }, data: { posicion: (k + 1) * PASO } })));
        vecinos = await leer();
        ({ pos } = calcular(vecinos));
    }
    return pos;
};

// ─── Fechas ──────────────────────────────────────────────────────────────────
// Sin hora: 9:00 a. m. de Colombia de ese día (referencia de los recordatorios).
const parseVence = (vence_at, vence_con_hora) => {
    if (vence_at === undefined) return {};
    if (vence_at === null || vence_at === '') return { vence_at: null, vence_con_hora: true };
    const conHora = vence_con_hora !== false;
    if (!conHora) {
        const dia = dateOnlyStr(vence_at);
        if (!dia) throw new ErrorTareas(400, 'Fecha de vencimiento inválida');
        return { vence_at: new Date(`${dia}T09:00:00-05:00`), vence_con_hora: false };
    }
    const d = new Date(vence_at);
    if (Number.isNaN(d.getTime())) throw new ErrorTareas(400, 'Fecha de vencimiento inválida');
    return { vence_at: d, vence_con_hora: true };
};

const parseRecordatorio = (v) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 60 * 24 * 14) throw new ErrorTareas(400, 'Recordatorio inválido');
    return n;
};

// Regla de repetición del cliente → JSON para la columna (o NULL de SQL).
// La siguiente nace en la lista donde está la tarjeta (salvo la de cierre).
const parseRepeticion = (raw, venceAt, lista) => {
    if (raw === undefined) return undefined;
    const regla = normalizarRepeticion(raw, venceAt);
    if (!regla) return Prisma.DbNull;
    if (!venceAt) throw new ErrorTareas(400, 'Ponle una fecha a la tarea para que se pueda repetir');
    if (!regla.lista_id && lista && !lista.es_final) regla.lista_id = lista.id;
    return regla;
};

// Completar una tarea que se repite hace nacer la siguiente.
const siguienteSiCompleta = async (antes, despues) =>
    (despues.completada && !antes.completada && despues.repeticion ? generarSiguiente(despues.id) : null);

// ─── Serialización ───────────────────────────────────────────────────────────
const INCLUDE_RESUMEN = {
    etiquetas: { select: { etiqueta_id: true } },
    subtareas: { select: { hecha: true } },
    _count: { select: { comentarios: true, adjuntos: true } },
};

const serializarTarjeta = (c) => {
    const { etiquetas, subtareas, _count, lista, tablero, ...resto } = c;
    const out = {
        ...resto,
        fecha_inicio: dateOnlyStr(c.fecha_inicio),
        etiquetas: (etiquetas || []).map((e) => e.etiqueta_id ?? e.etiqueta?.id),
        subtareas_total: subtareas?.length ?? 0,
        subtareas_hechas: subtareas?.filter((s) => s.hecha).length ?? 0,
        comentarios: _count?.comentarios ?? 0,
        adjuntos: _count?.adjuntos ?? 0,
    };
    if (lista) out.lista = { id: lista.id, nombre: lista.nombre, es_final: lista.es_final };
    if (tablero) out.tablero = { id: tablero.id, nombre: tablero.nombre, color: tablero.color, icono: tablero.icono };
    return out;
};

const serializarPorId = async (id) => {
    if (!id) return null;
    const c = await prisma.tareas_tarjetas.findUnique({ where: { id }, include: INCLUDE_RESUMEN });
    return c ? serializarTarjeta(c) : null;
};

// ═════════════════════════════ PROYECTOS ═════════════════════════════════════

export const listarTableros = handler(async (req, res, duenoId) => {
    const archivados = req.query.archivados === '1';
    const filas = await prisma.$queryRaw`
        SELECT t.id, t.nombre, t.descripcion, t.color, t.icono, t.posicion, t.favorito, t.archivado,
               t.created_at, t.updated_at,
               COUNT(c.id) FILTER (WHERE NOT c.archivada)::int                                   AS total,
               COUNT(c.id) FILTER (WHERE NOT c.archivada AND NOT c.completada)::int              AS pendientes,
               COUNT(c.id) FILTER (WHERE NOT c.archivada AND c.completada)::int                  AS completadas,
               COUNT(c.id) FILTER (WHERE NOT c.archivada AND NOT c.completada AND ${SQL_VENCIDA})::int AS vencidas,
               COUNT(c.id) FILTER (WHERE NOT c.archivada AND NOT c.completada AND ${SQL_VENCE_HOY}
                                   AND NOT ${SQL_VENCIDA})::int                                  AS hoy,
               MAX(c.updated_at)                                                                 AS ultima_actividad
          FROM tareas_tableros t
          LEFT JOIN tareas_tarjetas c ON c.tablero_id = t.id
         WHERE t.user_id = ${duenoId} AND t.archivado = ${archivados}
         GROUP BY t.id
         ORDER BY t.favorito DESC, t.posicion ASC, t.id ASC`;
    res.json(filas);
});

export const crearTablero = handler(async (req, res, duenoId) => {
    const nombre = texto(req.body.nombre, 120);
    if (!nombre) throw new ErrorTareas(400, 'El proyecto necesita un nombre');
    const listas = PLANTILLAS[req.body.plantilla] ?? PLANTILLAS.flujo;
    const posicion = await reubicar('tareas_tableros', { user_id: duenoId }, null, undefined);

    const tablero = await prisma.tareas_tableros.create({
        data: {
            user_id: duenoId,
            business_id: Number(req.user.bid) || null,
            nombre,
            descripcion: texto(req.body.descripcion, 2000) || null,
            color: limpiarColor(req.body.color, '#1d4ed8'),
            icono: texto(req.body.icono, 16) || null,
            posicion,
            created_by: Number(req.user.id) || null,
            listas: { create: listas.map((n, i) => ({ nombre: n, posicion: (i + 1) * PASO, es_final: esListaFinal(n) && i === listas.length - 1 })) },
            etiquetas: { create: ETIQUETAS_BASE.map((e, i) => ({ ...e, posicion: (i + 1) * PASO })) },
        },
    });
    res.status(201).json(tablero);
});

export const obtenerTablero = handler(async (req, res, duenoId) => {
    const tablero = await tableroDelUsuario(idParam(req), duenoId);
    const [listas, etiquetas, tarjetas] = await Promise.all([
        prisma.tareas_listas.findMany({ where: { tablero_id: tablero.id }, orderBy: [{ posicion: 'asc' }, { id: 'asc' }] }),
        prisma.tareas_etiquetas.findMany({ where: { tablero_id: tablero.id }, orderBy: [{ posicion: 'asc' }, { id: 'asc' }] }),
        prisma.tareas_tarjetas.findMany({
            where: { tablero_id: tablero.id, archivada: req.query.archivadas === '1' },
            orderBy: [{ posicion: 'asc' }, { id: 'asc' }],
            include: INCLUDE_RESUMEN,
        }),
    ]);
    res.json({ tablero, listas, etiquetas, tarjetas: tarjetas.map(serializarTarjeta) });
});

export const actualizarTablero = handler(async (req, res, duenoId) => {
    const t = await tableroDelUsuario(idParam(req), duenoId);
    const data = { updated_at: new Date() };
    if (req.body.nombre !== undefined) {
        data.nombre = texto(req.body.nombre, 120);
        if (!data.nombre) throw new ErrorTareas(400, 'El proyecto necesita un nombre');
    }
    if (req.body.descripcion !== undefined) data.descripcion = texto(req.body.descripcion, 2000) || null;
    if (req.body.color !== undefined) data.color = limpiarColor(req.body.color, t.color);
    if (req.body.icono !== undefined) data.icono = texto(req.body.icono, 16) || null;
    if (req.body.favorito !== undefined) data.favorito = !!req.body.favorito;
    if (req.body.archivado !== undefined) data.archivado = !!req.body.archivado;
    res.json(await prisma.tareas_tableros.update({ where: { id: t.id }, data }));
});

export const moverTablero = handler(async (req, res, duenoId) => {
    const t = await tableroDelUsuario(idParam(req), duenoId);
    const posicion = await reubicar('tareas_tableros', { user_id: duenoId }, t.id, req.body.despues_de ?? null);
    res.json(await prisma.tareas_tableros.update({ where: { id: t.id }, data: { posicion } }));
});

// Borrar es definitivo: solo se permite con el proyecto ya archivado, para que
// nunca se pierda un proyecto de un toque.
export const eliminarTablero = handler(async (req, res, duenoId) => {
    const t = await tableroDelUsuario(idParam(req), duenoId);
    if (!t.archivado) throw new ErrorTareas(400, 'Primero archiva el proyecto; luego lo puedes eliminar');
    const archivos = await prisma.tareas_adjuntos.findMany({
        where: { tipo: 'archivo', tarjeta: { tablero_id: t.id } }, select: { url: true },
    });
    await prisma.tareas_tableros.delete({ where: { id: t.id } });
    await Promise.all(archivos.map((a) => deleteComprobanteFromGCS(a.url)));
    res.json({ ok: true });
});

// ═════════════════════════════ LISTAS ════════════════════════════════════════

export const crearLista = handler(async (req, res, duenoId) => {
    const t = await tableroDelUsuario(idParam(req), duenoId);
    const nombre = texto(req.body.nombre, 120);
    if (!nombre) throw new ErrorTareas(400, 'La lista necesita un nombre');
    const posicion = await reubicar('tareas_listas', { tablero_id: t.id }, null, req.body.despues_de);
    res.status(201).json(await prisma.tareas_listas.create({
        data: { tablero_id: t.id, nombre, posicion, es_final: !!req.body.es_final },
    }));
});

export const actualizarLista = handler(async (req, res, duenoId) => {
    const l = await listaDelUsuario(idParam(req), duenoId);
    const data = {};
    if (req.body.nombre !== undefined) {
        data.nombre = texto(req.body.nombre, 120);
        if (!data.nombre) throw new ErrorTareas(400, 'La lista necesita un nombre');
    }
    if (req.body.es_final !== undefined) data.es_final = !!req.body.es_final;
    const lista = await prisma.tareas_listas.update({ where: { id: l.id }, data });
    // Al volverla "lista de cierre", lo que ya estaba ahí queda completado.
    if (data.es_final && !l.es_final) {
        await prisma.tareas_tarjetas.updateMany({
            where: { lista_id: l.id, completada: false },
            data: { completada: true, completada_at: new Date(), updated_at: new Date() },
        });
    }
    res.json(lista);
});

export const moverLista = handler(async (req, res, duenoId) => {
    const l = await listaDelUsuario(idParam(req), duenoId);
    const posicion = await reubicar('tareas_listas', { tablero_id: l.tablero_id }, l.id, req.body.despues_de ?? null);
    res.json(await prisma.tareas_listas.update({ where: { id: l.id }, data: { posicion } }));
});

// ?mover_a=ID pasa las tarjetas a esa lista (al final) antes de borrar; sin él,
// las tarjetas se borran con la lista.
export const eliminarLista = handler(async (req, res, duenoId) => {
    const l = await listaDelUsuario(idParam(req), duenoId);
    const destinoId = Number(req.query.mover_a) || null;
    if (destinoId) {
        const destino = await listaDelUsuario(destinoId, duenoId);
        if (destino.id === l.id || destino.tablero_id !== l.tablero_id) throw new ErrorTareas(400, 'Lista de destino inválida');
        const tarjetas = await prisma.tareas_tarjetas.findMany({
            where: { lista_id: l.id }, orderBy: [{ posicion: 'asc' }, { id: 'asc' }], select: { id: true },
        });
        const base = await reubicar('tareas_tarjetas', { lista_id: destino.id, archivada: false }, null, undefined);
        await prisma.$transaction(tarjetas.map((c, i) => prisma.tareas_tarjetas.update({
            where: { id: c.id },
            data: {
                lista_id: destino.id, posicion: base + i * PASO, updated_at: new Date(),
                ...(destino.es_final ? { completada: true, completada_at: new Date() } : {}),
                ...(!destino.es_final && l.es_final ? { completada: false, completada_at: null } : {}),
            },
        })));
    } else {
        const archivos = await prisma.tareas_adjuntos.findMany({
            where: { tipo: 'archivo', tarjeta: { lista_id: l.id } }, select: { url: true },
        });
        await Promise.all(archivos.map((a) => deleteComprobanteFromGCS(a.url)));
    }
    await prisma.tareas_listas.delete({ where: { id: l.id } });
    res.json({ ok: true });
});

// ═════════════════════════════ ETIQUETAS ═════════════════════════════════════

export const crearEtiqueta = handler(async (req, res, duenoId) => {
    const t = await tableroDelUsuario(idParam(req), duenoId);
    const posicion = await reubicar('tareas_etiquetas', { tablero_id: t.id }, null, undefined);
    res.status(201).json(await prisma.tareas_etiquetas.create({
        data: {
            tablero_id: t.id,
            nombre: texto(req.body.nombre, 60) || '',
            color: limpiarColor(req.body.color, '#64748b'),
            posicion,
        },
    }));
});

export const actualizarEtiqueta = handler(async (req, res, duenoId) => {
    const e = await prisma.tareas_etiquetas.findFirst({ where: { id: idParam(req), tablero: { user_id: duenoId } } });
    if (!e) throw noEncontrado('La etiqueta');
    const data = {};
    if (req.body.nombre !== undefined) data.nombre = texto(req.body.nombre, 60) || '';
    if (req.body.color !== undefined) data.color = limpiarColor(req.body.color, e.color);
    res.json(await prisma.tareas_etiquetas.update({ where: { id: e.id }, data }));
});

export const eliminarEtiqueta = handler(async (req, res, duenoId) => {
    const e = await prisma.tareas_etiquetas.findFirst({ where: { id: idParam(req), tablero: { user_id: duenoId } } });
    if (!e) throw noEncontrado('La etiqueta');
    await prisma.tareas_etiquetas.delete({ where: { id: e.id } });
    res.json({ ok: true });
});

// ═════════════════════════════ TARJETAS ══════════════════════════════════════

// Etiquetas que llegan del cliente: solo valen las del mismo proyecto.
const etiquetasValidas = async (ids, tableroId) => {
    if (!Array.isArray(ids)) return null;
    const limpias = [...new Set(ids.map(Number).filter(Boolean))];
    if (!limpias.length) return [];
    const filas = await prisma.tareas_etiquetas.findMany({ where: { id: { in: limpias }, tablero_id: tableroId }, select: { id: true } });
    return filas.map((f) => f.id);
};

const leerTarjetaCompleta = async (id) => {
    const c = await prisma.tareas_tarjetas.findUnique({
        where: { id },
        include: {
            ...INCLUDE_RESUMEN,
            lista: true,
            tablero: true,
        },
    });
    const [subtareas, comentarios, adjuntos] = await Promise.all([
        prisma.tareas_subtareas.findMany({ where: { tarjeta_id: id }, orderBy: [{ posicion: 'asc' }, { id: 'asc' }] }),
        prisma.tareas_comentarios.findMany({ where: { tarjeta_id: id }, orderBy: { created_at: 'desc' } }),
        prisma.tareas_adjuntos.findMany({ where: { tarjeta_id: id }, orderBy: { created_at: 'desc' } }),
    ]);
    return { ...serializarTarjeta(c), lista_subtareas: subtareas, lista_comentarios: comentarios, lista_adjuntos: adjuntos };
};

export const crearTarjeta = handler(async (req, res, duenoId) => {
    const lista = await listaDelUsuario(idParam(req), duenoId);
    const titulo = texto(req.body.titulo, 500);
    if (!titulo) throw new ErrorTareas(400, 'La tarjeta necesita un título');

    const posicion = await reubicar('tareas_tarjetas', { lista_id: lista.id, archivada: false }, null,
        req.body.arriba ? null : undefined);
    const vence = parseVence(req.body.vence_at, req.body.vence_con_hora);
    const etiquetas = (await etiquetasValidas(req.body.etiquetas, lista.tablero_id)) || [];

    const tarjeta = await prisma.tareas_tarjetas.create({
        data: {
            tablero_id: lista.tablero_id,
            lista_id: lista.id,
            titulo,
            descripcion: texto(req.body.descripcion, 20000) || null,
            posicion,
            ...vence,
            recordatorio_min: vence.vence_at ? (parseRecordatorio(req.body.recordatorio_min) ?? null) : null,
            repeticion: parseRepeticion(req.body.repeticion ?? null, vence.vence_at, lista),
            fecha_inicio: req.body.fecha_inicio ? toDateOnly(req.body.fecha_inicio) : null,
            completada: lista.es_final,
            completada_at: lista.es_final ? new Date() : null,
            created_by: Number(req.user.id) || null,
            created_by_name: req.user.name || null,
            etiquetas: { create: etiquetas.map((etiqueta_id) => ({ etiqueta_id })) },
        },
        include: INCLUDE_RESUMEN,
    });
    res.status(201).json(serializarTarjeta(tarjeta));
});

export const obtenerTarjeta = handler(async (req, res, duenoId) => {
    const c = await tarjetaDelUsuario(idParam(req), duenoId);
    res.json(await leerTarjetaCompleta(c.id));
});

export const actualizarTarjeta = handler(async (req, res, duenoId) => {
    const c = await tarjetaDelUsuario(idParam(req), duenoId);
    const b = req.body;
    const data = { updated_at: new Date() };

    if (b.titulo !== undefined) {
        data.titulo = texto(b.titulo, 500);
        if (!data.titulo) throw new ErrorTareas(400, 'La tarjeta necesita un título');
    }
    if (b.descripcion !== undefined) data.descripcion = texto(b.descripcion, 20000) || null;
    if (b.fecha_inicio !== undefined) data.fecha_inicio = b.fecha_inicio ? toDateOnly(b.fecha_inicio) : null;

    const vence = parseVence(b.vence_at, b.vence_con_hora ?? c.vence_con_hora);
    Object.assign(data, vence);
    const recordatorio = parseRecordatorio(b.recordatorio_min);
    if (recordatorio !== undefined) data.recordatorio_min = recordatorio;
    if (vence.vence_at === null) {
        data.recordatorio_min = null;
        data.repeticion = Prisma.DbNull; // sin fecha no hay cómo repetir
    }
    const repeticion = parseRepeticion(b.repeticion, vence.vence_at !== undefined ? vence.vence_at : c.vence_at, c.lista);
    if (repeticion !== undefined && vence.vence_at !== null) {
        data.repeticion = repeticion;
        data.repetida_at = null;
    }
    // Cambió cuándo avisar: el recordatorio vuelve a quedar pendiente.
    if (vence.vence_at !== undefined || recordatorio !== undefined) data.recordado_at = null;
    // Orden manual dentro del día (Resumen). Si cambió la fecha u hora, vuelve a ordenarse por hora.
    if (b.orden_dia !== undefined) {
        const n = Number(b.orden_dia);
        data.orden_dia = b.orden_dia === null || !Number.isFinite(n) ? null : n;
    } else if (vence.vence_at !== undefined) {
        data.orden_dia = null;
    }

    if (b.completada !== undefined && !!b.completada !== c.completada) {
        data.completada = !!b.completada;
        data.completada_at = data.completada ? new Date() : null;
    }
    if (b.archivada !== undefined) {
        data.archivada = !!b.archivada;
        // Al restaurar vuelve al final de su lista.
        if (!data.archivada && c.archivada) {
            data.posicion = await reubicar('tareas_tarjetas', { lista_id: c.lista_id, archivada: false }, c.id, undefined);
        }
    }

    const etiquetas = await etiquetasValidas(b.etiquetas, c.tablero_id);
    const [despues] = await prisma.$transaction([
        prisma.tareas_tarjetas.update({ where: { id: c.id }, data }),
        ...(etiquetas ? [
            prisma.tareas_tarjeta_etiquetas.deleteMany({ where: { tarjeta_id: c.id } }),
            prisma.tareas_tarjeta_etiquetas.createMany({ data: etiquetas.map((etiqueta_id) => ({ tarjeta_id: c.id, etiqueta_id })) }),
        ] : []),
    ]);
    const siguiente = await siguienteSiCompleta(c, despues);
    res.json({ ...(await leerTarjetaCompleta(c.id)), siguiente: await serializarPorId(siguiente?.id) });
});

// Mover a otra lista (del mismo u otro proyecto del usuario) y/o reordenar.
// body: { lista_id, despues_de } — despues_de = id de la tarjeta que queda
// justo encima (null = arriba del todo).
export const moverTarjeta = handler(async (req, res, duenoId) => {
    const c = await tarjetaDelUsuario(idParam(req), duenoId);
    const destino = req.body.lista_id ? await listaDelUsuario(Number(req.body.lista_id), duenoId) : c.lista;
    const posicion = await reubicar('tareas_tarjetas', { lista_id: destino.id, archivada: false }, c.id, req.body.despues_de ?? null);

    const data = { lista_id: destino.id, tablero_id: destino.tablero_id, posicion, updated_at: new Date() };
    // Entrar a la lista de cierre completa la tarjeta; sacarla de ahí la reabre.
    if (destino.es_final && !c.lista.es_final) Object.assign(data, { completada: true, completada_at: new Date() });
    if (!destino.es_final && c.lista.es_final) Object.assign(data, { completada: false, completada_at: null });

    const ops = [prisma.tareas_tarjetas.update({ where: { id: c.id }, data })];

    // Cambió de proyecto: las etiquetas se pasan por nombre (se crean en el
    // destino las que no existan) para que no se pierda el significado.
    if (destino.tablero_id !== c.tablero_id) {
        const actuales = await prisma.tareas_tarjeta_etiquetas.findMany({ where: { tarjeta_id: c.id }, include: { etiqueta: true } });
        const delDestino = await prisma.tareas_etiquetas.findMany({ where: { tablero_id: destino.tablero_id } });
        const nuevas = [];
        for (const { etiqueta } of actuales) {
            let igual = delDestino.find((e) => e.nombre.trim().toLowerCase() === etiqueta.nombre.trim().toLowerCase() && (etiqueta.nombre || e.color === etiqueta.color));
            if (!igual) {
                igual = await prisma.tareas_etiquetas.create({
                    data: { tablero_id: destino.tablero_id, nombre: etiqueta.nombre, color: etiqueta.color, posicion: Date.now() / 1000 },
                });
                delDestino.push(igual);
            }
            nuevas.push(igual.id);
        }
        ops.push(
            prisma.tareas_tarjeta_etiquetas.deleteMany({ where: { tarjeta_id: c.id } }),
            prisma.tareas_tarjeta_etiquetas.createMany({ data: [...new Set(nuevas)].map((etiqueta_id) => ({ tarjeta_id: c.id, etiqueta_id })) }),
        );
    }
    await prisma.$transaction(ops);

    const tarjeta = await prisma.tareas_tarjetas.findUnique({ where: { id: c.id }, include: INCLUDE_RESUMEN });
    const siguiente = await siguienteSiCompleta(c, tarjeta);
    res.json({ ...serializarTarjeta(tarjeta), siguiente: await serializarPorId(siguiente?.id) });
});

export const copiarTarjeta = handler(async (req, res, duenoId) => {
    const c = await tarjetaDelUsuario(idParam(req), duenoId);
    const [etiquetas, subtareas] = await Promise.all([
        prisma.tareas_tarjeta_etiquetas.findMany({ where: { tarjeta_id: c.id } }),
        prisma.tareas_subtareas.findMany({ where: { tarjeta_id: c.id }, orderBy: [{ posicion: 'asc' }, { id: 'asc' }] }),
    ]);
    const posicion = await reubicar('tareas_tarjetas', { lista_id: c.lista_id, archivada: false }, null, c.id);
    const copia = await prisma.tareas_tarjetas.create({
        data: {
            tablero_id: c.tablero_id, lista_id: c.lista_id, posicion,
            titulo: texto(req.body.titulo, 500) || `${c.titulo} (copia)`.slice(0, 500),
            descripcion: c.descripcion, fecha_inicio: c.fecha_inicio,
            vence_at: c.vence_at, vence_con_hora: c.vence_con_hora, recordatorio_min: c.recordatorio_min,
            repeticion: c.repeticion ?? Prisma.DbNull,
            completada: c.lista.es_final, completada_at: c.lista.es_final ? new Date() : null,
            created_by: Number(req.user.id) || null, created_by_name: req.user.name || null,
            etiquetas: { create: etiquetas.map((e) => ({ etiqueta_id: e.etiqueta_id })) },
            subtareas: { create: subtareas.map((s) => ({ texto: s.texto, hecha: false, posicion: s.posicion })) },
        },
        include: INCLUDE_RESUMEN,
    });
    res.status(201).json(serializarTarjeta(copia));
});

export const eliminarTarjeta = handler(async (req, res, duenoId) => {
    const c = await tarjetaDelUsuario(idParam(req), duenoId);
    const archivos = await prisma.tareas_adjuntos.findMany({ where: { tarjeta_id: c.id, tipo: 'archivo' }, select: { url: true } });
    await prisma.tareas_tarjetas.delete({ where: { id: c.id } });
    await Promise.all(archivos.map((a) => deleteComprobanteFromGCS(a.url)));
    res.json({ ok: true });
});

// Todas las tarjetas del usuario (vista "Todas las tareas", agenda, búsqueda).
// ?q= busca en título y descripción; ?estado=pendientes|completadas|todas;
// ?tablero_id= limita a un proyecto.
export const listarTarjetas = handler(async (req, res, duenoId) => {
    const where = { archivada: false, tablero: { user_id: duenoId, archivado: false } };
    const estado = req.query.estado || 'todas';
    if (estado === 'pendientes') where.completada = false;
    if (estado === 'completadas') where.completada = true;
    if (req.query.tablero_id) where.tablero_id = Number(req.query.tablero_id);
    const q = String(req.query.q || '').trim();
    if (q) {
        where.OR = [
            { titulo: { contains: q, mode: 'insensitive' } },
            { descripcion: { contains: q, mode: 'insensitive' } },
        ];
    }
    const tarjetas = await prisma.tareas_tarjetas.findMany({
        where,
        orderBy: [{ updated_at: 'desc' }],
        take: Math.min(Number(req.query.limit) || 1500, 3000),
        include: {
            ...INCLUDE_RESUMEN,
            lista: { select: { id: true, nombre: true, es_final: true } },
            tablero: { select: { id: true, nombre: true, color: true, icono: true } },
        },
    });
    // Las etiquetas de todos los proyectos involucrados, para pintarlas.
    const tableroIds = [...new Set(tarjetas.map((t) => t.tablero_id))];
    const etiquetas = tableroIds.length
        ? await prisma.tareas_etiquetas.findMany({ where: { tablero_id: { in: tableroIds } } })
        : [];
    res.json({ tarjetas: tarjetas.map(serializarTarjeta), etiquetas });
});

// ═════════════════════════════ SUBTAREAS ═════════════════════════════════════

// Varias líneas = varias subtareas (pegar una lista de pasos de una vez).
export const crearSubtareas = handler(async (req, res, duenoId) => {
    const c = await tarjetaDelUsuario(idParam(req), duenoId);
    const lineas = String(req.body.texto || '')
        .split(/\r?\n/)
        .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)]|\[\s?[xX ]?\])\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 100);
    if (!lineas.length) throw new ErrorTareas(400, 'Escribe la subtarea');
    const base = await reubicar('tareas_subtareas', { tarjeta_id: c.id }, null, undefined);
    await prisma.tareas_subtareas.createMany({
        data: lineas.map((l, i) => ({ tarjeta_id: c.id, texto: l.slice(0, 500), posicion: base + i * PASO })),
    });
    await prisma.tareas_tarjetas.update({ where: { id: c.id }, data: { updated_at: new Date() } });
    res.status(201).json(await prisma.tareas_subtareas.findMany({ where: { tarjeta_id: c.id }, orderBy: [{ posicion: 'asc' }, { id: 'asc' }] }));
});

const subtareaDelUsuario = async (id, duenoId) => {
    const s = await prisma.tareas_subtareas.findFirst({ where: { id, tarjeta: { tablero: { user_id: duenoId } } } });
    if (!s) throw noEncontrado('La subtarea');
    return s;
};

export const actualizarSubtarea = handler(async (req, res, duenoId) => {
    const s = await subtareaDelUsuario(idParam(req), duenoId);
    const data = {};
    if (req.body.texto !== undefined) {
        data.texto = texto(req.body.texto, 500);
        if (!data.texto) throw new ErrorTareas(400, 'La subtarea no puede quedar vacía');
    }
    if (req.body.hecha !== undefined) data.hecha = !!req.body.hecha;
    const sub = await prisma.tareas_subtareas.update({ where: { id: s.id }, data });
    await prisma.tareas_tarjetas.update({ where: { id: s.tarjeta_id }, data: { updated_at: new Date() } });
    res.json(sub);
});

export const moverSubtarea = handler(async (req, res, duenoId) => {
    const s = await subtareaDelUsuario(idParam(req), duenoId);
    const posicion = await reubicar('tareas_subtareas', { tarjeta_id: s.tarjeta_id }, s.id, req.body.despues_de ?? null);
    res.json(await prisma.tareas_subtareas.update({ where: { id: s.id }, data: { posicion } }));
});

export const eliminarSubtarea = handler(async (req, res, duenoId) => {
    const s = await subtareaDelUsuario(idParam(req), duenoId);
    await prisma.tareas_subtareas.delete({ where: { id: s.id } });
    res.json({ ok: true });
});

// Convierte una subtarea en tarjeta propia, en la misma lista (debajo).
export const subtareaATarjeta = handler(async (req, res, duenoId) => {
    const s = await subtareaDelUsuario(idParam(req), duenoId);
    const c = await tarjetaDelUsuario(s.tarjeta_id, duenoId);
    const posicion = await reubicar('tareas_tarjetas', { lista_id: c.lista_id, archivada: false }, null, c.id);
    const nueva = await prisma.tareas_tarjetas.create({
        data: {
            tablero_id: c.tablero_id, lista_id: c.lista_id, posicion, titulo: s.texto,
            completada: s.hecha || c.lista.es_final, completada_at: (s.hecha || c.lista.es_final) ? new Date() : null,
            created_by: Number(req.user.id) || null, created_by_name: req.user.name || null,
        },
        include: INCLUDE_RESUMEN,
    });
    await prisma.tareas_subtareas.delete({ where: { id: s.id } });
    res.status(201).json(serializarTarjeta(nueva));
});

// ═════════════════════════════ COMENTARIOS ═══════════════════════════════════

export const crearComentario = handler(async (req, res, duenoId) => {
    const c = await tarjetaDelUsuario(idParam(req), duenoId);
    const cuerpo = texto(req.body.texto, 10000);
    if (!cuerpo) throw new ErrorTareas(400, 'Escribe el comentario');
    const comentario = await prisma.tareas_comentarios.create({
        data: { tarjeta_id: c.id, user_id: Number(req.user.id) || null, user_name: req.user.name || null, texto: cuerpo },
    });
    await prisma.tareas_tarjetas.update({ where: { id: c.id }, data: { updated_at: new Date() } });
    res.status(201).json(comentario);
});

const comentarioPropio = async (req, duenoId) => {
    const m = await prisma.tareas_comentarios.findFirst({ where: { id: idParam(req), tarjeta: { tablero: { user_id: duenoId } } } });
    if (!m) throw noEncontrado('El comentario');
    if (m.user_id && Number(m.user_id) !== Number(req.user.id) && !['admin', 'superadmin'].includes(req.user.role)) {
        throw new ErrorTareas(403, 'Solo quien escribió el comentario puede cambiarlo');
    }
    return m;
};

export const actualizarComentario = handler(async (req, res, duenoId) => {
    const m = await comentarioPropio(req, duenoId);
    const cuerpo = texto(req.body.texto, 10000);
    if (!cuerpo) throw new ErrorTareas(400, 'El comentario no puede quedar vacío');
    res.json(await prisma.tareas_comentarios.update({ where: { id: m.id }, data: { texto: cuerpo, updated_at: new Date() } }));
});

export const eliminarComentario = handler(async (req, res, duenoId) => {
    const m = await comentarioPropio(req, duenoId);
    await prisma.tareas_comentarios.delete({ where: { id: m.id } });
    res.json({ ok: true });
});

// ═════════════════════════════ ADJUNTOS ══════════════════════════════════════

export const subirAdjunto = handler(async (req, res, duenoId) => {
    const c = await tarjetaDelUsuario(idParam(req), duenoId);
    const url = await uploadComprobanteToGCS(req.file, { businessId: `usuario-${duenoId}`, tipo: 'tareas' });
    const nombre = Buffer.from(req.file.originalname || 'archivo', 'latin1').toString('utf8').slice(0, 255);
    const adjunto = await prisma.tareas_adjuntos.create({
        data: {
            tarjeta_id: c.id, tipo: 'archivo', nombre, url,
            mime: req.file.mimetype, bytes: req.file.size, created_by: Number(req.user.id) || null,
        },
    });
    await prisma.tareas_tarjetas.update({ where: { id: c.id }, data: { updated_at: new Date() } });
    res.status(201).json(adjunto);
});

export const agregarEnlace = handler(async (req, res, duenoId) => {
    const c = await tarjetaDelUsuario(idParam(req), duenoId);
    let url;
    try {
        const crudo = String(req.body.url || '').trim();
        url = new URL(/^https?:\/\//i.test(crudo) ? crudo : `https://${crudo}`);
    } catch {
        throw new ErrorTareas(400, 'El enlace no es válido');
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw new ErrorTareas(400, 'El enlace no es válido');
    const adjunto = await prisma.tareas_adjuntos.create({
        data: {
            tarjeta_id: c.id, tipo: 'enlace', url: url.toString(),
            nombre: texto(req.body.nombre, 255) || url.hostname.replace(/^www\./, ''),
            created_by: Number(req.user.id) || null,
        },
    });
    res.status(201).json(adjunto);
});

export const eliminarAdjunto = handler(async (req, res, duenoId) => {
    const a = await prisma.tareas_adjuntos.findFirst({ where: { id: idParam(req), tarjeta: { tablero: { user_id: duenoId } } } });
    if (!a) throw noEncontrado('El adjunto');
    await prisma.tareas_adjuntos.delete({ where: { id: a.id } });
    if (a.tipo === 'archivo') await deleteComprobanteFromGCS(a.url);
    res.json({ ok: true });
});

// ═════════════════════════════ AVISOS AL CELULAR ═════════════════════════════

const HORA_DEFAULT = 7;
const configAvisos = async (userId) => {
    const [fila, dispositivos] = await Promise.all([
        prisma.tareas_avisos.findUnique({ where: { user_id: userId } }),
        prisma.push_suscripciones.count({ where: { user_id: userId } }),
    ]);
    return {
        disponible: pushDisponible(),
        clave_publica: clavePublicaPush(),
        activo: fila?.activo ?? false,
        resumen_diario: fila?.resumen_diario ?? true,
        hora_resumen: fila?.hora_resumen ?? HORA_DEFAULT,
        dispositivos,
    };
};

export const obtenerAvisos = handler(async (req, res, duenoId) => {
    res.json(await configAvisos(duenoId));
});

export const actualizarAvisos = handler(async (req, res, userId) => {
    const data = { updated_at: new Date() };
    if (req.body.activo !== undefined) data.activo = !!req.body.activo;
    if (req.body.resumen_diario !== undefined) data.resumen_diario = !!req.body.resumen_diario;
    if (req.body.hora_resumen !== undefined) {
        const h = Number(req.body.hora_resumen);
        if (!Number.isInteger(h) || h < 0 || h > 21) throw new ErrorTareas(400, 'Hora inválida');
        data.hora_resumen = h;
    }
    await prisma.tareas_avisos.upsert({
        where: { user_id: userId },
        create: { user_id: userId, ...data },
        update: data,
    });
    res.json(await configAvisos(userId));
});

// El celular aceptó notificaciones: se guarda su dirección de push y se
// encienden sus avisos de Tareas.
export const suscribirPush = handler(async (req, res, userId) => {
    const s = req.body.suscripcion || {};
    if (!s.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) {
        throw new ErrorTareas(400, 'Suscripción inválida');
    }
    const dispositivo = texto(req.body.dispositivo || req.headers['user-agent'], 200) || null;
    await prisma.push_suscripciones.upsert({
        where: { endpoint: s.endpoint },
        create: { user_id: userId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, dispositivo },
        update: { user_id: userId, p256dh: s.keys.p256dh, auth: s.keys.auth, dispositivo },
    });
    await prisma.tareas_avisos.upsert({
        where: { user_id: userId },
        create: { user_id: userId, activo: true },
        update: { activo: true, updated_at: new Date() },
    });
    res.json(await configAvisos(userId));
});

export const desuscribirPush = handler(async (req, res, userId) => {
    if (req.body.endpoint) {
        await prisma.push_suscripciones.deleteMany({ where: { endpoint: String(req.body.endpoint), user_id: userId } });
    }
    res.json(await configAvisos(userId));
});

export const probarPush = handler(async (req, res, userId) => {
    if (!pushDisponible()) throw new ErrorTareas(503, 'Las notificaciones aún no están configuradas en el servidor');
    const r = await enviarPushAUsuarios([userId], {
        title: '🔔 ¡Listo! Así te llegan los avisos',
        body: 'Te avisaré antes de que venza una tarea y cada mañana con tu día.',
        url: '/inicio/tareas',
        tag: 'prueba',
    });
    if (!r.enviados) throw new ErrorTareas(404, 'No hay ningún dispositivo con notificaciones activas');
    res.json(r);
});

// Cron (Cloud Scheduler): sin token de usuario, con un secreto compartido.
export const procesarAvisos = async (req, res) => {
    const esperado = process.env.TAREAS_CRON_SECRET || '';
    const recibido = String(req.headers['x-cron-secret'] || '');
    const ok = esperado.length >= 16 && recibido.length === esperado.length
        && crypto.timingSafeEqual(Buffer.from(recibido), Buffer.from(esperado));
    if (!ok) return res.status(401).json({ message: 'No autorizado' });
    try {
        res.json(await procesarAvisosTareas());
    } catch (error) {
        console.error('[tareas] procesarAvisos', error);
        res.status(500).json({ message: error.message });
    }
};

