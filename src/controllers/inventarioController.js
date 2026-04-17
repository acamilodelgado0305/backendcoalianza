import pool from '../database.js';
import { uploadProductImageToGCS, deleteProductImageFromGCS } from '../services/gcsProductImages.js';

// ==========================================
// 1. CREAR ÍTEM (CREATE)
// ==========================================
export const createInventarioItem = async (req, res) => {
    try {
        const {
            nombre,
            monto,
            descripcion,
            costo_compra,
            precio_compra_unitario,
            unidades_por_caja,
            stock_inicial_empaques,
            codigo_barras,
            tipo_programa,
            tipo_item,
            sku,
            stock_minimo,
            categoria,
        } = req.body;

        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;
        const archivoImagen = req.file;

        if (!usuarioId)  return res.status(401).json({ message: "Usuario no autenticado" });
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });
        if (!nombre || !monto) {
            return res.status(400).json({ message: 'Nombre y precio de venta son obligatorios.' });
        }

        // Procesar imagen
        let finalImageUrl = req.body.imagen_url || null;
        if (archivoImagen) {
            try {
                const uploadResult = await uploadProductImageToGCS(archivoImagen.buffer, {
                    filename: archivoImagen.originalname,
                    mimetype: archivoImagen.mimetype,
                    userId: usuarioId,
                    productId: 'new'
                });
                finalImageUrl = uploadResult.publicUrl;
            } catch (uploadError) {
                console.error("Error subiendo imagen a GCS:", uploadError);
                return res.status(500).json({ message: "Error al subir la imagen del producto" });
            }
        }

        // Lógica stock: servicios no tienen stock
        const esServicio = tipo_item === 'servicio';
        let cantidadTotalUnidades = null;
        let factorConversion = null;

        if (!esServicio) {
            factorConversion = parseInt(unidades_por_caja) > 0 ? parseInt(unidades_por_caja) : 1;
            const stockIngresado = parseFloat(stock_inicial_empaques) || 0;
            cantidadTotalUnidades = stockIngresado * factorConversion;
        }

        const precioCompraUnitario = parseFloat(precio_compra_unitario)
            || parseFloat(costo_compra)
            || 0;

        const query = `
            INSERT INTO inventario (
                nombre, monto, descripcion, user_id, business_id, imagen_url,
                costo_compra, precio_compra_unitario,
                unidades_por_caja, cantidad,
                codigo_barras, tipo_programa,
                tipo_item, sku, stock_minimo, categoria, impuesto,
                created_at, updated_at
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, NOW(), NOW())
            RETURNING *;
        `;

        const values = [
            nombre,
            parseFloat(monto),
            descripcion || null,
            usuarioId,
            businessId,
            finalImageUrl,
            precioCompraUnitario,
            precioCompraUnitario,
            esServicio ? null : factorConversion,
            esServicio ? null : cantidadTotalUnidades,
            codigo_barras || null,
            tipo_programa || null,
            tipo_item || 'producto',
            sku || null,
            parseInt(stock_minimo) || 0,
            categoria || null,
            parseFloat(req.body.impuesto) || 0,
        ];

        const result = await pool.query(query, values);

        return res.status(201).json({
            message: 'Ítem creado exitosamente',
            data: result.rows[0],
        });

    } catch (error) {
        console.error('Error al crear item:', error);
        if (error.code === '23505') {
            return res.status(409).json({ message: 'El SKU o código de barras ya existe.' });
        }
        return res.status(500).json({ message: 'Error del servidor', error: error.message });
    }
};

// ==========================================
// 2. OBTENER TODOS LOS ÍTEMS (READ)
// ==========================================
export const getInventario = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

        const { tipo, categoria, q } = req.query;
        let conditions = [`business_id = $1`];
        let params = [businessId];
        let idx = 2;

        if (tipo) {
            conditions.push(`tipo_item = $${idx++}`);
            params.push(tipo);
        }
        if (categoria) {
            conditions.push(`categoria = $${idx++}`);
            params.push(categoria);
        }
        if (q) {
            conditions.push(`(nombre ILIKE $${idx} OR sku ILIKE $${idx} OR codigo_barras ILIKE $${idx})`);
            params.push(`%${q}%`);
            idx++;
        }

        const query = `
            SELECT * FROM inventario
            WHERE ${conditions.join(' AND ')}
            ORDER BY created_at DESC
        `;

        const result = await pool.query(query, params);

        // stock_bajo se calcula en JS para que funcione antes y después de la migración
        const rows = result.rows.map(r => ({
            ...r,
            stock_bajo: r.tipo_item === 'servicio'
                ? false
                : (r.stock_minimo > 0 && (r.cantidad ?? 0) <= r.stock_minimo),
        }));

        return res.status(200).json(rows);
    } catch (error) {
        console.error("Error obteniendo inventario:", error);
        return res.status(500).json({ message: "Error al obtener inventario" });
    }
};

// ==========================================
// 3. ACTUALIZAR ÍTEM (UPDATE)
// ==========================================
export const updateInventarioItem = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            nombre, monto, descripcion,
            costo_compra, precio_compra_unitario,
            unidades_por_caja, stock_inicial_empaques,
            codigo_barras, tipo_programa,
            tipo_item, sku, stock_minimo, categoria,
        } = req.body;

        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;
        const archivoImagen = req.file;

        const checkResult = await pool.query(
            `SELECT * FROM inventario WHERE id = $1 AND business_id = $2`,
            [id, businessId]
        );
        if (checkResult.rows.length === 0) {
            return res.status(404).json({ message: "Ítem no encontrado o no autorizado" });
        }

        const productoActual = checkResult.rows[0];
        let finalImageUrl = req.body.imagen_url || productoActual.imagen_url;

        // Procesar imagen
        if (archivoImagen) {
            try {
                if (productoActual.imagen_url) {
                    await deleteProductImageFromGCS(productoActual.imagen_url).catch(err =>
                        console.warn("No se pudo borrar imagen antigua:", err.message)
                    );
                }
                const uploadResult = await uploadProductImageToGCS(archivoImagen.buffer, {
                    filename: archivoImagen.originalname,
                    mimetype: archivoImagen.mimetype,
                    userId: usuarioId,
                    productId: id
                });
                finalImageUrl = uploadResult.publicUrl;
            } catch (uploadError) {
                console.error("Error gestionando imagen en update:", uploadError);
                return res.status(500).json({ message: "Error al actualizar la imagen" });
            }
        }

        const tipoFinal = tipo_item || productoActual.tipo_item || 'producto';
        const esServicio = tipoFinal === 'servicio';

        // Recalcular stock solo si es producto y vienen datos de stock
        let nuevaCantidad = productoActual.cantidad;
        if (!esServicio && stock_inicial_empaques !== undefined) {
            const factor = parseInt(unidades_por_caja) || productoActual.unidades_por_caja || 1;
            nuevaCantidad = (parseFloat(stock_inicial_empaques) || 0) * factor;
        }

        const precioCompraUnitario = parseFloat(precio_compra_unitario)
            || parseFloat(costo_compra)
            || productoActual.precio_compra_unitario
            || 0;

        // Para servicios: conserva los valores de stock existentes para no violar
        // constraints NOT NULL que pueda tener la columna en la BD.
        const updateQuery = `
            UPDATE inventario SET
                nombre = $1, monto = $2, descripcion = $3,
                imagen_url = $4,
                costo_compra = $5, precio_compra_unitario = $5,
                unidades_por_caja = $6, cantidad = $7,
                codigo_barras = $8, tipo_programa = $9,
                tipo_item = $10, sku = $11,
                stock_minimo = $12, categoria = $13,
                impuesto = $14,
                updated_at = NOW()
            WHERE id = $15
            RETURNING *;
        `;

        const impuesto = req.body.impuesto !== undefined && req.body.impuesto !== ''
            ? parseFloat(req.body.impuesto)
            : (productoActual.impuesto ?? 0);

        const values = [
            nombre,
            parseFloat(monto),
            descripcion,
            finalImageUrl,
            precioCompraUnitario,
            esServicio ? (productoActual.unidades_por_caja ?? 1) : (parseInt(unidades_por_caja) || productoActual.unidades_por_caja || 1),
            esServicio ? (productoActual.cantidad ?? 0)          : nuevaCantidad,
            codigo_barras || null,
            tipo_programa || productoActual.tipo_programa || null,
            tipoFinal,
            sku || null,
            parseInt(stock_minimo) || 0,
            categoria || null,
            isNaN(impuesto) ? 0 : impuesto,
            id,
        ];

        const result = await pool.query(updateQuery, values);

        return res.status(200).json({
            message: 'Ítem actualizado correctamente',
            data: result.rows[0],
        });

    } catch (error) {
        console.error('Error actualizando:', error);
        return res.status(500).json({ message: 'Error al actualizar el ítem', error: error.message });
    }
};

// ==========================================
// 4. ELIMINAR ÍTEM (DELETE)
// ==========================================
export const deleteInventarioItem = async (req, res) => {
    const { id } = req.params;
    const { ids } = req.body;
    const businessId = req.user?.bid;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // IDs a eliminar (siempre como array)
        const targetIds = ids && Array.isArray(ids) ? ids : id ? [id] : null;
        if (!targetIds || targetIds.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Se requiere ID para eliminar' });
        }

        // 1. Verificar existencia y recuperar imágenes
        const infoRes = await client.query(
            `SELECT id, imagen_url FROM inventario
             WHERE id = ANY($1) AND business_id = $2`,
            [targetIds, businessId]
        );

        if (infoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Ítem(s) no encontrado(s)' });
        }

        const urlsToDelete = infoRes.rows.map(r => r.imagen_url).filter(Boolean);
        const foundIds     = infoRes.rows.map(r => r.id);

        // 2. Desvincular de detalle_pedidos antes de borrar (evita FK 23503).
        //    Usamos SAVEPOINT para poder recuperar la TX si SET NULL falla por NOT NULL constraint.
        await client.query('SAVEPOINT sp_desvincular');
        try {
            await client.query(
                `UPDATE detalle_pedidos SET inventario_id = NULL WHERE inventario_id = ANY($1)`,
                [foundIds]
            );
            await client.query('RELEASE SAVEPOINT sp_desvincular');
        } catch {
            // inventario_id es NOT NULL en la BD → revertir al savepoint y borrar las filas de detalle
            await client.query('ROLLBACK TO SAVEPOINT sp_desvincular');
            await client.query(
                `DELETE FROM detalle_pedidos WHERE inventario_id = ANY($1)`,
                [foundIds]
            );
        }

        // 3. Eliminar los ítems del inventario
        const delRes = await client.query(
            `DELETE FROM inventario WHERE id = ANY($1) AND business_id = $2 RETURNING id`,
            [foundIds, businessId]
        );

        await client.query('COMMIT');

        // 4. Limpiar imágenes GCS en segundo plano
        if (urlsToDelete.length > 0) {
            Promise.all(urlsToDelete.map(url => deleteProductImageFromGCS(url)))
                .catch(err => console.error('[GCS] Error limpiando imágenes:', err));
        }

        return res.status(200).json({
            message: `${delRes.rowCount} ítem(s) eliminado(s) correctamente.`,
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error eliminando ítem de inventario:', error);
        return res.status(500).json({ message: 'Error al eliminar el ítem', detail: error.message });
    } finally {
        client.release();
    }
};

// ==========================================
// 5. STATS DE UN ÍTEM (ventas, ingresos, etc.)
// ==========================================
export const getInventarioItemStats = async (req, res) => {
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;

        const check = await pool.query(
            `SELECT id, nombre, imagen_url FROM inventario WHERE id = $1 AND business_id = $2`,
            [id, businessId]
        );
        if (check.rows.length === 0) return res.status(404).json({ message: 'Ítem no encontrado' });

        // Stats de ventas desde detalle_pedidos + pedidos
        const statsQuery = `
            SELECT
                COUNT(DISTINCT dp.pedido_id)                              AS total_pedidos,
                COALESCE(SUM(dp.cantidad), 0)                             AS unidades_vendidas,
                COALESCE(SUM(dp.cantidad * dp.precio_unitario), 0)        AS ingresos_totales
            FROM detalle_pedidos dp
            JOIN pedidos p ON p.id = dp.pedido_id
            WHERE dp.inventario_id = $1
              AND p.business_id = $2
              AND p.estado != 'ANULADO'
        `;
        const statsResult = await pool.query(statsQuery, [id, businessId]);

        // Últimas 10 ventas
        const recentQuery = `
            SELECT
                p.id            AS pedido_id,
                p.created_at,
                p.estado,
                dp.cantidad,
                dp.precio_unitario,
                dp.cantidad * dp.precio_unitario AS subtotal,
                per.nombre      AS cliente_nombre,
                per.apellido    AS cliente_apellido
            FROM detalle_pedidos dp
            JOIN pedidos p   ON p.id = dp.pedido_id
            LEFT JOIN personas per ON per.id = p.persona_id
            WHERE dp.inventario_id = $1
              AND p.business_id = $2
              AND p.estado != 'ANULADO'
            ORDER BY p.created_at DESC
            LIMIT 10
        `;
        const recentResult = await pool.query(recentQuery, [id, businessId]);

        return res.status(200).json({
            item: check.rows[0],
            stats: statsResult.rows[0],
            recent_sales: recentResult.rows,
        });
    } catch (error) {
        console.error('Error obteniendo stats:', error);
        return res.status(500).json({ message: 'Error al obtener estadísticas' });
    }
};

// ==========================================
// 6. SUBIR FOTO DE UN ÍTEM (independiente)
// ==========================================
export const uploadInventarioPhoto = async (req, res) => {
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;
        const archivoImagen = req.file;

        if (!archivoImagen) return res.status(400).json({ message: 'No se recibió ninguna imagen' });

        const check = await pool.query(
            `SELECT id, imagen_url FROM inventario WHERE id = $1 AND business_id = $2`,
            [id, businessId]
        );
        if (check.rows.length === 0) return res.status(404).json({ message: 'Ítem no encontrado' });

        const productoActual = check.rows[0];

        if (productoActual.imagen_url) {
            await deleteProductImageFromGCS(productoActual.imagen_url).catch(err =>
                console.warn('No se pudo borrar imagen antigua:', err.message)
            );
        }

        const uploadResult = await uploadProductImageToGCS(archivoImagen.buffer, {
            filename: archivoImagen.originalname,
            mimetype: archivoImagen.mimetype,
            userId: req.user?.id,
            productId: id,
        });

        await pool.query(
            `UPDATE inventario SET imagen_url = $1, updated_at = NOW() WHERE id = $2`,
            [uploadResult.publicUrl, id]
        );

        return res.status(200).json({ imagen_url: uploadResult.publicUrl });
    } catch (error) {
        console.error('Error subiendo foto:', error);
        return res.status(500).json({ message: 'Error al subir la foto' });
    }
};

// ==========================================
// 7. OBTENER POR NEGOCIO (ADMIN)
// ==========================================
export const getInventarioByUserId = async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query(
            `SELECT * FROM inventario WHERE business_id = $1 ORDER BY id DESC`,
            [userId]
        );
        return res.status(200).json(result.rows);
    } catch (error) {
        return res.status(500).json({ message: "Error al consultar negocio específico" });
    }
};
