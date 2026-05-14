import prisma from '../prisma.js';
import { Prisma } from '@prisma/client';
import { uploadProductImageToGCS, deleteProductImageFromGCS } from '../services/gcsProductImages.js';
import { v4 as uuidv4 } from 'uuid';

// ==========================================
// 1. CREAR ÍTEM (CREATE)
// ==========================================
export const createInventarioItem = async (req, res) => {
    try {
        const {
            nombre, monto, descripcion,
            costo_compra, precio_compra_unitario,
            unidades_por_caja, stock_inicial_empaques,
            codigo_barras, tipo_programa, tipo_item,
            sku, stock_minimo, categoria,
        } = req.body;

        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;
        const archivoImagen = req.file;

        if (!usuarioId)  return res.status(401).json({ message: "Usuario no autenticado" });
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });
        if (!nombre || !monto) return res.status(400).json({ message: 'Nombre y precio de venta son obligatorios.' });

        let finalImageUrl = req.body.imagen_url || null;
        if (archivoImagen) {
            try {
                const uploadResult = await uploadProductImageToGCS(archivoImagen.buffer, {
                    filename: archivoImagen.originalname,
                    mimetype: archivoImagen.mimetype,
                    userId: usuarioId,
                    productId: 'new',
                });
                finalImageUrl = uploadResult.publicUrl;
            } catch (uploadError) {
                console.error("Error subiendo imagen a GCS:", uploadError);
                return res.status(500).json({ message: "Error al subir la imagen del producto" });
            }
        }

        const esServicio = tipo_item === 'servicio';
        let cantidadTotalUnidades = null;
        let factorConversion = null;

        if (!esServicio) {
            factorConversion = parseInt(unidades_por_caja) > 0 ? parseInt(unidades_por_caja) : 1;
            const stockIngresado = parseFloat(stock_inicial_empaques) || 0;
            cantidadTotalUnidades = stockIngresado * factorConversion;
        }

        const precioCompraUnitario = parseFloat(precio_compra_unitario) || parseFloat(costo_compra) || 0;

        const item = await prisma.inventario.create({
            data: {
                nombre,
                monto:                  parseFloat(monto),
                descripcion:            descripcion || null,
                user_id:                usuarioId,
                business_id:            businessId,
                imagen_url:             finalImageUrl,
                costo_compra:           precioCompraUnitario,
                precio_compra_unitario: precioCompraUnitario,
                unidades_por_caja:      esServicio ? null : factorConversion,
                cantidad:               esServicio ? null : cantidadTotalUnidades,
                codigo_barras:          codigo_barras || null,
                tipo_programa:          tipo_programa || null,
                tipo_item:              tipo_item || 'producto',
                sku:                    sku || null,
                stock_minimo:           parseInt(stock_minimo) || 0,
                categoria:              categoria || null,
                impuesto:               parseFloat(req.body.impuesto) || 0,
            },
        });

        return res.status(201).json({ message: 'Ítem creado exitosamente', data: item });
    } catch (error) {
        console.error('Error al crear item:', error);
        if (error.code === 'P2002') {
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

        const rows = await prisma.inventario.findMany({
            where: {
                business_id: businessId,
                ...(tipo      && { tipo_item: tipo }),
                ...(categoria && { categoria }),
                ...(q && {
                    OR: [
                        { nombre:        { contains: q, mode: 'insensitive' } },
                        { sku:           { contains: q, mode: 'insensitive' } },
                        { codigo_barras: { contains: q, mode: 'insensitive' } },
                    ],
                }),
            },
            orderBy: { created_at: 'desc' },
        });

        const result = rows.map(r => ({
            ...r,
            stock_bajo: r.tipo_item === 'servicio'
                ? false
                : (r.stock_minimo > 0 && (r.cantidad ?? 0) <= r.stock_minimo),
        }));

        return res.status(200).json(result);
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
            codigo_barras, tipo_programa, tipo_item,
            sku, stock_minimo, categoria,
        } = req.body;

        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;
        const archivoImagen = req.file;

        const productoActual = await prisma.inventario.findFirst({
            where: { id: Number(id), business_id: businessId },
        });
        if (!productoActual) return res.status(404).json({ message: "Ítem no encontrado o no autorizado" });

        let finalImageUrl = req.body.imagen_url || productoActual.imagen_url;

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
                    productId: id,
                });
                finalImageUrl = uploadResult.publicUrl;
            } catch (uploadError) {
                console.error("Error gestionando imagen en update:", uploadError);
                return res.status(500).json({ message: "Error al actualizar la imagen" });
            }
        }

        const tipoFinal  = tipo_item || productoActual.tipo_item || 'producto';
        const esServicio = tipoFinal === 'servicio';

        let nuevaCantidad = productoActual.cantidad;
        if (!esServicio && stock_inicial_empaques !== undefined) {
            const factor = parseInt(unidades_por_caja) || productoActual.unidades_por_caja || 1;
            nuevaCantidad = (parseFloat(stock_inicial_empaques) || 0) * factor;
        }

        const precioCompraUnitario = parseFloat(precio_compra_unitario)
            || parseFloat(costo_compra)
            || Number(productoActual.precio_compra_unitario)
            || 0;

        const impuesto = req.body.impuesto !== undefined && req.body.impuesto !== ''
            ? parseFloat(req.body.impuesto)
            : Number(productoActual.impuesto ?? 0);

        const item = await prisma.inventario.update({
            where: { id: Number(id) },
            data: {
                nombre,
                monto:                  parseFloat(monto),
                descripcion,
                imagen_url:             finalImageUrl,
                costo_compra:           precioCompraUnitario,
                precio_compra_unitario: precioCompraUnitario,
                unidades_por_caja:      esServicio
                    ? (productoActual.unidades_por_caja ?? 1)
                    : (parseInt(unidades_por_caja) || productoActual.unidades_por_caja || 1),
                cantidad:               esServicio ? (productoActual.cantidad ?? 0) : nuevaCantidad,
                codigo_barras:          codigo_barras || null,
                tipo_programa:          tipo_programa || productoActual.tipo_programa || null,
                tipo_item:              tipoFinal,
                sku:                    sku || null,
                stock_minimo:           parseInt(stock_minimo) || 0,
                categoria:              categoria || null,
                impuesto:               isNaN(impuesto) ? 0 : impuesto,
                updated_at:             new Date(),
            },
        });

        return res.status(200).json({ message: 'Ítem actualizado correctamente', data: item });
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

    const targetIds = ids && Array.isArray(ids) ? ids.map(Number) : id ? [Number(id)] : null;
    if (!targetIds || targetIds.length === 0) {
        return res.status(400).json({ message: 'Se requiere ID para eliminar' });
    }

    try {
        const items = await prisma.inventario.findMany({
            where: { id: { in: targetIds }, business_id: businessId },
            select: { id: true, imagen_url: true },
        });

        if (items.length === 0) return res.status(404).json({ message: 'Ítem(s) no encontrado(s)' });

        const foundIds    = items.map(r => r.id);
        const urlsToDelete = items.map(r => r.imagen_url).filter(Boolean);

        await prisma.$transaction(async (tx) => {
            // Intentar SET NULL en detalle_pedidos; si falla la FK, eliminar las filas
            try {
                await tx.detalle_pedidos.updateMany({
                    where: { inventario_id: { in: foundIds } },
                    data:  { inventario_id: null },
                });
            } catch {
                await tx.detalle_pedidos.deleteMany({
                    where: { inventario_id: { in: foundIds } },
                });
            }

            await tx.inventario.deleteMany({
                where: { id: { in: foundIds }, business_id: businessId },
            });
        });

        if (urlsToDelete.length > 0) {
            Promise.all(urlsToDelete.map(url => deleteProductImageFromGCS(url)))
                .catch(err => console.error('[GCS] Error limpiando imágenes:', err));
        }

        return res.status(200).json({ message: `${foundIds.length} ítem(s) eliminado(s) correctamente.` });
    } catch (error) {
        console.error('Error eliminando ítem de inventario:', error);
        return res.status(500).json({ message: 'Error al eliminar el ítem', detail: error.message });
    }
};

// ==========================================
// 5. STATS DE UN ÍTEM
// ==========================================
export const getInventarioItemStats = async (req, res) => {
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;

        const item = await prisma.inventario.findFirst({
            where: { id: Number(id), business_id: businessId },
            select: { id: true, nombre: true, imagen_url: true },
        });
        if (!item) return res.status(404).json({ message: 'Ítem no encontrado' });

        const [statsRows, recentRows] = await Promise.all([
            prisma.$queryRaw(Prisma.sql`
                SELECT
                    COUNT(DISTINCT dp.pedido_id)::int               AS total_pedidos,
                    COALESCE(SUM(dp.cantidad), 0)::int              AS unidades_vendidas,
                    COALESCE(SUM(dp.cantidad * dp.precio_unitario), 0) AS ingresos_totales
                FROM detalle_pedidos dp
                JOIN pedidos p ON p.id = dp.pedido_id
                WHERE dp.inventario_id = ${Number(id)}
                  AND p.business_id    = ${businessId}
                  AND p.estado        != 'ANULADO'
            `),
            prisma.$queryRaw(Prisma.sql`
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
                WHERE dp.inventario_id = ${Number(id)}
                  AND p.business_id    = ${businessId}
                  AND p.estado        != 'ANULADO'
                ORDER BY p.created_at DESC
                LIMIT 10
            `),
        ]);

        return res.status(200).json({
            item,
            stats:        statsRows[0],
            recent_sales: recentRows,
        });
    } catch (error) {
        console.error('Error obteniendo stats:', error);
        return res.status(500).json({ message: 'Error al obtener estadísticas' });
    }
};

// ==========================================
// 6. SUBIR FOTO DE UN ÍTEM
// ==========================================
export const uploadInventarioPhoto = async (req, res) => {
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;
        const archivoImagen = req.file;

        if (!archivoImagen) return res.status(400).json({ message: 'No se recibió ninguna imagen' });

        const productoActual = await prisma.inventario.findFirst({
            where: { id: Number(id), business_id: businessId },
            select: { id: true, imagen_url: true },
        });
        if (!productoActual) return res.status(404).json({ message: 'Ítem no encontrado' });

        if (productoActual.imagen_url) {
            await deleteProductImageFromGCS(productoActual.imagen_url).catch(err =>
                console.warn('No se pudo borrar imagen antigua:', err.message)
            );
        }

        const uploadResult = await uploadProductImageToGCS(archivoImagen.buffer, {
            filename: archivoImagen.originalname,
            mimetype: archivoImagen.mimetype,
            userId:   req.user?.id,
            productId: id,
        });

        await prisma.inventario.update({
            where: { id: Number(id) },
            data:  { imagen_url: uploadResult.publicUrl, updated_at: new Date() },
        });

        return res.status(200).json({ imagen_url: uploadResult.publicUrl });
    } catch (error) {
        console.error('Error subiendo foto:', error);
        return res.status(500).json({ message: 'Error al subir la foto' });
    }
};

// ==========================================
// 7. SURTIR / RESTOCK
// ==========================================
export const restockInventario = async (req, res) => {
    try {
        const { id } = req.params;
        const { cantidad_a_agregar, precio_unitario_compra, cuenta, fecha, descripcion } = req.body;
        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;

        if (!usuarioId)  return res.status(401).json({ message: "Usuario no autenticado" });
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio" });

        const unidades = parseInt(cantidad_a_agregar);
        if (!unidades || unidades <= 0) return res.status(400).json({ message: "La cantidad debe ser mayor a 0" });

        const producto = await prisma.inventario.findFirst({
            where: { id: Number(id), business_id: businessId },
            select: { id: true, nombre: true, cantidad: true, precio_compra_unitario: true },
        });
        if (!producto) return res.status(404).json({ message: "Producto no encontrado" });

        const precioUnitario  = parseFloat(precio_unitario_compra) || 0;
        const valorTotal      = precioUnitario * unidades;
        const nuevaCantidad   = (producto.cantidad || 0) + unidades;
        const registrarEgreso = valorTotal > 0 && cuenta;

        const updatedItem = await prisma.$transaction(async (tx) => {
            const updated = await tx.inventario.update({
                where: { id: Number(id) },
                data: {
                    cantidad: nuevaCantidad,
                    ...(precioUnitario > 0 && {
                        precio_compra_unitario: precioUnitario,
                        costo_compra:           precioUnitario,
                    }),
                    updated_at: new Date(),
                },
            });

            if (registrarEgreso) {
                const fechaEgreso = fecha ? new Date(fecha).toISOString() : new Date().toISOString();
                const descEgreso  = descripcion || `Compra de inventario: ${producto.nombre} (${unidades} und)`;
                const now = new Date().toISOString();
                await tx.$executeRaw(Prisma.sql`
                    INSERT INTO "public"."egresos"
                        ("_id","fecha","valor","cuenta","descripcion","usuario","business_id","createdAt","updatedAt","__v")
                    VALUES
                        (${uuidv4()},${fechaEgreso},${valorTotal},${cuenta},${descEgreso},
                         ${usuarioId},${businessId},${now},${now},${0})
                `);
            }

            return updated;
        });

        const msg = registrarEgreso
            ? `Compra registrada. +${unidades} unidades y egreso de $${valorTotal.toLocaleString('es-CO')}.`
            : `Stock actualizado. +${unidades} unidades agregadas sin costo.`;

        return res.status(200).json({ message: msg, data: updatedItem });
    } catch (error) {
        console.error('Error en restock:', error);
        return res.status(500).json({ message: 'Error al surtir el producto', error: error.message });
    }
};

// ==========================================
// 8. OBTENER POR NEGOCIO (ADMIN)
// ==========================================
export const getInventarioByUserId = async (req, res) => {
    const { userId } = req.params;
    try {
        const items = await prisma.inventario.findMany({
            where:   { business_id: Number(userId) },
            orderBy: { id: 'desc' },
        });
        return res.status(200).json(items);
    } catch (error) {
        return res.status(500).json({ message: "Error al consultar negocio específico" });
    }
};
