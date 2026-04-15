import pool from "../database.js";
import { v4 as uuidv4 } from 'uuid';

// ==========================================
// 1. CREAR PEDIDO (CREATE)
// ==========================================
export const createPedido = async (req, res) => {
    const client = await pool.connect();
    try {
        const { persona_id, items, observaciones } = req.body;
        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;

        if (!usuarioId)  return res.status(401).json({ message: "Usuario no autenticado" });
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });
        if (!persona_id) return res.status(400).json({ message: "Se requiere un cliente (persona_id)" });
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: "El pedido debe contener al menos un producto" });
        }

        await client.query('BEGIN');

        let totalPedido = 0;
        const itemsProcesados = [];

        for (const item of items) {
            const prodRes = await client.query(
                `SELECT id, nombre, monto, cantidad, tipo_programa
                 FROM "public"."inventario"
                 WHERE id = $1 AND business_id = $2
                 FOR UPDATE`,
                [item.inventario_id, businessId]
            );

            if (prodRes.rows.length === 0) {
                throw new Error(`Producto ID ${item.inventario_id} no encontrado o no autorizado.`);
            }

            const producto = prodRes.rows[0];
            const esServicio = ['Validacion', 'Tecnico'].includes(producto.tipo_programa);

            if (!esServicio && producto.cantidad < item.cantidad) {
                throw new Error(`Stock insuficiente para '${producto.nombre}'. Disponible: ${producto.cantidad}`);
            }

            const precioUnitario = Number(producto.monto);
            totalPedido += precioUnitario * item.cantidad;

            itemsProcesados.push({
                inventario_id: producto.id,
                cantidad: item.cantidad,
                precio_unitario: precioUnitario,
                es_servicio: esServicio
            });
        }

        const pedidoRes = await client.query(
            `INSERT INTO "public"."pedidos"
             ("persona_id", "user_id", "business_id", "total", "estado", "observaciones", "created_at", "updated_at")
             VALUES ($1, $2, $3, $4, 'PENDIENTE', $5, NOW(), NOW())
             RETURNING id`,
            [persona_id, usuarioId, businessId, totalPedido, observaciones]
        );
        const pedidoId = pedidoRes.rows[0].id;

        for (const item of itemsProcesados) {
            await client.query(
                `INSERT INTO "public"."detalle_pedidos"
                 ("pedido_id", "inventario_id", "cantidad", "precio_unitario")
                 VALUES ($1, $2, $3, $4)`,
                [pedidoId, item.inventario_id, item.cantidad, item.precio_unitario]
            );
            if (!item.es_servicio) {
                await client.query(
                    `UPDATE "public"."inventario" SET cantidad = cantidad - $1, updated_at = NOW() WHERE id = $2`,
                    [item.cantidad, item.inventario_id]
                );
            }
        }

        await client.query('COMMIT');
        return res.status(201).json({
            success: true,
            message: "Pedido creado exitosamente",
            data: { pedido_id: pedidoId, total: totalPedido }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error creando pedido:", error);
        return res.status(500).json({ message: error.message || "Error interno al crear pedido" });
    } finally {
        client.release();
    }
};

// ==========================================
// 2. LISTAR PEDIDOS (READ - LIST)
// ==========================================
export const getPedidos = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        const { estado, cierre_id } = req.query;

        let whereClause = `WHERE p.business_id = $1`;
        const values = [businessId];
        let counter = 2;

        if (cierre_id) {
            whereClause += ` AND p.cierre_id = $${counter}`;
            values.push(cierre_id);
            counter++;
        } else {
            whereClause += ` AND p.cierre_id IS NULL`;
        }

        if (estado) {
            whereClause += ` AND p.estado = $${counter}`;
            values.push(estado);
            counter++;
        }

        const query = `
            SELECT
                p.id, p.total, p.estado, p.created_at, p.observaciones, p.cierre_id,
                pe.nombre as cliente_nombre, pe.apellido as cliente_apellido,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'producto', i.nombre,
                            'cantidad', dp.cantidad,
                            'precio', dp.precio_unitario
                        )
                    ) FILTER (WHERE i.id IS NOT NULL), '[]'
                ) as items_detalle
            FROM "public"."pedidos" p
            JOIN "public"."personas" pe ON p.persona_id = pe.id
            LEFT JOIN "public"."detalle_pedidos" dp ON p.id = dp.pedido_id
            LEFT JOIN "public"."inventario" i ON dp.inventario_id = i.id
            ${whereClause}
            GROUP BY p.id, pe.id
            ORDER BY p.created_at DESC
        `;

        const result = await pool.query(query, values);
        return res.status(200).json({ data: result.rows });

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

        const cabeceraRes = await pool.query(
            `SELECT p.*, pe.nombre as cliente_nombre, pe.apellido as cliente_apellido,
                    pe.numero_documento, pe.tipo_documento
             FROM "public"."pedidos" p
             JOIN "public"."personas" pe ON p.persona_id = pe.id
             WHERE p.id = $1 AND p.business_id = $2`,
            [id, businessId]
        );

        if (cabeceraRes.rows.length === 0) {
            return res.status(404).json({ message: "Pedido no encontrado" });
        }

        const itemsRes = await pool.query(
            `SELECT dp.*, i.nombre as producto_nombre, i.codigo_barras
             FROM "public"."detalle_pedidos" dp
             JOIN "public"."inventario" i ON dp.inventario_id = i.id
             WHERE dp.pedido_id = $1`,
            [id]
        );

        return res.status(200).json({ pedido: cabeceraRes.rows[0], items: itemsRes.rows });

    } catch (error) {
        console.error("Error obteniendo detalle pedido:", error);
        return res.status(500).json({ message: "Error interno" });
    }
};

// ==========================================
// 4. CAMBIAR ESTADO DE PEDIDO (UPDATE STATUS)
// ==========================================
export const updateEstadoPedido = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const nuevo_estado   = req.body.nuevo_estado || req.body.estado;
        const cuenta_destino = req.body.cuenta_destino;
        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;

        if (!['PENDIENTE', 'ENTREGADO', 'ANULADO'].includes(nuevo_estado)) {
            return res.status(400).json({ message: "Estado no válido" });
        }

        await client.query('BEGIN');

        const checkRes = await client.query(
            `SELECT p.estado, p.total, p.persona_id,
                    per.nombre, per.apellido, per.numero_documento, per.email
             FROM "public"."pedidos" p
             LEFT JOIN "public"."personas" per ON p.persona_id = per.id
             WHERE p.id = $1 AND p.business_id = $2
             FOR UPDATE OF p`,
            [id, businessId]
        );

        if (checkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: "Pedido no encontrado" });
        }

        const pedido = checkRes.rows[0];
        const estadoActual = pedido.estado;

        // CASO A: ANULADO → devolver stock
        if (nuevo_estado === 'ANULADO' && estadoActual !== 'ANULADO') {
            const itemsRes = await client.query(
                `SELECT dp.inventario_id, dp.cantidad, i.tipo_programa
                 FROM "public"."detalle_pedidos" dp
                 JOIN "public"."inventario" i ON dp.inventario_id = i.id
                 WHERE dp.pedido_id = $1`,
                [id]
            );
            for (const item of itemsRes.rows) {
                if (!['Validacion', 'Tecnico'].includes(item.tipo_programa)) {
                    await client.query(
                        `UPDATE "public"."inventario" SET cantidad = cantidad + $1 WHERE id = $2`,
                        [item.cantidad, item.inventario_id]
                    );
                }
            }
        }
        // CASO B: REACTIVADO desde ANULADO → descontar stock
        else if (estadoActual === 'ANULADO' && nuevo_estado !== 'ANULADO') {
            const itemsRes = await client.query(
                `SELECT dp.inventario_id, dp.cantidad, i.cantidad as stock_actual, i.tipo_programa
                 FROM "public"."detalle_pedidos" dp
                 JOIN "public"."inventario" i ON dp.inventario_id = i.id
                 WHERE dp.pedido_id = $1`,
                [id]
            );
            for (const item of itemsRes.rows) {
                if (!['Validacion', 'Tecnico'].includes(item.tipo_programa)) {
                    if (item.stock_actual < item.cantidad) {
                        throw new Error(`No se puede reactivar: Stock insuficiente para producto ID ${item.inventario_id}`);
                    }
                    await client.query(
                        `UPDATE "public"."inventario" SET cantidad = cantidad - $1 WHERE id = $2`,
                        [item.cantidad, item.inventario_id]
                    );
                }
            }
        }

        // Crear ingreso al entregar
        if (nuevo_estado === 'ENTREGADO' && estadoActual !== 'ENTREGADO') {
            const cuentaFinal = cuenta_destino || 'Caja General';
            const _idIngreso = uuidv4();
            const createdAt = new Date();
            const fechaVencimiento = new Date(createdAt);
            fechaVencimiento.setFullYear(fechaVencimiento.getFullYear() + 1);

            await client.query(
                `INSERT INTO "public"."ingresos" (
                    "_id", "nombre", "apellido", "numeroDeDocumento", "fechaVencimiento",
                    "producto", "valor", "cuenta", "customer_email", "payment_status",
                    "payment_reference", "usuario", "business_id", "createdAt", "updatedAt", "__v", "comprobante_url"
                 )
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
                [
                    _idIngreso,
                    pedido.nombre  || 'Cliente Ocasional',
                    pedido.apellido || '',
                    pedido.numero_documento || '0',
                    fechaVencimiento.toISOString(),
                    `Venta POS - Pedido #${id}`,
                    String(pedido.total),
                    cuentaFinal,
                    pedido.email || '',
                    'APPROVED',
                    `PEDIDO-${id}-${Date.now()}`,
                    usuarioId,
                    businessId,
                    createdAt.toISOString(),
                    createdAt.toISOString(),
                    '0',
                    ''
                ]
            );
        }

        const result = await client.query(
            `UPDATE "public"."pedidos" SET estado = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [nuevo_estado, id]
        );

        await client.query('COMMIT');
        return res.status(200).json({
            success: true,
            message: `Pedido actualizado a ${nuevo_estado}`,
            data: result.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error actualizando estado:", error);
        return res.status(500).json({ message: error.message || "Error al actualizar estado" });
    } finally {
        client.release();
    }
};

// ==========================================
// 5. ELIMINAR PEDIDO (DELETE)
// ==========================================
export const deletePedido = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;

        await client.query('BEGIN');

        const checkRes = await client.query(
            `SELECT estado FROM "public"."pedidos" WHERE id = $1 AND business_id = $2`,
            [id, businessId]
        );

        if (checkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: "Pedido no encontrado" });
        }

        if (checkRes.rows[0].estado !== 'ANULADO') {
            const itemsRes = await client.query(
                `SELECT dp.inventario_id, dp.cantidad, i.tipo_programa
                 FROM "public"."detalle_pedidos" dp
                 JOIN "public"."inventario" i ON dp.inventario_id = i.id
                 WHERE dp.pedido_id = $1`,
                [id]
            );
            for (const item of itemsRes.rows) {
                if (!['Validacion', 'Tecnico'].includes(item.tipo_programa)) {
                    await client.query(
                        `UPDATE "public"."inventario" SET cantidad = cantidad + $1 WHERE id = $2`,
                        [item.cantidad, item.inventario_id]
                    );
                }
            }
        }

        await client.query(`DELETE FROM "public"."pedidos" WHERE id = $1`, [id]);
        await client.query('COMMIT');

        return res.status(200).json({ message: "Pedido eliminado y stock restaurado correctamente" });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error eliminando pedido:", error);
        return res.status(500).json({ message: "Error interno al eliminar pedido" });
    } finally {
        client.release();
    }
};

// ==========================================
// 6. ACTUALIZAR PEDIDO (UPDATE)
// ==========================================
export const updatePedido = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { persona_id, items, observaciones } = req.body;
        const businessId = req.user?.bid;

        await client.query('BEGIN');

        const checkRes = await client.query(
            `SELECT estado FROM pedidos WHERE id = $1 AND business_id = $2 FOR UPDATE`,
            [id, businessId]
        );

        if (checkRes.rows.length === 0) throw new Error("Pedido no encontrado");
        if (checkRes.rows[0].estado !== 'PENDIENTE') throw new Error("Solo se pueden editar pedidos PENDIENTES");

        // Restaurar stock anterior
        const oldItemsRes = await client.query(
            `SELECT dp.inventario_id, dp.cantidad, i.tipo_programa
             FROM detalle_pedidos dp
             JOIN inventario i ON dp.inventario_id = i.id
             WHERE dp.pedido_id = $1`,
            [id]
        );
        for (const oldItem of oldItemsRes.rows) {
            if (!['Validacion', 'Tecnico'].includes(oldItem.tipo_programa)) {
                await client.query(
                    `UPDATE inventario SET cantidad = cantidad + $1 WHERE id = $2`,
                    [oldItem.cantidad, oldItem.inventario_id]
                );
            }
        }

        await client.query(`DELETE FROM detalle_pedidos WHERE pedido_id = $1`, [id]);

        let nuevoTotal = 0;
        for (const newItem of items) {
            const prodRes = await client.query(
                `SELECT id, monto, cantidad, tipo_programa FROM inventario WHERE id = $1 AND business_id = $2`,
                [newItem.inventario_id, businessId]
            );
            const producto = prodRes.rows[0];
            const esServicio = ['Validacion', 'Tecnico'].includes(producto.tipo_programa);

            if (!esServicio && producto.cantidad < newItem.cantidad) {
                throw new Error(`Stock insuficiente para producto ID ${producto.id}`);
            }

            const subtotal = Number(producto.monto) * newItem.cantidad;
            nuevoTotal += subtotal;

            await client.query(
                `INSERT INTO detalle_pedidos (pedido_id, inventario_id, cantidad, precio_unitario)
                 VALUES ($1, $2, $3, $4)`,
                [id, producto.id, newItem.cantidad, producto.monto]
            );

            if (!esServicio) {
                await client.query(
                    `UPDATE inventario SET cantidad = cantidad - $1, updated_at = NOW() WHERE id = $2`,
                    [newItem.cantidad, producto.id]
                );
            }
        }

        await client.query(
            `UPDATE pedidos SET persona_id = $1, total = $2, observaciones = $3, updated_at = NOW() WHERE id = $4`,
            [persona_id, nuevoTotal, observaciones, id]
        );

        await client.query('COMMIT');
        res.json({ success: true, message: "Pedido actualizado correctamente" });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error(error);
        res.status(500).json({ message: error.message });
    } finally {
        client.release();
    }
};

// ==========================================
// 7. ESTADÍSTICAS DE PEDIDOS
// ==========================================
export const getOrderStats = async (req, res) => {
    try {
        const businessId = req.user?.bid;

        const [kpiRes, estadoRes, productosRes, unidadesRes] = await Promise.all([
            pool.query(
                `SELECT COUNT(*) as total_pedidos, COALESCE(SUM(total), 0) as total_ingresos
                 FROM pedidos WHERE business_id = $1 AND cierre_id IS NULL`,
                [businessId]
            ),
            pool.query(
                `SELECT estado, COUNT(*) as cantidad FROM pedidos
                 WHERE business_id = $1 AND cierre_id IS NULL GROUP BY estado`,
                [businessId]
            ),
            pool.query(
                `SELECT i.nombre, SUM(dp.cantidad) as total_vendido
                 FROM detalle_pedidos dp
                 JOIN pedidos p ON dp.pedido_id = p.id
                 JOIN inventario i ON dp.inventario_id = i.id
                 WHERE p.business_id = $1 AND p.estado != 'ANULADO' AND p.cierre_id IS NULL
                 GROUP BY i.nombre ORDER BY total_vendido DESC LIMIT 5`,
                [businessId]
            ),
            pool.query(
                `SELECT COALESCE(SUM(dp.cantidad), 0) as total_unidades
                 FROM detalle_pedidos dp
                 JOIN pedidos p ON dp.pedido_id = p.id
                 WHERE p.business_id = $1 AND p.estado != 'ANULADO' AND p.cierre_id IS NULL`,
                [businessId]
            )
        ]);

        res.json({
            general: {
                total_pedidos: parseInt(kpiRes.rows[0]?.total_pedidos || 0),
                total_ingresos: Number(kpiRes.rows[0]?.total_ingresos || 0),
                total_unidades: parseInt(unidadesRes.rows[0]?.total_unidades || 0)
            },
            por_estado: estadoRes.rows.map(r => ({ name: r.estado, value: parseInt(r.cantidad) })),
            top_productos: productosRes.rows.map(r => ({ name: r.nombre, cantidad: parseInt(r.total_vendido) }))
        });

    } catch (error) {
        console.error("Error en estadísticas:", error);
        res.status(500).json({ message: "Error calculando estadísticas" });
    }
};

// ==========================================
// 8. REALIZAR CIERRE DE CAJA
// ==========================================
export const realizarCierre = async (req, res) => {
    const client = await pool.connect();
    try {
        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;
        const { observaciones } = req.body;

        await client.query('BEGIN');

        const statsRes = await client.query(
            `SELECT COUNT(*) as total_pedidos, COALESCE(SUM(total), 0) as total_ingresos
             FROM "public"."pedidos"
             WHERE business_id = $1 AND cierre_id IS NULL`,
            [businessId]
        );
        const { total_pedidos, total_ingresos } = statsRes.rows[0];

        if (parseInt(total_pedidos) === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: "No hay pedidos pendientes por cerrar." });
        }

        const cierreRes = await client.query(
            `INSERT INTO "public"."cierres"
             ("user_id", "business_id", "total_ingresos", "total_pedidos", "observaciones", "fecha_cierre")
             VALUES ($1, $2, $3, $4, $5, NOW())
             RETURNING id`,
            [usuarioId, businessId, total_ingresos, total_pedidos, observaciones || 'Cierre manual de ventas']
        );
        const nuevoCierreId = cierreRes.rows[0].id;

        await client.query(
            `UPDATE "public"."pedidos" SET cierre_id = $1 WHERE business_id = $2 AND cierre_id IS NULL`,
            [nuevoCierreId, businessId]
        );

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: "Cierre realizado con éxito. El dashboard se ha reiniciado.",
            data: { cierre_id: nuevoCierreId, total_cerrado: total_ingresos, pedidos_archivados: total_pedidos }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error en cierre:", error);
        return res.status(500).json({ message: "Error al realizar el cierre" });
    } finally {
        client.release();
    }
};

// ==========================================
// 9. HISTORIAL DE CIERRES
// ==========================================
export const getCierres = async (req, res) => {
    try {
        const businessId = req.user?.bid;

        const result = await pool.query(
            `SELECT * FROM "public"."cierres"
             WHERE business_id = $1
             ORDER BY fecha_cierre DESC LIMIT 20`,
            [businessId]
        );

        return res.status(200).json({ data: result.rows });
    } catch (error) {
        console.error("Error obteniendo cierres:", error);
        return res.status(500).json({ message: "Error al obtener historial" });
    }
};
