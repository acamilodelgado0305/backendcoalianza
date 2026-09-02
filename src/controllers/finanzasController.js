// src/controllers/finanzasController.js
//
// SALDO ACUMULADO
// ---------------
// Las tarjetas de Movimientos siempre mostraron solo el rango consultado: si en
// agosto entraron 10 y salieron 4, septiembre arrancaba en cero. Aquí vive el
// cálculo que arrastra lo que quedó de los meses anteriores.
//
// Fórmula:
//   saldo_anterior = saldo_inicial
//                  + Σ ingresos anteriores al periodo
//                  − Σ egresos  anteriores al periodo
//   saldo_final    = saldo_anterior + ingresos_periodo − egresos_periodo
//
// "Anteriores al periodo" = desde `fecha_corte` (si el negocio configuró una)
// hasta el instante justo antes de `fecha_inicio`. El corte existe para que el
// saldo inicial no se duplique con movimientos ya cargados de antes.
//
// Nota de fechas: los ingresos NO tienen columna `fecha`, se filtran por
// `createdAt`; los egresos sí usan `fecha`. Es el mismo criterio de
// ingresoController/egresoController, para que los números cuadren con la tabla.

import prisma from '../prisma.js';
import { Prisma } from '@prisma/client';
import { parseRangoInicio, parseRangoFin } from '../utils/dateRange.js';

const num = (v) => Number(v || 0);

// Tarjetas del panel que el negocio puede ocultar. La lista blanca evita que
// se guarde cualquier cosa en la columna JSON.
export const TARJETAS_VALIDAS = ['saldo_anterior', 'ingresos', 'gastos', 'balance', 'saldo_final'];

const sanearOcultas = (valor) => {
    if (!Array.isArray(valor)) return [];
    return [...new Set(valor.filter((k) => TARJETAS_VALIDAS.includes(k)))];
};

// La configuración es opcional: un negocio sin fila se comporta como saldo
// inicial 0, sin fecha de corte (todo el histórico cuenta) y con todas las
// tarjetas visibles.
const CONFIG_VACIA = { saldo_inicial: 0, fecha_corte: null, notas: null, tarjetas_ocultas: [] };

const normalizeConfig = (row) =>
    row
        ? {
              saldo_inicial:    num(row.saldo_inicial),
              fecha_corte:      row.fecha_corte ? row.fecha_corte.toISOString().slice(0, 10) : null,
              notas:            row.notas || null,
              tarjetas_ocultas: sanearOcultas(row.tarjetas_ocultas),
          }
        : { ...CONFIG_VACIA };

const getConfig = async (businessId) => {
    const row = await prisma.finanzas_config.findUnique({ where: { business_id: businessId } });
    return { row, config: normalizeConfig(row) };
};

// Suma ingresos y egresos en una ventana [desde, hasta). Cualquiera de los dos
// bordes puede ser null (rango abierto por ese lado).
const sumarMovimientos = async (businessId, desde, hasta) => {
    const condIngresos = [Prisma.sql`business_id = ${businessId}`];
    const condEgresos  = [Prisma.sql`business_id = ${businessId}`];

    if (desde) {
        condIngresos.push(Prisma.sql`"createdAt" >= ${desde}`);
        condEgresos.push(Prisma.sql`fecha >= ${desde}`);
    }
    if (hasta) {
        condIngresos.push(Prisma.sql`"createdAt" < ${hasta}`);
        condEgresos.push(Prisma.sql`fecha < ${hasta}`);
    }

    const [ing, egr] = await Promise.all([
        prisma.$queryRaw(Prisma.sql`
            SELECT COALESCE(SUM(valor), 0) AS total, COUNT(*)::int AS cantidad
            FROM "public"."ingresos" WHERE ${Prisma.join(condIngresos, ' AND ')}
        `),
        prisma.$queryRaw(Prisma.sql`
            SELECT COALESCE(SUM(valor), 0) AS total, COUNT(*)::int AS cantidad
            FROM "public"."egresos" WHERE ${Prisma.join(condEgresos, ' AND ')}
        `),
    ]);

    return {
        ingresos:   num(ing[0]?.total),
        egresos:    num(egr[0]?.total),
        n_ingresos: ing[0]?.cantidad || 0,
        n_egresos:  egr[0]?.cantidad || 0,
    };
};

// ==========================================
// GET /api/finanzas/config
// ==========================================
export const getFinanzasConfig = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: 'No se pudo determinar el negocio activo' });

        const { config } = await getConfig(businessId);
        return res.status(200).json(config);
    } catch (error) {
        console.error('Error obteniendo configuración financiera:', error);
        return res.status(500).json({ message: 'Error al obtener la configuración financiera', error: error.message });
    }
};

// ==========================================
// PUT /api/finanzas/config   { saldo_inicial, fecha_corte, notas }
// ==========================================
export const updateFinanzasConfig = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: 'No se pudo determinar el negocio activo' });

        const { saldo_inicial, fecha_corte, notas, tarjetas_ocultas } = req.body;

        // Actualización parcial: solo se toca lo que venga en el body, para que
        // guardar las tarjetas visibles no borre el saldo inicial ni al revés.
        const data = { updated_at: new Date() };

        if (saldo_inicial !== undefined) {
            const saldo = Number(saldo_inicial);
            if (!Number.isFinite(saldo)) {
                return res.status(400).json({ message: 'El saldo inicial debe ser un número' });
            }
            data.saldo_inicial = saldo;
        }

        if (fecha_corte !== undefined) {
            if (fecha_corte === null || fecha_corte === '') {
                data.fecha_corte = null;
            } else {
                // Llega como YYYY-MM-DD y se guarda como DATE sin hora: se ancla
                // a mediodía UTC para que ningún offset la corra un día atrás.
                const corte = new Date(`${String(fecha_corte).slice(0, 10)}T12:00:00.000Z`);
                if (Number.isNaN(corte.getTime())) {
                    return res.status(400).json({ message: 'La fecha de corte no es válida' });
                }
                data.fecha_corte = corte;
            }
        }

        if (notas !== undefined) data.notas = notas?.trim() || null;

        if (tarjetas_ocultas !== undefined) {
            if (!Array.isArray(tarjetas_ocultas)) {
                return res.status(400).json({ message: 'tarjetas_ocultas debe ser una lista' });
            }
            data.tarjetas_ocultas = sanearOcultas(tarjetas_ocultas);
        }

        const row = await prisma.finanzas_config.upsert({
            where:  { business_id: businessId },
            update: data,
            // Si la fila aún no existe, lo que no vino en el body toma su default
            create: {
                business_id:      businessId,
                saldo_inicial:    data.saldo_inicial ?? 0,
                fecha_corte:      data.fecha_corte ?? null,
                notas:            data.notas ?? null,
                tarjetas_ocultas: data.tarjetas_ocultas ?? [],
            },
        });

        return res.status(200).json(normalizeConfig(row));
    } catch (error) {
        console.error('Error guardando configuración financiera:', error);
        return res.status(500).json({ message: 'Error al guardar la configuración financiera', error: error.message });
    }
};

// ==========================================
// GET /api/finanzas/saldo?fecha_inicio=&fecha_fin=&tz_offset=
// ==========================================
export const getSaldo = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: 'No se pudo determinar el negocio activo' });

        const { fecha_inicio, fecha_fin, tz_offset } = req.query;
        const inicio = fecha_inicio ? parseRangoInicio(fecha_inicio, tz_offset) : null;
        const fin    = fecha_fin    ? parseRangoFin(fecha_fin, tz_offset)       : null;

        if (inicio && fin && inicio > fin) {
            return res.status(400).json({ message: 'fecha_inicio no puede ser posterior a fecha_fin' });
        }

        const { config } = await getConfig(businessId);
        const corte = config.fecha_corte ? new Date(`${config.fecha_corte}T00:00:00.000Z`) : null;

        // Todo lo anterior al inicio del periodo (desde el corte, si lo hay).
        // Sin fecha_inicio no hay "antes": el saldo anterior es solo el inicial.
        const previo = inicio
            ? await sumarMovimientos(businessId, corte, inicio)
            : { ingresos: 0, egresos: 0, n_ingresos: 0, n_egresos: 0 };

        // El periodo consultado. `parseRangoFin` devuelve el último instante del
        // día, así que ese borde es inclusivo: para usarlo como tope exclusivo
        // en la ventana [desde, hasta) se le suma 1 ms.
        const finExclusivo = fin ? new Date(fin.getTime() + 1) : null;
        const periodo = await sumarMovimientos(businessId, inicio || corte, finExclusivo);

        const saldoAnterior  = config.saldo_inicial + previo.ingresos - previo.egresos;
        const balancePeriodo = periodo.ingresos - periodo.egresos;

        return res.status(200).json({
            saldo_inicial:       config.saldo_inicial,
            fecha_corte:         config.fecha_corte,
            // Viaja aquí para que el panel sepa qué tarjetas pintar sin tener
            // que pedir /config aparte en cada carga.
            tarjetas_ocultas:    config.tarjetas_ocultas,
            saldo_anterior:      saldoAnterior,
            ingresos_periodo:    periodo.ingresos,
            egresos_periodo:     periodo.egresos,
            balance_periodo:     balancePeriodo,
            saldo_final:         saldoAnterior + balancePeriodo,
            movimientos_previos: previo.n_ingresos + previo.n_egresos,
        });
    } catch (error) {
        if (error.status === 400) return res.status(400).json({ message: error.message });
        console.error('Error calculando el saldo acumulado:', error);
        return res.status(500).json({ message: 'Error al calcular el saldo', error: error.message });
    }
};
