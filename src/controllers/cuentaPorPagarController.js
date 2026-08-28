import prisma from '../prisma.js';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { toDateOnly, hoyDateOnly, dateOnlyStr, sumarMeses, serializeFechas } from '../utils/fechas.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Fechas «solo día»: ver BACKEND/src/utils/fechas.js
const CAMPOS_FECHA = ['fecha_emision', 'fecha_vencimiento', 'fecha_pago'];
const serializeCuenta = (row) => serializeFechas(row, CAMPOS_FECHA);

// ─── Cuotas ───────────────────────────────────────────────────────────────────
// Una cuenta se paga en N cuotas de un valor fijo (N = 1 es el caso normal).
// El total es N × valor_cuota, y el vencimiento cae N meses después de la emisión.
const normalizarNumCuotas = (v) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 1;
};

const vencimientoPorCuotas = (fechaEmision, numCuotas) =>
    sumarMeses(toDateOnly(fechaEmision) || hoyDateOnly(), normalizarNumCuotas(numCuotas));

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
            num_cuotas,
            valor_cuota,
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
            fecha_emision:     toDateOnly(fecha_emision) || hoyDateOnly(),
        };

        const cuotas = normalizarNumCuotas(num_cuotas);
        const valorCuota = Number(valor_cuota);
        data.num_cuotas  = cuotas;
        // Con valor de cuota manda N × valor; si no, se respeta el total que llegue.
        if (Number.isFinite(valorCuota) && valorCuota > 0) {
            data.valor_cuota = round2(valorCuota);
            data.total       = round2(cuotas * valorCuota);
        } else {
            data.total       = round2(Number(total) || 0);
            data.valor_cuota = cuotas > 0 ? round2(data.total / cuotas) : null;
        }
        // El vencimiento explícito manda; si no llega, se deduce del número de cuotas.
        data.fecha_vencimiento = toDateOnly(fecha_vencimiento)
            || vencimientoPorCuotas(data.fecha_emision, cuotas);

        const cuenta = await prisma.cuentas_por_pagar.create({ data });

        return res.status(201).json(serializeCuenta(cuenta));
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
            conditions.push(Prisma.sql`(cpp.titulo ILIKE ${like} OR cpp.proveedor_nombre ILIKE ${like} OR p.nombre ILIKE ${like} OR p.apellido ILIKE ${like})`);
        }

        const whereClause = Prisma.join(conditions, ' AND ');

        const rows = await prisma.$queryRaw(Prisma.sql`
            SELECT cpp.*,
                   NULLIF(TRIM(CONCAT(p.nombre, ' ', COALESCE(p.apellido, ''))), '') AS persona_nombre,
                   p.celular AS persona_celular
            FROM cuentas_por_pagar cpp
            LEFT JOIN personas p ON cpp.persona_id = p.id
            WHERE ${whereClause}
            ORDER BY cpp.created_at DESC
        `);

        return res.status(200).json(rows.map(serializeCuenta));
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
                   NULLIF(TRIM(CONCAT(p.nombre, ' ', COALESCE(p.apellido, ''))), '') AS persona_nombre,
                   p.celular AS persona_celular,
                   p.email   AS persona_email
            FROM cuentas_por_pagar cpp
            LEFT JOIN personas p ON cpp.persona_id = p.id
            WHERE cpp.id = ${Number(id)} AND cpp.business_id = ${businessId}
        `);

        if (!row) return res.status(404).json({ message: 'Cuenta por pagar no encontrada' });
        return res.status(200).json(serializeCuenta(row));
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
            'num_cuotas', 'valor_cuota',
        ];
        const dateFields = new Set(['fecha_emision', 'fecha_vencimiento', 'fecha_pago']);

        const updateData = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) {
                if (dateFields.has(key)) {
                    updateData[key] = toDateOnly(req.body[key]);
                } else if (key === 'total' || key === 'valor_cuota') {
                    updateData[key] = round2(Number(req.body[key]) || 0);
                } else if (key === 'num_cuotas') {
                    updateData[key] = normalizarNumCuotas(req.body[key]);
                } else {
                    updateData[key] = req.body[key];
                }
            }
        }

        const prev = await prisma.cuentas_por_pagar.findFirst({
            where: { id: Number(id), business_id: businessId },
            select: { id: true, total: true, num_cuotas: true, valor_cuota: true, fecha_emision: true },
        });
        if (!prev) return res.status(404).json({ message: 'Cuenta por pagar no encontrada' });

        // ── Cuotas: total = N × valor_cuota, y el vencimiento sigue al número de cuotas ──
        const cambiaCuotas = req.body.num_cuotas  !== undefined;
        const cambiaValor  = req.body.valor_cuota !== undefined;

        if (cambiaCuotas || cambiaValor) {
            const cuotas = cambiaCuotas ? updateData.num_cuotas : normalizarNumCuotas(prev.num_cuotas);
            const valor  = cambiaValor
                ? updateData.valor_cuota
                : Number(prev.valor_cuota || 0);

            if (valor > 0) {
                updateData.num_cuotas  = cuotas;
                updateData.valor_cuota = round2(valor);
                // Un total explícito en el mismo request manda sobre el calculado.
                if (req.body.total === undefined) updateData.total = round2(cuotas * valor);
            } else if (cambiaCuotas) {
                updateData.num_cuotas = cuotas;
            }

            // Solo se recalcula si el cliente no mandó un vencimiento propio.
            if (cambiaCuotas && req.body.fecha_vencimiento === undefined) {
                const emision = req.body.fecha_emision !== undefined
                    ? updateData.fecha_emision
                    : prev.fecha_emision;
                updateData.fecha_vencimiento = vencimientoPorCuotas(emision, cuotas);
            }
        }

        if (!Object.keys(updateData).length) {
            return res.status(400).json({ message: 'Sin campos para actualizar' });
        }

        // Si se marca PAGADA manualmente, registrar fecha de pago
        if (updateData.estado === 'PAGADA' && updateData.fecha_pago === undefined) {
            updateData.fecha_pago = hoyDateOnly();
        }

        const cuenta = await prisma.cuentas_por_pagar.update({
            where: { id: Number(id) },
            data:  { ...updateData, updated_at: new Date() },
        });

        return res.status(200).json(serializeCuenta(cuenta));
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
                        fecha_pago    = ${dateOnlyStr(hoyDateOnly())}::date,
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

        return res.status(200).json(serializeCuenta(cuentaActualizada));
    } catch (err) {
        console.error('registrarAbono (cuentaPorPagar):', err);
        const status = err.status || 500;
        return res.status(status).json({ message: err.message || 'Error al registrar abono' });
    }
};

// ─── 6b. AUMENTAR DEUDA ───────────────────────────────────────────────────────
// Suma un monto al total de una cuenta existente (misma persona vuelve a prestar).
// Deja rastro en `cargos` y recalcula estado/fecha_pago.
export const aumentarDeuda = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        const { id }     = req.params;
        const { monto, nota } = req.body;

        const montoNum = Number(monto);
        if (!montoNum || montoNum <= 0) {
            return res.status(400).json({ message: 'El monto a aumentar debe ser mayor a 0' });
        }

        const cuentaActualizada = await prisma.$transaction(async (tx) => {
            // Lectura vía SQL crudo: incluye `cargos` aunque el cliente Prisma aún no
            // esté regenerado (evita perder el historial de aumentos).
            const [prev] = await tx.$queryRaw(Prisma.sql`
                SELECT * FROM cuentas_por_pagar
                WHERE id = ${Number(id)} AND business_id = ${businessId}
            `);
            if (!prev) throw Object.assign(new Error('Cuenta por pagar no encontrada'), { status: 404 });
            if (prev.estado === 'ANULADA') throw Object.assign(new Error('La cuenta está anulada'), { status: 400 });

            const cargosAnt = Array.isArray(prev.cargos)
                ? prev.cargos
                : (typeof prev.cargos === 'string' ? JSON.parse(prev.cargos || '[]') : []);

            const nuevoCargo   = { id: uuidv4(), fecha: new Date().toISOString(), monto: montoNum, nota: nota || null };
            const cargosNuevos = [...cargosAnt, nuevoCargo];

            const nuevoTotal   = round2(Number(prev.total || 0) + montoNum);
            const totalAbonado = Number(prev.total_abonado || 0);
            const nuevoEstado  = totalAbonado >= nuevoTotal ? 'PAGADA' : (totalAbonado > 0 ? 'ABONO' : 'PENDIENTE');
            const fechaPago    = nuevoEstado === 'PAGADA' ? prev.fecha_pago : null;

            await tx.$executeRaw(Prisma.sql`
                UPDATE cuentas_por_pagar SET
                    cargos     = ${JSON.stringify(cargosNuevos)}::jsonb,
                    total      = ${nuevoTotal},
                    estado     = ${nuevoEstado},
                    fecha_pago = ${dateOnlyStr(fechaPago)}::date,
                    updated_at = NOW()
                WHERE id = ${Number(id)}
            `);

            const [updated] = await tx.$queryRaw(Prisma.sql`SELECT * FROM cuentas_por_pagar WHERE id = ${Number(id)}`);
            return updated;
        });

        return res.status(200).json(serializeCuenta(cuentaActualizada));
    } catch (err) {
        console.error('aumentarDeuda (cuentaPorPagar):', err);
        const status = err.status || 500;
        return res.status(status).json({ message: err.message || 'Error al aumentar la deuda' });
    }
};

// ─── 6c. EDITAR EL MONTO DE UN MOVIMIENTO ─────────────────────────────────────
// Corrige el valor de una línea del estado de cuenta sin tener que borrar y rehacer:
//   movId = 'inicial'  -> deuda base (total menos los aumentos)
//   movId = <uuid>     -> un abono o un aumento ya registrado
// Si la cuenta tiene cuotas, al corregir el inicial se reparte de nuevo el valor de cuota.
export const editarMontoMovimiento = async (req, res) => {
    try {
        const businessId    = req.user?.bid;
        const { id, movId } = req.params;
        const { monto }     = req.body;

        const montoNum = Number(monto);
        if (!Number.isFinite(montoNum) || montoNum <= 0) {
            return res.status(400).json({ message: 'El monto debe ser mayor a 0' });
        }

        const cuentaActualizada = await prisma.$transaction(async (tx) => {
            const [prev] = await tx.$queryRaw(Prisma.sql`
                SELECT * FROM cuentas_por_pagar
                WHERE id = ${Number(id)} AND business_id = ${businessId}
            `);
            if (!prev) throw Object.assign(new Error('Cuenta por pagar no encontrada'), { status: 404 });
            if (prev.estado === 'ANULADA') throw Object.assign(new Error('La cuenta está anulada'), { status: 400 });

            const parseArr = (raw) => (Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw || '[]') : []));
            const abonos = parseArr(prev.abonos);
            const cargos = parseArr(prev.cargos);

            const sumCargos = cargos.reduce((s, c) => s + Number(c.monto || 0), 0);
            // La deuda base es el total sin los aumentos posteriores.
            let base = round2(Number(prev.total || 0) - sumCargos);

            if (movId === 'inicial') {
                base = round2(montoNum);
            } else {
                const cargo = cargos.find((c) => String(c.id) === String(movId));
                const abono = abonos.find((a) => String(a.id) === String(movId));

                if (cargo)      cargo.monto = round2(montoNum);
                else if (abono) abono.monto = round2(montoNum);
                else throw Object.assign(new Error('Movimiento no encontrado'), { status: 404 });
            }

            const sumCargosNuevo = cargos.reduce((s, c) => s + Number(c.monto || 0), 0);
            const nuevoTotal     = round2(base + sumCargosNuevo);
            if (nuevoTotal <= 0) {
                throw Object.assign(new Error('El total de la cuenta quedaría en cero o negativo'), { status: 400 });
            }

            const totalAbonado = round2(abonos.reduce((s, a) => s + Number(a.monto || 0), 0));
            // El valor de cuota sigue al nuevo total para que N × valor cuadre.
            const numCuotas  = normalizarNumCuotas(prev.num_cuotas);
            const valorCuota = round2(nuevoTotal / numCuotas);

            const nuevoEstado = totalAbonado >= nuevoTotal ? 'PAGADA' : (totalAbonado > 0 ? 'ABONO' : 'PENDIENTE');
            const fechaPago   = nuevoEstado === 'PAGADA' ? (prev.fecha_pago || hoyDateOnly()) : null;

            await tx.$executeRaw(Prisma.sql`
                UPDATE cuentas_por_pagar SET
                    abonos        = ${JSON.stringify(abonos)}::jsonb,
                    cargos        = ${JSON.stringify(cargos)}::jsonb,
                    total         = ${nuevoTotal},
                    valor_cuota   = ${valorCuota},
                    total_abonado = ${totalAbonado},
                    estado        = ${nuevoEstado},
                    fecha_pago    = ${dateOnlyStr(fechaPago)}::date,
                    updated_at    = NOW()
                WHERE id = ${Number(id)}
            `);

            const [updated] = await tx.$queryRaw(Prisma.sql`SELECT * FROM cuentas_por_pagar WHERE id = ${Number(id)}`);
            return updated;
        });

        return res.status(200).json(serializeCuenta(cuentaActualizada));
    } catch (err) {
        console.error('editarMontoMovimiento:', err);
        const status = err.status || 500;
        return res.status(status).json({ message: err.message || 'Error al editar el movimiento' });
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

        // ── Lo que se paga cada mes ──────────────────────────────────────────
        // Una cuenta de N cuotas se paga una cuota por mes. `fecha_vencimiento`
        // guarda la ÚLTIMA cuota, así que agrupar por ella metería un plan a 48
        // cuotas entero en 2030 y no contaría nada en los meses que sí se pagan.
        // El mes vale, entonces, una cuota de cada cuenta que aún deba algo.
        const hoy    = hoyDateOnly();
        const desde  = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
        const hasta  = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 1));

        const [cuotas] = await prisma.$queryRaw(Prisma.sql`
            WITH pendientes AS (
                SELECT
                    COALESCE(valor_cuota, total) AS valor_cuota,
                    (COALESCE(total, 0) - COALESCE(total_abonado, 0)) AS saldo
                FROM cuentas_por_pagar
                WHERE business_id = ${businessId}
                  AND estado NOT IN ('PAGADA', 'ANULADA')
                  AND (COALESCE(total, 0) - COALESCE(total_abonado, 0)) > 0
            ), conCuota AS (
                SELECT saldo, LEAST(valor_cuota, saldo) AS cuota_mes, valor_cuota
                FROM pendientes
            )
            SELECT
                COUNT(*)::int                                                  AS cantidad,
                COALESCE(SUM(cuota_mes), 0)                                    AS cuota_mes,
                COUNT(*) FILTER (WHERE saldo - cuota_mes > 0)::int              AS cantidad_sig,
                COALESCE(SUM(LEAST(valor_cuota, saldo - cuota_mes)), 0)         AS cuota_sig
            FROM conCuota
        `);

        // Abonado dentro del mes en curso (por la fecha del abono, no del vencimiento).
        const [abonadoMes] = await prisma.$queryRaw(Prisma.sql`
            SELECT COALESCE(SUM((a->>'monto')::numeric), 0) AS pagado
            FROM cuentas_por_pagar c
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.abonos, '[]'::jsonb)) AS a
            WHERE c.business_id = ${businessId}
              AND c.estado <> 'ANULADA'
              AND (a->>'fecha') IS NOT NULL
              AND (a->>'fecha')::timestamptz >= ${dateOnlyStr(desde)}::date
              AND (a->>'fecha')::timestamptz <  ${dateOnlyStr(hasta)}::date
        `);

        const totalMes  = Number(cuotas?.cuota_mes || 0);
        const pagadoMes = Number(abonadoMes?.pagado || 0);

        return res.status(200).json({
            porEstado: rows,
            mes: {
                desde:    dateOnlyStr(desde),
                cantidad: Number(cuotas?.cantidad || 0),
                total:    totalMes,
                pagado:   pagadoMes,
                saldo:    Math.max(0, round2(totalMes - pagadoMes)),
            },
            mesSiguiente: {
                desde:    dateOnlyStr(hasta),
                cantidad: Number(cuotas?.cantidad_sig || 0),
                total:    Number(cuotas?.cuota_sig || 0),
                pagado:   0,
                saldo:    Number(cuotas?.cuota_sig || 0),
            },
        });
    } catch (err) {
        console.error('getEstadisticasCuentasPorPagar:', err);
        return res.status(500).json({ message: 'Error al obtener estadísticas' });
    }
};
