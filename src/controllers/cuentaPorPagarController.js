import prisma from '../prisma.js';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ─── Generador de cronograma: interés sobre saldo, abono a capital fijo ───────
// tasa_ea = tasa efectiva anual en % (ej: 19.56). Se convierte a mensual equivalente.
const generarCronogramaPrestamo = ({ capital, tasa_ea, num_cuotas, fecha_primera_cuota }) => {
    const cap = Number(capital)   || 0;
    const n   = Number(num_cuotas) || 0;
    const ea  = Number(tasa_ea)    || 0;

    if (cap <= 0 || n <= 0) return { cuotas: [], total: round2(cap) };

    const tasaMensual  = Math.pow(1 + ea / 100, 1 / 12) - 1;
    const capitalCuota = cap / n;
    const base = fecha_primera_cuota ? new Date(fecha_primera_cuota) : new Date();

    const cuotas = [];
    let totalInteres = 0;

    for (let i = 1; i <= n; i++) {
        const saldoInicial = cap - capitalCuota * (i - 1);
        const interes      = round2(saldoInicial * tasaMensual);
        // La última cuota absorbe el redondeo del capital
        const capCuota     = i === n ? round2(saldoInicial) : round2(capitalCuota);
        const valor        = round2(capCuota + interes);
        const saldoFinal   = round2(saldoInicial - capCuota);
        totalInteres += interes;

        const fecha = new Date(base);
        fecha.setMonth(fecha.getMonth() + (i - 1));

        cuotas.push({
            numero:            i,
            fecha_vencimiento: fecha.toISOString().slice(0, 10),
            capital:           capCuota,
            interes,
            valor,
            saldo:             saldoFinal < 0 ? 0 : saldoFinal,
            estado:            'PENDIENTE',
            fecha_pago:        null,
            cuenta:            null,
            nota:              null,
        });
    }

    return { cuotas, total: round2(cap + totalInteres) };
};

// ─── 1. CREAR ─────────────────────────────────────────────────────────────────
export const createCuentaPorPagar = async (req, res) => {
    try {
        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;

        if (!usuarioId)  return res.status(401).json({ message: "Usuario no autenticado" });
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

        const {
            titulo,
            persona_id,
            proveedor_nombre,
            total = 0,
            notas,
            fecha_emision,
            fecha_vencimiento,
            // Préstamo
            es_prestamo = false,
            capital,
            tasa_ea,
            num_cuotas,
            periodicidad = 'MENSUAL',
            fecha_primera_cuota,
        } = req.body;

        if (!titulo || !titulo.trim()) {
            return res.status(400).json({ message: 'El título es obligatorio.' });
        }

        const data = {
            titulo:            titulo.trim(),
            business_id:       businessId,
            usuario_id:        usuarioId,
            persona_id:        persona_id || null,
            proveedor_nombre:  proveedor_nombre || null,
            estado:            'PENDIENTE',
            notas:             notas || null,
            fecha_emision:     fecha_emision ? new Date(fecha_emision) : new Date(),
            es_prestamo:       !!es_prestamo,
        };

        if (es_prestamo) {
            if (!(Number(capital) > 0) || !(Number(num_cuotas) > 0)) {
                return res.status(400).json({ message: 'El préstamo requiere capital y número de cuotas válidos.' });
            }
            const { cuotas, total: totalCalc } = generarCronogramaPrestamo({ capital, tasa_ea, num_cuotas, fecha_primera_cuota });
            data.capital             = Number(capital);
            data.tasa_ea             = tasa_ea != null ? Number(tasa_ea) : null;
            data.num_cuotas          = Number(num_cuotas);
            data.periodicidad        = periodicidad || 'MENSUAL';
            data.fecha_primera_cuota = fecha_primera_cuota ? new Date(fecha_primera_cuota) : new Date();
            data.cuotas              = cuotas;
            data.total               = totalCalc;
            // Vencimiento = fecha de la última cuota
            data.fecha_vencimiento   = cuotas.length ? new Date(cuotas[cuotas.length - 1].fecha_vencimiento) : null;
        } else {
            data.total             = Number(total) || 0;
            data.fecha_vencimiento = fecha_vencimiento ? new Date(fecha_vencimiento) : null;
        }

        const cuenta = await prisma.cuentas_por_pagar.create({ data });

        return res.status(201).json(cuenta);
    } catch (err) {
        console.error('createCuentaPorPagar:', err);
        return res.status(500).json({ message: 'Error al crear cuenta por pagar', error: err.message });
    }
};

// ─── 2. LISTAR ────────────────────────────────────────────────────────────────
export const getCuentasPorPagar = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

        const { estado, q } = req.query;

        const conditions = [Prisma.sql`cpp.business_id = ${businessId}`];
        if (estado) conditions.push(Prisma.sql`cpp.estado = ${estado}`);
        if (q) {
            const like = `%${q}%`;
            conditions.push(Prisma.sql`(cpp.titulo ILIKE ${like} OR cpp.proveedor_nombre ILIKE ${like} OR p.nombre ILIKE ${like})`);
        }

        const whereClause = Prisma.join(conditions, ' AND ');

        const rows = await prisma.$queryRaw(Prisma.sql`
            SELECT cpp.*,
                   p.nombre  AS persona_nombre,
                   p.celular AS persona_celular
            FROM cuentas_por_pagar cpp
            LEFT JOIN personas p ON cpp.persona_id = p.id
            WHERE ${whereClause}
            ORDER BY cpp.created_at DESC
        `);

        return res.status(200).json(rows);
    } catch (err) {
        console.error('getCuentasPorPagar:', err);
        return res.status(500).json({ message: 'Error al obtener cuentas por pagar' });
    }
};

// ─── 3. OBTENER UNA ───────────────────────────────────────────────────────────
export const getCuentaPorPagarById = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        const { id } = req.params;

        const [row] = await prisma.$queryRaw(Prisma.sql`
            SELECT cpp.*,
                   p.nombre  AS persona_nombre,
                   p.celular AS persona_celular,
                   p.email   AS persona_email
            FROM cuentas_por_pagar cpp
            LEFT JOIN personas p ON cpp.persona_id = p.id
            WHERE cpp.id = ${Number(id)} AND cpp.business_id = ${businessId}
        `);

        if (!row) return res.status(404).json({ message: 'Cuenta por pagar no encontrada' });
        return res.status(200).json(row);
    } catch (err) {
        console.error('getCuentaPorPagarById:', err);
        return res.status(500).json({ message: 'Error al obtener cuenta por pagar' });
    }
};

// ─── 4. ACTUALIZAR ────────────────────────────────────────────────────────────
export const updateCuentaPorPagar = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        const { id }     = req.params;

        const allowed = [
            'titulo', 'persona_id', 'proveedor_nombre', 'total',
            'notas', 'estado', 'fecha_emision', 'fecha_vencimiento', 'fecha_pago',
        ];
        const dateFields = new Set(['fecha_emision', 'fecha_vencimiento', 'fecha_pago']);

        const updateData = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) {
                if (dateFields.has(key)) {
                    updateData[key] = req.body[key] ? new Date(req.body[key]) : null;
                } else if (key === 'total') {
                    updateData[key] = Number(req.body[key]) || 0;
                } else {
                    updateData[key] = req.body[key];
                }
            }
        }

        const prev = await prisma.cuentas_por_pagar.findFirst({
            where: { id: Number(id), business_id: businessId },
            select: { id: true, es_prestamo: true, total_abonado: true },
        });
        if (!prev) return res.status(404).json({ message: 'Cuenta por pagar no encontrada' });

        // ── Préstamo: maneja crear/convertir/editar/quitar cronograma ──
        const seraPrestamo = req.body.es_prestamo !== undefined ? !!req.body.es_prestamo : !!prev.es_prestamo;
        const yaAbonado    = Number(prev.total_abonado || 0) > 0;

        if (req.body.es_prestamo !== undefined) {
            updateData.es_prestamo = seraPrestamo;
        }

        if (seraPrestamo) {
            const esConversion      = !prev.es_prestamo; // antes no era préstamo
            const cambianParametros =
                req.body.capital !== undefined || req.body.tasa_ea !== undefined ||
                req.body.num_cuotas !== undefined || req.body.fecha_primera_cuota !== undefined;

            if (esConversion || cambianParametros) {
                if (yaAbonado) {
                    return res.status(400).json({
                        message: prev.es_prestamo
                            ? 'No se pueden cambiar los parámetros del préstamo porque ya tiene cuotas pagadas.'
                            : 'No se puede convertir a préstamo una cuenta que ya tiene abonos registrados.',
                    });
                }
                const { capital, tasa_ea, num_cuotas, fecha_primera_cuota } = req.body;
                if (!(Number(capital) > 0) || !(Number(num_cuotas) > 0)) {
                    return res.status(400).json({ message: 'El préstamo requiere capital y número de cuotas válidos.' });
                }
                const { cuotas, total: totalCalc } = generarCronogramaPrestamo({ capital, tasa_ea, num_cuotas, fecha_primera_cuota });
                updateData.es_prestamo         = true;
                updateData.capital             = Number(capital);
                updateData.tasa_ea             = tasa_ea != null ? Number(tasa_ea) : null;
                updateData.num_cuotas          = Number(num_cuotas);
                updateData.periodicidad        = req.body.periodicidad || 'MENSUAL';
                updateData.fecha_primera_cuota = fecha_primera_cuota ? new Date(fecha_primera_cuota) : new Date();
                updateData.cuotas              = cuotas;
                updateData.total               = totalCalc;
                updateData.fecha_vencimiento   = cuotas.length ? new Date(cuotas[cuotas.length - 1].fecha_vencimiento) : null;
            }
        } else if (prev.es_prestamo && req.body.es_prestamo === false) {
            // Quitar el préstamo y volver a cuenta simple
            if (yaAbonado) {
                return res.status(400).json({ message: 'No se puede quitar el préstamo porque ya tiene cuotas pagadas.' });
            }
            updateData.es_prestamo         = false;
            updateData.cuotas              = [];
            updateData.capital             = null;
            updateData.tasa_ea             = null;
            updateData.num_cuotas          = null;
            updateData.fecha_primera_cuota = null;
            // total y fecha_vencimiento llegan desde el body (campos permitidos)
        }

        if (!Object.keys(updateData).length) {
            return res.status(400).json({ message: 'Sin campos para actualizar' });
        }

        // Si se marca PAGADA manualmente, registrar fecha de pago
        if (updateData.estado === 'PAGADA' && updateData.fecha_pago === undefined) {
            updateData.fecha_pago = new Date();
        }

        const cuenta = await prisma.cuentas_por_pagar.update({
            where: { id: Number(id) },
            data:  { ...updateData, updated_at: new Date() },
        });

        return res.status(200).json(cuenta);
    } catch (err) {
        console.error('updateCuentaPorPagar:', err);
        return res.status(500).json({ message: 'Error al actualizar cuenta por pagar' });
    }
};

// ─── 5. ELIMINAR ──────────────────────────────────────────────────────────────
export const deleteCuentaPorPagar = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        const { id } = req.params;

        const cuenta = await prisma.cuentas_por_pagar.findFirst({
            where: { id: Number(id), business_id: businessId },
            select: { id: true },
        });
        if (!cuenta) return res.status(404).json({ message: 'Cuenta por pagar no encontrada' });

        await prisma.cuentas_por_pagar.delete({ where: { id: Number(id) } });

        return res.status(200).json({ message: 'Cuenta por pagar eliminada', id: Number(id) });
    } catch (err) {
        console.error('deleteCuentaPorPagar:', err);
        return res.status(500).json({ message: 'Error al eliminar cuenta por pagar' });
    }
};

// ─── 6. REGISTRAR ABONO ───────────────────────────────────────────────────────
export const registrarAbono = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        const { id }     = req.params;
        const { monto, cuenta = 'Efectivo', nota } = req.body;

        const montoNum = Number(monto);
        if (!montoNum || montoNum <= 0) {
            return res.status(400).json({ message: 'El monto del abono debe ser mayor a 0' });
        }

        const cuentaActualizada = await prisma.$transaction(async (tx) => {
            const prev = await tx.cuentas_por_pagar.findFirst({
                where: { id: Number(id), business_id: businessId },
            });
            if (!prev) throw Object.assign(new Error('Cuenta por pagar no encontrada'), { status: 404 });
            if (prev.estado === 'ANULADA') throw Object.assign(new Error('La cuenta está anulada'), { status: 400 });
            if (prev.estado === 'PAGADA')  throw Object.assign(new Error('La cuenta ya está pagada'), { status: 400 });

            const abonosAnt = Array.isArray(prev.abonos)
                ? prev.abonos
                : (typeof prev.abonos === 'string' ? JSON.parse(prev.abonos || '[]') : []);

            const nuevoAbono   = { id: uuidv4(), fecha: new Date().toISOString(), monto: montoNum, cuenta, nota: nota || null };
            const abonosNuevos = [...abonosAnt, nuevoAbono];
            const totalAbonado = abonosNuevos.reduce((s, a) => s + Number(a.monto), 0);
            const totalCuenta  = Number(prev.total);
            const pagadoFull   = totalAbonado >= totalCuenta;

            if (pagadoFull) {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE cuentas_por_pagar SET
                        abonos        = ${JSON.stringify(abonosNuevos)}::jsonb,
                        total_abonado = ${totalAbonado},
                        estado        = 'PAGADA',
                        fecha_pago    = NOW(),
                        updated_at    = NOW()
                    WHERE id = ${Number(id)}
                `);
            } else {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE cuentas_por_pagar SET
                        abonos        = ${JSON.stringify(abonosNuevos)}::jsonb,
                        total_abonado = ${totalAbonado},
                        estado        = 'ABONO',
                        updated_at    = NOW()
                    WHERE id = ${Number(id)}
                `);
            }

            const [updated] = await tx.$queryRaw(Prisma.sql`
                SELECT * FROM cuentas_por_pagar WHERE id = ${Number(id)}
            `);
            return updated;
        });

        return res.status(200).json(cuentaActualizada);
    } catch (err) {
        console.error('registrarAbono (cuentaPorPagar):', err);
        const status = err.status || 500;
        return res.status(status).json({ message: err.message || 'Error al registrar abono' });
    }
};

// ─── Helper: recalcular estado/total_abonado de un préstamo desde sus cuotas ──
const sincronizarPrestamo = (cuotas) => {
    const lista = Array.isArray(cuotas)
        ? cuotas
        : (typeof cuotas === 'string' ? JSON.parse(cuotas || '[]') : []);
    const totalAbonado = lista
        .filter((c) => c.estado === 'PAGADA')
        .reduce((s, c) => s + Number(c.valor || 0), 0);
    const todasPagadas = lista.length > 0 && lista.every((c) => c.estado === 'PAGADA');
    const algunaPagada = lista.some((c) => c.estado === 'PAGADA');
    const estado = todasPagadas ? 'PAGADA' : (algunaPagada ? 'ABONO' : 'PENDIENTE');
    return { lista, totalAbonado: round2(totalAbonado), estado, todasPagadas };
};

// ─── 7. PAGAR CUOTA DE PRÉSTAMO ───────────────────────────────────────────────
export const pagarCuota = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        const { id, numero } = req.params;
        const { cuenta = 'Efectivo', fecha_pago, nota } = req.body;
        const numCuota = Number(numero);

        const actualizada = await prisma.$transaction(async (tx) => {
            const prev = await tx.cuentas_por_pagar.findFirst({
                where: { id: Number(id), business_id: businessId },
            });
            if (!prev) throw Object.assign(new Error('Cuenta por pagar no encontrada'), { status: 404 });
            if (!prev.es_prestamo) throw Object.assign(new Error('Esta cuenta no es un préstamo'), { status: 400 });

            const { lista } = sincronizarPrestamo(prev.cuotas);
            const cuota = lista.find((c) => Number(c.numero) === numCuota);
            if (!cuota) throw Object.assign(new Error('Cuota no encontrada'), { status: 404 });
            if (cuota.estado === 'PAGADA') throw Object.assign(new Error('La cuota ya está pagada'), { status: 400 });

            cuota.estado     = 'PAGADA';
            cuota.fecha_pago = fecha_pago || new Date().toISOString().slice(0, 10);
            cuota.cuenta     = cuenta;
            cuota.nota       = nota || null;

            const { totalAbonado, estado, todasPagadas } = sincronizarPrestamo(lista);

            await tx.$executeRaw(Prisma.sql`
                UPDATE cuentas_por_pagar SET
                    cuotas        = ${JSON.stringify(lista)}::jsonb,
                    total_abonado = ${totalAbonado},
                    estado        = ${estado},
                    fecha_pago    = ${todasPagadas ? new Date() : null},
                    updated_at    = NOW()
                WHERE id = ${Number(id)}
            `);

            const [updated] = await tx.$queryRaw(Prisma.sql`SELECT * FROM cuentas_por_pagar WHERE id = ${Number(id)}`);
            return updated;
        });

        return res.status(200).json(actualizada);
    } catch (err) {
        console.error('pagarCuota:', err);
        const status = err.status || 500;
        return res.status(status).json({ message: err.message || 'Error al pagar cuota' });
    }
};

// ─── 8. REVERTIR PAGO DE CUOTA ────────────────────────────────────────────────
export const revertirCuota = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        const { id, numero } = req.params;
        const numCuota = Number(numero);

        const actualizada = await prisma.$transaction(async (tx) => {
            const prev = await tx.cuentas_por_pagar.findFirst({
                where: { id: Number(id), business_id: businessId },
            });
            if (!prev) throw Object.assign(new Error('Cuenta por pagar no encontrada'), { status: 404 });
            if (!prev.es_prestamo) throw Object.assign(new Error('Esta cuenta no es un préstamo'), { status: 400 });

            const { lista } = sincronizarPrestamo(prev.cuotas);
            const cuota = lista.find((c) => Number(c.numero) === numCuota);
            if (!cuota) throw Object.assign(new Error('Cuota no encontrada'), { status: 404 });
            if (cuota.estado !== 'PAGADA') throw Object.assign(new Error('La cuota no está pagada'), { status: 400 });

            cuota.estado     = 'PENDIENTE';
            cuota.fecha_pago = null;
            cuota.cuenta     = null;
            cuota.nota       = null;

            const { totalAbonado, estado, todasPagadas } = sincronizarPrestamo(lista);

            await tx.$executeRaw(Prisma.sql`
                UPDATE cuentas_por_pagar SET
                    cuotas        = ${JSON.stringify(lista)}::jsonb,
                    total_abonado = ${totalAbonado},
                    estado        = ${estado},
                    fecha_pago    = ${todasPagadas ? new Date() : null},
                    updated_at    = NOW()
                WHERE id = ${Number(id)}
            `);

            const [updated] = await tx.$queryRaw(Prisma.sql`SELECT * FROM cuentas_por_pagar WHERE id = ${Number(id)}`);
            return updated;
        });

        return res.status(200).json(actualizada);
    } catch (err) {
        console.error('revertirCuota:', err);
        const status = err.status || 500;
        return res.status(status).json({ message: err.message || 'Error al revertir cuota' });
    }
};

// ─── 9. ESTADÍSTICAS ──────────────────────────────────────────────────────────
export const getEstadisticasCuentasPorPagar = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

        const rows = await prisma.$queryRaw(Prisma.sql`
            SELECT
                estado,
                COUNT(*)::int                            AS cantidad,
                COALESCE(SUM(total), 0)                  AS total_suma,
                COALESCE(SUM(total_abonado), 0)          AS abonado_suma,
                COALESCE(SUM(total - total_abonado), 0)  AS saldo_suma
            FROM cuentas_por_pagar
            WHERE business_id = ${businessId}
            GROUP BY estado
            ORDER BY estado
        `);

        return res.status(200).json(rows);
    } catch (err) {
        console.error('getEstadisticasCuentasPorPagar:', err);
        return res.status(500).json({ message: 'Error al obtener estadísticas' });
    }
};
