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
            unidades_por_caja,
            stock_inicial_empaques,
            codigo_barras,
            tipo_programa
        } = req.body;

        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;
        const archivoImagen = req.file;

        if (!usuarioId)  return res.status(401).json({ message: "Usuario no autenticado" });
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });
        if (!nombre || !monto) {
            return res.status(400).json({ message: 'Nombre y precio de venta (monto) son obligatorios.' });
        }

        // Procesar imagen si existe
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

        const factorConversion = parseInt(unidades_por_caja) > 0 ? parseInt(unidades_por_caja) : 1;
        const stockIngresado = parseFloat(stock_inicial_empaques) || 0;
        const cantidadTotalUnidades = stockIngresado * factorConversion;

        const query = `
            INSERT INTO inventario (
                nombre, monto, descripcion, user_id, business_id, imagen_url,
                costo_compra, unidades_por_caja, cantidad,
                codigo_barras, tipo_programa, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
            RETURNING *;
        `;

        const values = [
            nombre,
            monto,
            descripcion || null,
            usuarioId,
            businessId,
            finalImageUrl,
            costo_compra || 0,
            factorConversion,
            cantidadTotalUnidades,
            codigo_barras || null,
            tipo_programa || null
        ];

        const result = await pool.query(query, values);

        return res.status(201).json({
            message: 'Ítem creado exitosamente',
            data: result.rows[0],
            debug: {
                mensaje: `Stock: ${stockIngresado} cajas de ${factorConversion} un. Total: ${cantidadTotalUnidades}`,
                imagen: finalImageUrl ? "Imagen subida a GCS" : "Sin imagen"
            }
        });

    } catch (error) {
        console.error('Error al crear item:', error);
        if (error.code === '23505') {
            return res.status(409).json({ message: `El producto o código de barras ya existe.` });
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

        const query = `SELECT * FROM inventario WHERE business_id = $1 ORDER BY created_at DESC`;
        const result = await pool.query(query, [businessId]);

        return res.status(200).json(result.rows);
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
            costo_compra, unidades_por_caja,
            codigo_barras, tipo_programa,
            stock_inicial_empaques,
            cantidad
        } = req.body;

        const nuevoStock = stock_inicial_empaques || cantidad;
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
                console.error("Error gestionando imagen:", uploadError);
                return res.status(500).json({ message: "Error al actualizar la imagen" });
            }
        }

        const updateQuery = `
            UPDATE inventario
            SET
                nombre = $1,
                monto = $2,
                descripcion = $3,
                imagen_url = $4,
                costo_compra = $5,
                unidades_por_caja = $6,
                codigo_barras = $7,
                tipo_programa = $8,
                cantidad = $9,
                updated_at = NOW()
            WHERE id = $10
            RETURNING *;
        `;

        const values = [
            nombre,
            monto,
            descripcion,
            finalImageUrl,
            costo_compra,
            unidades_por_caja,
            codigo_barras,
            tipo_programa,
            nuevoStock,
            id
        ];

        const result = await pool.query(updateQuery, values);

        return res.status(200).json({
            message: 'Ítem actualizado correctamente',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('Error actualizando:', error);
        return res.status(500).json({ message: 'Error al actualizar el ítem' });
    }
};

// ==========================================
// 4. ELIMINAR ÍTEM (DELETE)
// ==========================================
export const deleteInventarioItem = async (req, res) => {
    try {
        const { id } = req.params;
        const { ids } = req.body;
        const businessId = req.user?.bid;

        let urlsToDelete = [];
        let deletedCount = 0;

        if (ids && Array.isArray(ids)) {
            // Borrado múltiple
            const selectResult = await pool.query(
                `SELECT imagen_url FROM inventario WHERE id = ANY($1) AND business_id = $2`,
                [ids, businessId]
            );
            urlsToDelete = selectResult.rows.map(r => r.imagen_url).filter(Boolean);

            const deleteResult = await pool.query(
                `DELETE FROM inventario WHERE id = ANY($1) AND business_id = $2 RETURNING id`,
                [ids, businessId]
            );
            deletedCount = deleteResult.rowCount;

        } else if (id) {
            // Borrado individual
            const selectResult = await pool.query(
                `SELECT imagen_url FROM inventario WHERE id = $1 AND business_id = $2`,
                [id, businessId]
            );

            if (selectResult.rows.length === 0) {
                return res.status(404).json({ message: "Ítem no encontrado" });
            }
            if (selectResult.rows[0].imagen_url) {
                urlsToDelete.push(selectResult.rows[0].imagen_url);
            }

            const deleteResult = await pool.query(
                `DELETE FROM inventario WHERE id = $1 AND business_id = $2 RETURNING id`,
                [id, businessId]
            );
            deletedCount = deleteResult.rowCount;
        } else {
            return res.status(400).json({ message: "Se requiere ID para eliminar" });
        }

        // Limpiar imágenes en GCS de forma asíncrona
        if (urlsToDelete.length > 0) {
            Promise.all(urlsToDelete.map(url => deleteProductImageFromGCS(url)))
                .then(() => console.log(`[GCS] ${urlsToDelete.length} imágenes eliminadas.`))
                .catch(err => console.error(`[GCS] Error limpiando imágenes:`, err));
        }

        return res.status(200).json({ message: `${deletedCount} ítem(s) eliminado(s) correctamente.` });

    } catch (error) {
        console.error('Error eliminando:', error);
        return res.status(500).json({ message: 'Error al eliminar' });
    }
};

// ==========================================
// 5. OBTENER POR NEGOCIO (ADMIN)
// ==========================================
export const getInventarioByUserId = async (req, res) => {
    const { userId } = req.params;
    try {
        const query = `SELECT * FROM inventario WHERE business_id = $1 ORDER BY id DESC`;
        const result = await pool.query(query, [userId]);
        return res.status(200).json(result.rows);
    } catch (error) {
        return res.status(500).json({ message: "Error al consultar negocio específico" });
    }
};
