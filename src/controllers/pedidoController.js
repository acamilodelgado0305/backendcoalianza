import prisma from '../prisma.js';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const esProductoServicio = (p) =>
    ['Validacion', 'Tecnico'].includes(p.tipo_programa) ||
    p.tipo_item === 'servicio' ||
    p.cantidad === null;

// ==========================================
// 1. CREAR PEDIDO (CREATE)
// ==========================================
export const createPedido = async (req, res) => {
    try {
        const { persona_id, cliente_nombre, items, observaciones } = req.body;
        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;

        if (!usuarioId)  return res.status(401).json({ message: "Usuario no autenticado" });
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: "El pedido debe contener al menos un producto" });
        }

        const result = await prisma.$transaction(async (tx) => {
            let totalPedido = 0;
            const itemsProcesados = [];

            for (const item of items) {
                const producto = await tx.inventario.findFirst({
                    where: { id: item.inventario_id, business_id: businessId },
                });
                if (!producto) throw new Error(`Producto ID ${item.inventario_id} no encontrado o no autorizado.`);

                const esServicio = esProductoServicio(producto);
                if (!esServicio && producto.cantidad < item.cantidad) {
                    throw new Error(`Stock insuficiente para '${producto.nombre}'. Disponible: ${producto.cantidad}`);
                }

                const precioUnitario = Number(producto.monto);
                totalPedido += precioUnitario * item.cantidad;
                itemsProcesados.push({ producto, cantidad: item.cantidad, precioUnitario, esServicio });
            }

            const pedido = await tx.pedidos.create({
                data: {
                    persona_id:    persona_id || null,
                    cliente_nombre: !persona_id && cliente_nombre ? cliente_nombre.trim() : null,
                    user_id:      usuarioId,
                    business_id:  businessId,
                    total:        totalPedido,
                    observaciones: observaciones || null,
                },
            });

            for (const item of itemsProcesados) {
                await tx.detalle_pedidos.create({
                    data: {
                        pedido_id:      pedido.id,
                        inventario_id:  item.producto.id,
                        cantidad:       item.cantidad,
                        precio_unitario: item.precioUnitario,
                    },
                });
                if (!item.esServicio) {
                    await tx.inventario.update({
                        where: { id: item.producto.id },
                        data:  { cantidad: { decrement: item.cantidad }, updated_at: new Date() },
                    });
                }
            }

            return { pedido_id: pedido.id, total: totalPedido };
        });

        return res.status(201).json({ success: true, message: "Pedido creado exitosamente", data: result });
    } catch (error) {
        console.error("Error creando pedido:", error);
        return res.status(500).json({ message: error.message || "Error interno al crear pedido" });
    }
};

// ==========================================
// 2. LISTAR PEDIDOS (READ - LIST)
// ==========================================
export const getPedidos = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        const { estado, cierre_id } = req.query;

        // json_agg con ORDER BY dentro del aggregate requiere $queryRaw
        const conditions = [Prisma.sql`p.business_id = ${businessId}`];

        if (cierre_id) {
            conditions.push(Prisma.sql`p.cierre_id = ${Number(cierre_id)}`);
        } else {
            conditions.push(Prisma.sql`p.cierre_id IS NULL`);
        }
        if (estado) conditions.push(Prisma.sql`p.estado = ${estado}`);

        const whereClause = Prisma.join(conditions, ' AND ');

        const rows = await prisma.$queryRaw(Prisma.sql`
            SELECT
                p.id, p.total, p.estado, p.created_at, p.observaciones, p.cierre_id,
                p.persona_id,
                COALESCE(pe.nombre, p.cliente_nombre, 'Cliente General') AS cliente_nombre,
                pe.apellido AS cliente_apellido,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'producto', i.nombre,
                            'cantidad', dp.cantidad,
                            'precio',   dp.precio_unitario
                        )
                    ) FILTER (WHERE i.id IS NOT NULL), '[]'
                ) AS items_detalle
            FROM pedidos p
            LEFT JOIN personas pe ON p.persona_id = pe.id
            LEFT JOIN detalle_pedidos dp ON p.id = dp.pedido_id
            LEFT JOIN inventario i       ON dp.inventario_id = i.id
            WHERE ${whereClause}
            GROUP BY p.id, pe.id, pe.nombre, pe.apellido
            ORDER BY p.created_at DESC
        `);

        return res.status(200).json({ data: rows });
    } catch (error) {
        console.error("Error obteniendo pedidos:", error);
        return res.status(500).json({ message: "Error al listar pedidos" });
    }
};

// ==========================================
// 3. OBTENER DETALLE DE PEDIDO (READ - ID)
// ==========================================
export const getPedidoById = async (req, res) => {
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;

        const pedido = await prisma.pedidos.findFirst({
            where: { id: Number(id), business_id: businessId },
            include: {
                personas: {
                    select: { nombre: true, apellido: true, numero_documento: true, tipo_documento: true },
                },
                detalle_pedidos: {
                    include: {
                        inventario: { select: { nombre: true, codigo_barras: true } },
                    },
                },
            },
        });

        if (!pedido) return res.status(404).json({ message: "Pedido no encontrado" });

        // Aplanar para mantener la misma forma de respuesta
        const { personas, detalle_pedidos, ...cabecera } = pedido;
        return res.status(200).json({
            pedido: {
                ...cabecera,
                cliente_nombre:    personas?.nombre,
                cliente_apellido:  personas?.apellido,
                numero_documento:  personas?.numero_documento,
                tipo_documento:    personas?.tipo_documento,
            },
            items: detalle_pedidos.map(dp => ({
                ...dp,
                producto_nombre: dp.inventario?.nombre,
                codigo_barras:   dp.inventario?.codigo_barras,
            })),
        });
    } catch (error) {
        console.error("Error obteniendo detalle pedido:", error);
        return res.status(500).json({ message: "Error interno" });
    }
};

// ==========================================
// 4. CAMBIAR ESTADO DE PEDIDO (UPDATE STATUS)
// ==========================================
export const updateEstadoPedido = async (req, res) => {
    try {
        const { id } = req.params;
        const nuevo_estado   = req.body.nuevo_estado || req.body.estado;
        const cuenta_destino = req.body.cuenta_destino;
        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;

        if (!['PENDIENTE', 'ENTREGADO', 'ANULADO'].includes(nuevo_estado)) {
            return res.status(400).json({ message: "Estado no válido" });
        }

        const updatedPedido = await prisma.$transaction(async (tx) => {
            const pedido = await tx.pedidos.findFirst({
                where: { id: Number(id), business_id: businessId },
                include: { personas: { select: { nombre: true, apellido: true, numero_documento: true, email: true } } },
            });
            if (!pedido) throw Object.assign(new Error("Pedido no encontrado"), { status: 404 });

            const estadoActual = pedido.estado;

            // CASO A: → ANULADO (devolver stock)
            if (nuevo_estado === 'ANULADO' && estadoActual !== 'ANULADO') {
                const detalles = await tx.detalle_pedidos.findMany({
                    where: { pedido_id: Number(id) },
                    include: { inventario: { select: { tipo_programa: true, tipo_item: true } } },
                });
                for (const dp of detalles) {
                    if (!esProductoServicio(dp.inventario)) {
                        await tx.inventario.update({
                            where: { id: dp.inventario_id },
                            data:  { cantidad: { increment: dp.cantidad } },
                        });
                    }
                }
            }

            // CASO B: ANULADO → reactivar (descontar stock)
            if (estadoActual === 'ANULADO' && nuevo_estado !== 'ANULADO') {
                const detalles = await tx.detalle_pedidos.findMany({
                    where: { pedido_id: Number(id) },
                    include: { inventario: { select: { cantidad: true, tipo_programa: true, tipo_item: true } } },
                });
                for (const dp of detalles) {
                    if (!esProductoServicio(dp.inventario)) {
                        if ((dp.inventario.cantidad ?? 0) < dp.cantidad) {
                            throw new Error(`No se puede reactivar: Stock insuficiente para producto ID ${dp.inventario_id}`);
                        }
                        await tx.inventario.update({
                            where: { id: dp.inventario_id },
                            data:  { cantidad: { decrement: dp.cantidad } },
                        });
                    }
                }
            }

            // CASO C: → ENTREGADO (crear ingreso)
            if (nuevo_estado === 'ENTREGADO' && estadoActual !== 'ENTREGADO') {
                const cuentaFinal  = cuenta_destino || 'Caja General';
                const ingresoId    = uuidv4();
                const createdAt    = new Date();
                const fechaVenc    = new Date(createdAt);
                fechaVenc.setFullYear(fechaVenc.getFullYear() + 1);

                await tx.$executeRaw(Prisma.sql`
                    INSERT INTO "public"."ingresos" (
                        "_id","nombre","apellido","numeroDeDocumento","fechaVencimiento",
                        "producto","valor","cuenta","customer_email","payment_status",
                        "payment_reference","usuario","business_id","createdAt","updatedAt","__v",
                        "comprobante_url","persona_id","pedido_id"
                    ) VALUES (
                        ${ingresoId},
                        ${pedido.personas?.nombre  || 'Cliente Ocasional'},
                        ${pedido.personas?.apellido || ''},
                        ${pedido.personas?.numero_documento || '0'},
                        ${fechaVenc},
                        ${'Venta POS - Pedido #' + id},
                        ${Number(pedido.total)},
                        ${cuentaFinal},
                        ${pedido.personas?.email || ''},
                        ${'APPROVED'},
                        ${'PEDIDO-' + id + '-' + Date.now()},
                        ${usuarioId},
                        ${businessId},
                        ${createdAt},
                        ${createdAt},
                        ${'0'},
                        ${''},
                        ${pedido.persona_id},
                        ${Number(id)}
                    )
                `);
            }

            return tx.pedidos.update({
                where: { id: Number(id) },
                data:  { estado: nuevo_estado, updated_at: new Date() },
            });
        });

        return res.status(200).json({
            success: true,
            message: `Pedido actualizado a ${nuevo_estado}`,
            data: updatedPedido,
        });
    } catch (error) {
        console.error("Error actualizando estado:", error);
        const status = error.status || 500;
        return res.status(status).json({ message: error.message || "Error al actualizar estado" });
    }
};

// ==========================================
// 5. ELIMINAR PEDIDO (DELETE)
// ==========================================
export const deletePedido = async (req, res) => {
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;

        await prisma.$transaction(async (tx) => {
            const pedido = await tx.pedidos.findFirst({
                where: { id: Number(id), business_id: businessId },
                select: { estado: true },
            });
            if (!pedido) throw Object.assign(new Error("Pedido no encontrado"), { status: 404 });

            if (pedido.estado !== 'ANULADO') {
                const detalles = await tx.detalle_pedidos.findMany({
                    where: { pedido_id: Number(id) },
                    include: { inventario: { select: { tipo_programa: true, tipo_item: true } } },
                });
                for (const dp of detalles) {
                    if (!esProductoServicio(dp.inventario)) {
                        await tx.inventario.update({
                            where: { id: dp.inventario_id },
                            data:  { cantidad: { increment: dp.cantidad } },
                        });
                    }
                }
            }

            await tx.pedidos.delete({ where: { id: Number(id) } });
        });

        return res.status(200).json({ message: "Pedido eliminado y stock restaurado correctamente" });
    } catch (error) {
        console.error("Error eliminando pedido:", error);
        const status = error.status || 500;
        return res.status(status).json({ message: error.message || "Error interno al eliminar pedido" });
    }
};

// ==========================================
// 6. ACTUALIZAR PEDIDO (UPDATE)
// ==========================================
export const updatePedido = async (req, res) => {
    try {
        const { id } = req.params;
        const { persona_id, cliente_nombre, items, observaciones } = req.body;
        const businessId = req.user?.bid;

        await prisma.$transaction(async (tx) => {
            const pedido = await tx.pedidos.findFirst({
                where: { id: Number(id), business_id: businessId },
                select: { estado: true },
            });
            if (!pedido) throw new Error("Pedido no encontrado");
            if (pedido.estado !== 'PENDIENTE') throw new Error("Solo se pueden editar pedidos PENDIENTES");

            // Restaurar stock anterior
            const oldDetalles = await tx.detalle_pedidos.findMany({
                where: { pedido_id: Number(id) },
                include: { inventario: { select: { tipo_programa: true, tipo_item: true } } },
            });
            for (const dp of oldDetalles) {
                if (!esProductoServicio(dp.inventario)) {
                    await tx.inventario.update({
                        where: { id: dp.inventario_id },
                        data:  { cantidad: { increment: dp.cantidad } },
                    });
                }
            }

            await tx.detalle_pedidos.deleteMany({ where: { pedido_id: Number(id) } });

            let nuevoTotal = 0;
            for (const newItem of items) {
                const producto = await tx.inventario.findFirst({
                    where: { id: newItem.inventario_id, business_id: businessId },
                });
                const esServicio = esProductoServicio(producto);
                if (!esServicio && producto.cantidad < newItem.cantidad) {
                    throw new Error(`Stock insuficiente para producto ID ${producto.id}`);
                }
                nuevoTotal += Number(producto.monto) * newItem.cantidad;
                await tx.detalle_pedidos.create({
                    data: { pedido_id: Number(id), inventario_id: producto.id, cantidad: newItem.cantidad, precio_unitario: producto.monto },
                });
                if (!esServicio) {
                    await tx.inventario.update({
                        where: { id: producto.id },
                        data:  { cantidad: { decrement: newItem.cantidad }, updated_at: new Date() },
                    });
                }
            }

            await tx.pedidos.update({
                where: { id: Number(id) },
                data:  {
                    persona_id:    persona_id || null,
                    cliente_nombre: !persona_id && cliente_nombre ? cliente_nombre.trim() : null,
                    total:         nuevoTotal,
                    observaciones,
                    updated_at:    new Date(),
                },
            });
        });

        return res.json({ success: true, message: "Pedido actualizado correctamente" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: error.message });
    }
};

// ==========================================
// 7. ESTADÍSTICAS DE PEDIDOS
// ==========================================
export const getOrderStats = async (req, res) => {
    try {
        const businessId = req.user?.bid;

        const [kpiRows, estadoRows, productosRows, unidadesRows] = await Promise.all([
            prisma.$queryRaw(Prisma.sql`
                SELECT COUNT(*)::int AS total_pedidos, COALESCE(SUM(total), 0) AS total_ingresos
                FROM pedidos WHERE business_id = ${businessId} AND cierre_id IS NULL
            `),
            prisma.$queryRaw(Prisma.sql`
                SELECT estado, COUNT(*)::int AS cantidad FROM pedidos
                WHERE business_id = ${businessId} AND cierre_id IS NULL GROUP BY estado
            `),
            prisma.$queryRaw(Prisma.sql`
                SELECT i.nombre, SUM(dp.cantidad)::int AS total_vendido
                FROM detalle_pedidos dp
                JOIN pedidos p    ON dp.pedido_id    = p.id
                JOIN inventario i ON dp.inventario_id = i.id
                WHERE p.business_id = ${businessId} AND p.estado != 'ANULADO' AND p.cierre_id IS NULL
                GROUP BY i.nombre ORDER BY total_vendido DESC LIMIT 5
            `),
            prisma.$queryRaw(Prisma.sql`
                SELECT COALESCE(SUM(dp.cantidad), 0)::int AS total_unidades
                FROM detalle_pedidos dp
                JOIN pedidos p ON dp.pedido_id = p.id
                WHERE p.business_id = ${businessId} AND p.estado != 'ANULADO' AND p.cierre_id IS NULL
            `),
        ]);

        return res.json({
            general: {
                total_pedidos:  kpiRows[0]?.total_pedidos  || 0,
                total_ingresos: Number(kpiRows[0]?.total_ingresos || 0),
                total_unidades: unidadesRows[0]?.total_unidades || 0,
            },
            por_estado:    estadoRows.map(r => ({ name: r.estado, value: r.cantidad })),
            top_productos: productosRows.map(r => ({ name: r.nombre, cantidad: r.total_vendido })),
        });
    } catch (error) {
        console.error("Error en estadísticas:", error);
        return res.status(500).json({ message: "Error calculando estadísticas" });
    }
};

// ==========================================
// 8. REALIZAR CIERRE DE CAJA
// ==========================================
export const realizarCierre = async (req, res) => {
    try {
        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;
        const { observaciones } = req.body;

        const result = await prisma.$transaction(async (tx) => {
            const [statsRows] = await tx.$queryRaw(Prisma.sql`
                SELECT COUNT(*)::int AS total_pedidos, COALESCE(SUM(total), 0) AS total_ingresos
                FROM pedidos WHERE business_id = ${businessId} AND cierre_id IS NULL
            `);

            if (statsRows.total_pedidos === 0) {
                throw Object.assign(new Error("No hay pedidos pendientes por cerrar."), { status: 400 });
            }

            const cierre = await tx.cierres.create({
                data: {
                    user_id:        usuarioId,
                    business_id:    businessId,
                    total_ingresos: statsRows.total_ingresos,
                    total_pedidos:  statsRows.total_pedidos,
                    observaciones:  observaciones || 'Cierre manual de ventas',
                },
            });

            await tx.pedidos.updateMany({
                where: { business_id: businessId, cierre_id: null },
                data:  { cierre_id: cierre.id },
            });

            return { cierre_id: cierre.id, total_cerrado: statsRows.total_ingresos, pedidos_archivados: statsRows.total_pedidos };
        });

        return res.status(200).json({
            success: true,
            message: "Cierre realizado con éxito. El dashboard se ha reiniciado.",
            data: result,
        });
    } catch (error) {
        console.error("Error en cierre:", error);
        const status = error.status || 500;
        return res.status(status).json({ message: error.message || "Error al realizar el cierre" });
    }
};

// ==========================================
// 9. HISTORIAL DE CIERRES
// ==========================================
export const getCierres = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        const cierres = await prisma.cierres.findMany({
            where:   { business_id: businessId },
            orderBy: { fecha_cierre: 'desc' },
            take: 20,
        });
        return res.status(200).json({ data: cierres });
    } catch (error) {
        console.error("Error obteniendo cierres:", error);
        return res.status(500).json({ message: "Error al obtener historial" });
    }
};
