// Etiquetas de color de los movimientos (tabla `egreso_categorias`, nombre
// histórico). Desde el 29-oct-2026 las etiquetas son UNA sola lista por negocio
// que comparten gastos e ingresos; `tipo` solo recuerda dónde se creó.
import prisma from '../prisma.js';

export const TIPOS_ETIQUETA = ['gasto', 'ingreso'];

/** 'ingreso' si lo piden explícitamente; cualquier otra cosa es 'gasto' (compatibilidad). */
export const tipoEtiqueta = (valor) => (valor === 'ingreso' ? 'ingreso' : 'gasto');

const errorHttp = (status, message) => Object.assign(new Error(message), { status });

/**
 * Valida una etiqueta para un movimiento (gasto o ingreso) del negocio activo.
 * null / '' / undefined → null (sin etiqueta). Lanza 400 si no existe en el negocio.
 */
export const resolverEtiqueta = async (valor, businessId) => {
    if (valor === null || valor === undefined || valor === '') return null;
    const id = Number(valor);
    if (!Number.isInteger(id)) throw errorHttp(400, 'Etiqueta inválida');
    const etiqueta = await prisma.egreso_categorias.findFirst({
        where:  { id, business_id: businessId },
        select: { id: true },
    });
    if (!etiqueta) throw errorHttp(400, 'La etiqueta no existe en este negocio');
    return id;
};
