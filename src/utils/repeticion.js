// src/utils/repeticion.js
//
// Reglas de las tareas que se repiten (clases que se dictan, pagos del mes…).
// Puro, sin BD: lo usan el controlador de Tareas y el cron. El frontend tiene
// una copia de `siguienteFecha` (andesfront/src/components/tareas/repeticion.js)
// para pintar en el calendario las próximas repeticiones: si cambia aquí,
// cambia allá.
//
// Regla: { frecuencia: 'diaria'|'semanal'|'mensual'|'anual', cada: N,
//          dias: [0-6] (solo semanal, 0 = domingo), dia_mes (solo mensual),
//          ancla: 'YYYY-MM-DD' (inicio de la serie, para "cada 2 semanas"),
//          hasta: 'YYYY-MM-DD' | null, lista_id: lista donde nace la siguiente }
//
// Todo se calcula en la hora de pared de Colombia (UTC-5 fijo, sin horario
// de verano), así "martes 6:00 p. m." sigue siendo martes 6:00 p. m.

export const FRECUENCIAS = ['diaria', 'semanal', 'mensual', 'anual'];

const OFFSET = 5 * 3600 * 1000;
const DIA = 86400000;
const aLocal = (d) => new Date(new Date(d).getTime() - OFFSET);
const deLocal = (d) => new Date(d.getTime() + OFFSET);
const diaStr = (local) => local.toISOString().slice(0, 10);
const inicioSemana = (local) => {
    const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
    return d.getTime() - d.getUTCDay() * DIA;
};

/** Limpia lo que manda el cliente. null = no se repite. */
export const normalizarRepeticion = (r, venceAt = null) => {
    if (!r || typeof r !== 'object') return null;
    const frecuencia = FRECUENCIAS.includes(r.frecuencia) ? r.frecuencia : null;
    if (!frecuencia) return null;
    const local = venceAt ? aLocal(venceAt) : null;
    const out = { frecuencia, cada: Math.min(Math.max(parseInt(r.cada, 10) || 1, 1), 99) };
    if (frecuencia === 'semanal') {
        const dias = [...new Set((Array.isArray(r.dias) ? r.dias : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
        out.dias = dias.length ? dias : (local ? [local.getUTCDay()] : [1]);
    }
    if (frecuencia === 'mensual') {
        const dm = parseInt(r.dia_mes, 10);
        out.dia_mes = dm >= 1 && dm <= 31 ? dm : (local ? local.getUTCDate() : 1);
    }
    out.ancla = /^\d{4}-\d{2}-\d{2}$/.test(r.ancla || '') ? r.ancla : (local ? diaStr(local) : null);
    out.hasta = /^\d{4}-\d{2}-\d{2}$/.test(r.hasta || '') ? r.hasta : null;
    out.lista_id = Number(r.lista_id) || null;
    return out;
};

const sumarMeses = (local, n, diaMes) => {
    const y = local.getUTCFullYear();
    const m = local.getUTCMonth() + n;
    const ultimo = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(diaMes, ultimo), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds()));
};

// Una ocurrencia después de `local` (hora de pared de Colombia).
const paso = (regla, local) => {
    switch (regla.frecuencia) {
        case 'diaria':
            return new Date(local.getTime() + regla.cada * DIA);
        case 'semanal': {
            const dias = regla.dias?.length ? regla.dias : [local.getUTCDay()];
            const ancla = regla.ancla ? inicioSemana(new Date(`${regla.ancla}T12:00:00Z`)) : inicioSemana(local);
            for (let i = 1; i <= 7 * regla.cada + 7; i += 1) {
                const cand = new Date(local.getTime() + i * DIA);
                if (!dias.includes(cand.getUTCDay())) continue;
                const semanas = Math.round((inicioSemana(cand) - ancla) / (7 * DIA));
                if (semanas % regla.cada === 0) return cand;
            }
            return null;
        }
        case 'mensual':
            return sumarMeses(local, regla.cada, regla.dia_mes || local.getUTCDate());
        case 'anual':
            return sumarMeses(local, 12 * regla.cada, local.getUTCDate());
        default:
            return null;
    }
};

/**
 * Fecha de la siguiente ocurrencia a partir del vencimiento actual. Nunca
 * devuelve una fecha ya pasada: si la serie quedó atrás (semanas sin abrir la
 * app), salta a la próxima que todavía no ha ocurrido.
 * @returns {Date|null} null = la serie terminó (`hasta`).
 */
export const siguienteFecha = (regla, venceAt, conHora = true, ahora = new Date()) => {
    if (!regla || !venceAt) return null;
    const hoy = diaStr(aLocal(ahora));
    let cand = paso(regla, aLocal(venceAt));
    for (let vueltas = 0; cand && vueltas < 1000; vueltas += 1) {
        const yaPaso = conHora ? deLocal(cand) <= ahora : diaStr(cand) < hoy;
        if (!yaPaso) break;
        cand = paso(regla, cand);
    }
    if (!cand) return null;
    if (regla.hasta && diaStr(cand) > regla.hasta) return null;
    return deLocal(cand);
};
