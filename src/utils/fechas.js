/**
 * Fechas «solo día» (columnas @db.Date: fecha_emision, fecha_vencimiento, fecha_pago…).
 *
 * Postgres las guarda sin hora, pero Prisma las devuelve como Date y salen a JSON
 * como '2026-09-01T00:00:00.000Z'. Si el navegador hace `dayjs(eseString)` en
 * Colombia (UTC-5) obtiene el 31/08 a las 19:00 y muestra un día menos.
 *
 * Por eso aquí todo se maneja en UTC: se guarda la medianoche UTC del día y se
 * responde el string 'YYYY-MM-DD', que no admite corrimientos.
 */

// 'YYYY-MM-DD' o ISO -> Date a medianoche UTC de ese mismo día.
export const toDateOnly = (v) => {
    if (!v) return null;
    if (v instanceof Date) {
        return isNaN(v) ? null : new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
    }
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const d = new Date(v);
    return isNaN(d) ? null : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

// Hoy en Colombia: el servidor corre en UTC, así que después de las 7pm
// `new Date()` ya daría el día siguiente.
export const hoyDateOnly = () => toDateOnly(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
);

// Date -> 'YYYY-MM-DD' (nunca desplaza el día por zona horaria).
export const dateOnlyStr = (v) => {
    const d = toDateOnly(v);
    return d ? d.toISOString().slice(0, 10) : null;
};

// Suma meses en UTC recortando al último día del mes destino:
// 31/08 + 1 mes = 30/09 (con setMonth se iba a 01/10).
export const sumarMeses = (base, meses) => {
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth() + meses;
    const d = base.getUTCDate();
    const ultimoDia = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(d, ultimoDia)));
};

// Devuelve una copia de la fila con sus fechas «solo día» como 'YYYY-MM-DD'.
export const serializeFechas = (row, campos) => {
    if (!row) return row;
    const out = { ...row };
    for (const campo of campos) {
        if (out[campo] !== undefined) out[campo] = dateOnlyStr(out[campo]);
    }
    return out;
};
