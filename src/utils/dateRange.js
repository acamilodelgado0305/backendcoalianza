// Utilidades para armar filtros de rango de fechas exactos.
//
// El problema que resuelven: hacer `new Date(fecha_fin).setHours(23,59,59,999)`
// reescribe la hora en la zona LOCAL DEL SERVIDOR (UTC en Cloud Run), no en la
// del usuario. Eso corría el fin del rango varias horas y hacía que "Ayer"
// arrastrara registros de hoy.
//
// Regla: si el cliente manda un instante ISO completo (lo que hace el frontend),
// se respeta tal cual — ya viene con el offset del navegador y es exacto.
// Solo si llega una fecha "pelada" (YYYY-MM-DD) se calculan los bordes del día,
// usando el offset que informe el cliente o, en su defecto, el de Colombia.

// Colombia no tiene horario de verano, así que su offset es fijo.
const TZ_POR_DEFECTO = '-05:00';
const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Convierte el valor de Date#getTimezoneOffset() (minutos, positivo al oeste de
// UTC: Colombia = 300) al sufijo ISO correspondiente ('-05:00').
const offsetISO = (tzOffset) => {
    const minutos = Number(tzOffset);
    if (!Number.isFinite(minutos) || Math.abs(minutos) > 14 * 60) return TZ_POR_DEFECTO;
    const signo = minutos > 0 ? '-' : '+';
    const abs   = Math.abs(minutos);
    const hh    = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm    = String(abs % 60).padStart(2, '0');
    return `${signo}${hh}:${mm}`;
};

// Devuelve un Date o lanza si el valor no es una fecha válida.
const aFecha = (valor, campo) => {
    const d = new Date(valor);
    if (Number.isNaN(d.getTime())) {
        const err = new Error(`El parámetro ${campo} no es una fecha válida`);
        err.status = 400;
        throw err;
    }
    return d;
};

// Inicio del rango: instante exacto tal cual, o 00:00:00.000 del día indicado.
export const parseRangoInicio = (valor, tzOffset) => {
    const v = String(valor).trim();
    return SOLO_FECHA.test(v)
        ? aFecha(`${v}T00:00:00.000${offsetISO(tzOffset)}`, 'fecha_inicio')
        : aFecha(v, 'fecha_inicio');
};

// Fin del rango: instante exacto tal cual, o 23:59:59.999 del día indicado.
export const parseRangoFin = (valor, tzOffset) => {
    const v = String(valor).trim();
    return SOLO_FECHA.test(v)
        ? aFecha(`${v}T23:59:59.999${offsetISO(tzOffset)}`, 'fecha_fin')
        : aFecha(v, 'fecha_fin');
};

// Arma el filtro Prisma para una columna de fecha a partir del query string.
// Devuelve undefined si no vino ningún borde (para no ensuciar el `where`).
export const buildFiltroFechas = ({ fecha_inicio, fecha_fin, tz_offset } = {}) => {
    const filtro = {};
    if (fecha_inicio) filtro.gte = parseRangoInicio(fecha_inicio, tz_offset);
    if (fecha_fin)    filtro.lte = parseRangoFin(fecha_fin, tz_offset);

    if (filtro.gte && filtro.lte && filtro.gte > filtro.lte) {
        const err = new Error('fecha_inicio no puede ser posterior a fecha_fin');
        err.status = 400;
        throw err;
    }
    return Object.keys(filtro).length ? filtro : undefined;
};

export default buildFiltroFechas;
