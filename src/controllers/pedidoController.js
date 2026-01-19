import pool from "../database.js";
import { v4 as uuidv4 } from 'uuid'; // Importamos la librería UUID


// ==========================================
// 1. CREAR PEDIDO (CREATE)
// ==========================================
export const createPedido = async (req, res) => {
    const client = await pool.connect();

    try {
        const { persona_id, items, observaciones } = req.body;
        // items espera ser un array: [{ inventario_id: 1, cantidad: 2 }, ...]

        const usuarioId = req.user?.id; // ID del usuario (tenant)

        // Validaciones básicas
        if (!usuarioId) return res.status(401).json({ message: "Usuario no autenticado" });
        if (!persona_id) return res.status(400).json({ message: "Se requiere un cliente (persona_id)" });
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: "El pedido debe contener al menos un producto" });
        }

        await client.query('BEGIN');

        // 1. Calcular total y validar Stock
        let totalPedido = 0;
        const itemsProcesados = [];

        for (const item of items) {
            // Buscamos el producto y BLOQUEAMOS la fila (FOR UPDATE) para evitar condiciones de carrera
            const prodQuery = `
                SELECT id, nombre, monto, cantidad, tipo_programa 
                FROM "public"."inventario" 
                WHERE id = $1 AND user_id = $2
                FOR UPDATE
            `;
            const prodRes = await client.query(prodQuery, [item.inventario_id, usuarioId]);

            if (prodRes.rows.length === 0) {
                throw new Error(`Producto ID ${item.inventario_id} no encontrado o no autorizado.`);
            }

            const producto = prodRes.rows[0];

            // Validar stock (si no es un servicio)
            const esServicio = ['Validacion', 'Tecnico'].includes(producto.tipo_programa);
            if (!esServicio && producto.cantidad < item.cantidad) {
                throw new Error(`Stock insuficiente para '${producto.nombre}'. Disponible: ${producto.cantidad}`);
            }

            const precioUnitario = Number(producto.monto);
            const subtotal = precioUnitario * item.cantidad;
            totalPedido += subtotal;

            itemsProcesados.push({
                inventario_id: producto.id,
                cantidad: item.cantidad,
                precio_unitario: precioUnitario,
                es_servicio: esServicio
            });
        }

        // 2. Insertar Encabezado del Pedido
        const pedidoQuery = `
            INSERT INTO "public"."pedidos" 
            ("persona_id", "user_id", "total", "estado", "observaciones", "created_at", "updated_at")
            VALUES ($1, $2, $3, 'PENDIENTE', $4, NOW(), NOW())
            RETURNING id
        `;
        const pedidoRes = await client.query(pedidoQuery, [persona_id, usuarioId, totalPedido, observaciones]);
        const pedidoId = pedidoRes.rows[0].id;

        // 3. Insertar Detalles y Actualizar Inventario
        const detalleQuery = `
            INSERT INTO "public"."detalle_pedidos" 
            ("pedido_id", "inventario_id", "cantidad", "precio_unitario")
            VALUES ($1, $2, $3, $4)
        `;

        const updateStockQuery = `
            UPDATE "public"."inventario"
            SET cantidad = cantidad - $1, updated_at = NOW()
            WHERE id = $2
        `;

        for (const item of itemsProcesados) {
            // Guardar detalle
            await client.query(detalleQuery, [pedidoId, item.inventario_id, item.cantidad, item.precio_unitario]);

            // Descontar inventario
            if (!item.es_servicio) {
                await client.query(updateStockQuery, [item.cantidad, item.inventario_id]);
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
// controllers/orderController.js

export const getPedidos = async (req, res) => {
    try {
        const usuarioId = req.user?.id;
        const { estado } = req.query;

        // Construcción de filtros dinámicos
        let whereClause = `WHERE p.user_id = $1`;
        const values = [usuarioId];

        if (estado) {
            whereClause += ` AND p.estado = $2`;
            values.push(estado);
        }

        // QUERY OPTIMIZADA: Trae la cabecera Y los ítems en un array JSON
        const query = `
            SELECT 
                p.id, 
                p.total, 
                p.estado, 
                p.created_at, 
                p.observaciones,
                pe.nombre as cliente_nombre, 
                pe.apellido as cliente_apellido,
                pe.direccion as cliente_direccion,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'producto', i.nombre,
                            'cantidad', dp.cantidad,
                            'precio', dp.precio_unitario
                        ) 
                    ) FILTER (WHERE i.id IS NOT NULL), 
                    '[]'
                ) as items_detalle
            FROM "public"."pedidos" p
            JOIN "public"."personas" pe ON p.persona_id = pe.id
            LEFT JOIN "public"."detalle_pedidos" dp ON p.id = dp.pedido_id
            LEFT JOIN "public"."inventario" i ON dp.inventario_id = i.id
            ${whereClause}
            GROUP BY p.id, pe.id
            ORDER BY p.created_at DESC
            LIMIT 50
        `;

        const result = await pool.query(query, values);

        return res.status(200).json({
            data: result.rows
        });

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
        const usuarioId = req.user?.id;

        // 1. Obtener cabecera
        const cabeceraQuery = `
            SELECT p.*, pe.nombre as cliente_nombre, pe.apellido as cliente_apellido, pe.numero_documento, pe.tipo_documento
            FROM "public"."pedidos" p
            JOIN "public"."personas" pe ON p.persona_id = pe.id
            WHERE p.id = $1 AND p.user_id = $2
        `;
        const cabeceraRes = await pool.query(cabeceraQuery, [id, usuarioId]);

        if (cabeceraRes.rows.length === 0) {
            return res.status(404).json({ message: "Pedido no encontrado" });
        }

        // 2. Obtener items
        const itemsQuery = `
            SELECT dp.*, i.nombre as producto_nombre, i.codigo_barras
            FROM "public"."detalle_pedidos" dp
            JOIN "public"."inventario" i ON dp.inventario_id = i.id
            WHERE dp.pedido_id = $1
        `;
        const itemsRes = await pool.query(itemsQuery, [id]);

        return res.status(200).json({
            pedido: cabeceraRes.rows[0],
            items: itemsRes.rows
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
    const client = await pool.connect();
    try {
        const { id } = req.params;
        // Ahora recibimos el objeto o el string, desestructuramos con seguridad
        const nuevo_estado = req.body.nuevo_estado || req.body.estado;
        const cuenta_destino = req.body.cuenta_destino;

        const usuarioId = req.user?.id;

        if (!['PENDIENTE', 'ENTREGADO', 'ANULADO'].includes(nuevo_estado)) {
            return res.status(400).json({ message: "Estado no válido" });
        }

        await client.query('BEGIN');

        // 1. CORRECCIÓN AQUÍ: Usamos "FOR UPDATE OF p"
        // Esto le dice a la DB: "Bloquea la fila del pedido, pero solo lee la persona sin bloquearla"
        const checkQuery = `
            SELECT p.estado, p.total, p.persona_id, per.nombre, per.apellido, per.numero_documento, per.email
            FROM "public"."pedidos" p
            LEFT JOIN "public"."personas" per ON p.persona_id = per.id
            WHERE p.id = $1 AND p.user_id = $2 
            FOR UPDATE OF p
        `;

        const checkRes = await client.query(checkQuery, [id, usuarioId]);

        if (checkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: "Pedido no encontrado" });
        }

        const pedido = checkRes.rows[0];
        const estadoActual = pedido.estado;

        // ... EL RESTO DE TU LÓGICA DE INVENTARIO SIGUE IGUAL ...
        // (Copiar y pegar la lógica de stock CASO A y CASO B que ya tenías)

        // --- CASO A: ANULADO ---
        if (nuevo_estado === 'ANULADO' && estadoActual !== 'ANULADO') {
            const itemsQuery = `
                SELECT dp.inventario_id, dp.cantidad, i.tipo_programa 
                FROM "public"."detalle_pedidos" dp
                JOIN "public"."inventario" i ON dp.inventario_id = i.id
                WHERE dp.pedido_id = $1
            `;
            const itemsRes = await client.query(itemsQuery, [id]);

            for (const item of itemsRes.rows) {
                const esServicio = ['Validacion', 'Tecnico'].includes(item.tipo_programa);
                if (!esServicio) {
                    await client.query(`
                        UPDATE "public"."inventario" 
                        SET cantidad = cantidad + $1 
                        WHERE id = $2
                    `, [item.cantidad, item.inventario_id]);
                }
            }
        }
        // --- CASO B: REACTIVADO ---
        else if (estadoActual === 'ANULADO' && nuevo_estado !== 'ANULADO') {
            const itemsQuery = `
                SELECT dp.inventario_id, dp.cantidad, i.cantidad as stock_actual, i.tipo_programa 
                FROM "public"."detalle_pedidos" dp
                JOIN "public"."inventario" i ON dp.inventario_id = i.id
                WHERE dp.pedido_id = $1
            `;
            const itemsRes = await client.query(itemsQuery, [id]);

            for (const item of itemsRes.rows) {
                const esServicio = ['Validacion', 'Tecnico'].includes(item.tipo_programa);
                if (!esServicio) {
                    if (item.stock_actual < item.cantidad) {
                        throw new Error(`No se puede reactivar: Stock insuficiente para producto ID ${item.inventario_id}`);
                    }
                    await client.query(`
                        UPDATE "public"."inventario" 
                        SET cantidad = cantidad - $1 
                        WHERE id = $2
                    `, [item.cantidad, item.inventario_id]);
                }
            }
        }

        // ---------------------------------------------------------
        // CREACIÓN DE INGRESO (Cuando pasa a ENTREGADO)
        // ---------------------------------------------------------
        if (nuevo_estado === 'ENTREGADO' && estadoActual !== 'ENTREGADO') {

            const cuentaFinal = cuenta_destino || 'Caja General';
            const _idIngreso = uuidv4(); // Asegúrate de tener importado uuidv4
            const createdAt = new Date();
            const fechaVencimiento = new Date(createdAt);
            fechaVencimiento.setFullYear(fechaVencimiento.getFullYear() + 1);

            const payment_reference = `PEDIDO-${id}-${Date.now()}`;

            const insertIngresoQuery = `
                INSERT INTO "public"."ingresos" (
                    "_id", "nombre", "apellido", "numeroDeDocumento", "fechaVencimiento",
                    "producto", "valor", "cuenta", "customer_email", "payment_status",
                    "payment_reference", "usuario", "createdAt", "updatedAt", "__v", "comprobante_url"
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            `;

            const valoresIngreso = [
                _idIngreso,
                pedido.nombre || 'Cliente Ocasional',
                pedido.apellido || '',
                pedido.numero_documento || '0',
                fechaVencimiento.toISOString(),
                `Venta POS - Pedido #${id}`,
                String(pedido.total),
                cuentaFinal,
                pedido.email || '',
                'APPROVED',
                payment_reference,
                usuarioId,
                createdAt.toISOString(),
                createdAt.toISOString(),
                '0',
                ''
            ];

            await client.query(insertIngresoQuery, valoresIngreso);
        }

        // 2. Actualizar estado
        const updateQuery = `
            UPDATE "public"."pedidos" 
            SET estado = $1, updated_at = NOW() 
            WHERE id = $2 
            RETURNING *
        `;
        const result = await client.query(updateQuery, [nuevo_estado, id]);

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
        const usuarioId = req.user?.id;

        await client.query('BEGIN');

        // Verificar existencia y estado
        const checkQuery = `SELECT estado FROM "public"."pedidos" WHERE id = $1 AND user_id = $2`;
        const checkRes = await client.query(checkQuery, [id, usuarioId]);

        if (checkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: "Pedido no encontrado" });
        }

        // REGLA DE NEGOCIO:
        // Si el pedido NO está anulado, eliminarlo físicamente sin devolver stock deja huecos contables.
        // Lo ideal es forzar que primero se anule, o devolver stock aquí mismo.
        // Vamos a asumir que borrar implica "hacer como que nunca existió" -> Devolvemos stock si no estaba anulado.

        if (checkRes.rows[0].estado !== 'ANULADO') {
            const itemsQuery = `
                SELECT dp.inventario_id, dp.cantidad, i.tipo_programa 
                FROM "public"."detalle_pedidos" dp
                JOIN "public"."inventario" i ON dp.inventario_id = i.id
                WHERE dp.pedido_id = $1
            `;
            const itemsRes = await client.query(itemsQuery, [id]);

            for (const item of itemsRes.rows) {
                const esServicio = ['Validacion', 'Tecnico'].includes(item.tipo_programa);
                if (!esServicio) {
                    await client.query(`
                        UPDATE "public"."inventario" 
                        SET cantidad = cantidad + $1 
                        WHERE id = $2
                    `, [item.cantidad, item.inventario_id]);
                }
            }
        }

        // Borrar (Cascade se encargará del detalle_pedidos si configuraste la FK con ON DELETE CASCADE, 
        // pero por seguridad lo hacemos manual o confiamos en la FK)
        // Asumiendo que definiste ON DELETE CASCADE en la tabla SQL como te indiqué:
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


// controllers/orderController.js

export const updatePedido = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { persona_id, items, observaciones } = req.body; // items = nuevo carrito
        const usuarioId = req.user.id;

        await client.query('BEGIN');

        // 1. Validar que el pedido exista y esté PENDIENTE
        const checkQuery = `SELECT estado FROM pedidos WHERE id = $1 AND user_id = $2 FOR UPDATE`;
        const checkRes = await client.query(checkQuery, [id, usuarioId]);

        if (checkRes.rows.length === 0) throw new Error("Pedido no encontrado");
        if (checkRes.rows[0].estado !== 'PENDIENTE') throw new Error("Solo se pueden editar pedidos PENDIENTES");

        // 2. RESTAURAR STOCK (Devolver lo que se había llevado antes)
        // Obtenemos los items que TIENE ACTUALMENTE el pedido en BD
        const oldItemsQuery = `
            SELECT dp.inventario_id, dp.cantidad, i.tipo_programa 
            FROM detalle_pedidos dp
            JOIN inventario i ON dp.inventario_id = i.id
            WHERE dp.pedido_id = $1
        `;
        const oldItemsRes = await client.query(oldItemsQuery, [id]);

        for (const oldItem of oldItemsRes.rows) {
            const esServicio = ['Validacion', 'Tecnico'].includes(oldItem.tipo_programa);
            if (!esServicio) {
                await client.query(`
                    UPDATE inventario SET cantidad = cantidad + $1 WHERE id = $2
                `, [oldItem.cantidad, oldItem.inventario_id]);
            }
        }

        // 3. BORRAR DETALLES VIEJOS
        await client.query(`DELETE FROM detalle_pedidos WHERE pedido_id = $1`, [id]);

        // 4. PROCESAR EL NUEVO CARRITO (Insertar y Descontar Stock nuevamente)
        let nuevoTotal = 0;

        for (const newItem of items) {
            // Buscar precio actual y stock
            const prodQuery = `SELECT id, monto, cantidad, tipo_programa FROM inventario WHERE id = $1`;
            const prodRes = await client.query(prodQuery, [newItem.inventario_id]);
            const producto = prodRes.rows[0];

            // Validar Stock (Ahora tenemos el stock "restaurado", así que la validación es real)
            const esServicio = ['Validacion', 'Tecnico'].includes(producto.tipo_programa);

            if (!esServicio && producto.cantidad < newItem.cantidad) {
                throw new Error(`Stock insuficiente para producto ID ${producto.id} al intentar actualizar.`);
            }

            const subtotal = Number(producto.monto) * newItem.cantidad;
            nuevoTotal += subtotal;

            // Insertar nuevo detalle
            await client.query(`
                INSERT INTO detalle_pedidos (pedido_id, inventario_id, cantidad, precio_unitario)
                VALUES ($1, $2, $3, $4)
            `, [id, producto.id, newItem.cantidad, producto.monto]);

            // Descontar nuevo stock
            if (!esServicio) {
                await client.query(`
                    UPDATE inventario SET cantidad = cantidad - $1, updated_at = NOW() WHERE id = $2
                `, [newItem.cantidad, producto.id]);
            }
        }

        // 5. ACTUALIZAR CABECERA (Total, Cliente, Obs)
        await client.query(`
            UPDATE pedidos 
            SET persona_id = $1, total = $2, observaciones = $3, updated_at = NOW()
            WHERE id = $4
        `, [persona_id, nuevoTotal, observaciones, id]);

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


export const getOrderStats = async (req, res) => {
    try {
        const usuarioId = req.user.id;

        // Ejecutamos 4 consultas en PARALELO para máxima velocidad
        const [kpiRes, estadoRes, productosRes, unidadesRes] = await Promise.all([

            // 1. KPIs Generales (Total Pedidos y Dinero)
            pool.query(`
                SELECT 
                    COUNT(*) as total_pedidos,
                    COALESCE(SUM(total), 0) as total_ingresos
                FROM pedidos 
                WHERE user_id = $1
            `, [usuarioId]),

            // 2. Desglose por Estado
            pool.query(`
                SELECT estado, COUNT(*) as cantidad 
                FROM pedidos 
                WHERE user_id = $1 
                GROUP BY estado
            `, [usuarioId]),

            // 3. Top 5 Productos más vendidos
            pool.query(`
                SELECT 
                    i.nombre, 
                    SUM(dp.cantidad) as total_vendido 
                FROM detalle_pedidos dp
                JOIN pedidos p ON dp.pedido_id = p.id
                JOIN inventario i ON dp.inventario_id = i.id
                WHERE p.user_id = $1 AND p.estado != 'ANULADO'
                GROUP BY i.nombre
                ORDER BY total_vendido DESC
                LIMIT 5
            `, [usuarioId]),

            // 4. Total Unidades (Suma de todos los items de pedidos no anulados)
            pool.query(`
                SELECT COALESCE(SUM(dp.cantidad), 0) as total_unidades
                FROM detalle_pedidos dp
                JOIN pedidos p ON dp.pedido_id = p.id
                WHERE p.user_id = $1 AND p.estado != 'ANULADO'
            `, [usuarioId])
        ]);

        // Formatear respuesta
        const stats = {
            general: {
                total_pedidos: parseInt(kpiRes.rows[0].total_pedidos),
                total_ingresos: Number(kpiRes.rows[0].total_ingresos),
                total_unidades: parseInt(unidadesRes.rows[0].total_unidades)
            },
            por_estado: estadoRes.rows.map(row => ({
                name: row.estado,
                value: parseInt(row.cantidad)
            })),
            top_productos: productosRes.rows.map(row => ({
                name: row.nombre,
                cantidad: parseInt(row.total_vendido)
            }))
        };

        res.json(stats);

    } catch (error) {
        console.error("Error en estadísticas:", error);
        res.status(500).json({ message: "Error calculando estadísticas" });
    }
};