import pool from '../database.js';
// Importamos las funciones de tu servicio de GCS
import { uploadProductImageToGCS, deleteProductImageFromGCS } from '../services/gcsProductImages.js';

// ==========================================
// 1. CREAR ÍTEM (CREATE) - CON CARGA DE FOTO GCS
// ==========================================
export const createInventarioItem = async (req, res) => {
    try {
        const {
            nombre,
            monto,
            descripcion,
            // imagen_url, -> Ya no dependemos solo del string, priorizamos el archivo
            costo_compra,
            unidades_por_caja,
            stock_inicial_empaques,
            codigo_barras,
            tipo_programa
        } = req.body;

        const usuarioId = req.user?.id;
        const archivoImagen = req.file; // Multer deja el archivo aquí

        // --- VALIDACIONES ---
        if (!usuarioId) return res.status(401).json({ message: "Usuario no autenticado" });
        if (!nombre || !monto) {
            return res.status(400).json({ message: 'Nombre y precio de venta (monto) son obligatorios.' });
        }

        // --- 1. PROCESAR IMAGEN (SI EXISTE) ---
        let finalImageUrl = req.body.imagen_url || null; // Por defecto null o si mandan un string directo

        if (archivoImagen) {
            try {
                const uploadResult = await uploadProductImageToGCS(archivoImagen.buffer, {
                    filename: archivoImagen.originalname,
                    mimetype: archivoImagen.mimetype,
                    userId: usuarioId,
                    productId: 'new' // Aún no tenemos ID, usaremos 'new' en el nombre del archivo
                });
                finalImageUrl = uploadResult.publicUrl;
            } catch (uploadError) {
                console.error("Error subiendo imagen a GCS:", uploadError);
                return res.status(500).json({ message: "Error al subir la imagen del producto" });
            }
        }

        // --- 2. LÓGICA DE NEGOCIO (CONVERSIÓN CAJAS -> UNIDADES) ---
        const factorConversion = parseInt(unidades_por_caja) > 0 ? parseInt(unidades_por_caja) : 1;
        const stockIngresado = parseFloat(stock_inicial_empaques) || 0;
        const cantidadTotalUnidades = stockIngresado * factorConversion;

        // --- 3. QUERY SQL ---
        const query = `
            INSERT INTO inventario (
                nombre, monto, descripcion, user_id, imagen_url, 
                costo_compra, unidades_por_caja, cantidad, 
                codigo_barras, tipo_programa, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
            RETURNING *;
        `;

        const values = [
            nombre,
            monto,
            descripcion || null,
            usuarioId,
            finalImageUrl, // La URL de GCS o null
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
        const usuarioId = req.user?.id;
        if (!usuarioId) return res.status(401).json({ message: "Usuario no autenticado" });

        const query = `SELECT * FROM inventario WHERE user_id = $1 ORDER BY created_at DESC`;
        const result = await pool.query(query, [usuarioId]);

        return res.status(200).json(result.rows);
    } catch (error) {
        console.error("Error obteniendo inventario:", error);
        return res.status(500).json({ message: "Error al obtener inventario" });
    }
};

// ==========================================
// 3. ACTUALIZAR ÍTEM (UPDATE) - CON REEMPLAZO DE IMAGEN
// ==========================================
export const updateInventarioItem = async (req, res) => {
    try {
        const { id } = req.params;
        // 1. 🔥 CAMBIO AQUÍ: Debemos recibir la variable del stock
        // (Nota: En tu frontend lo llamaste 'stock_inicial_empaques' o 'cantidad', aquí capturamos ambos por si acaso)
        const {
            nombre, monto, descripcion,
            costo_compra, unidades_por_caja,
            codigo_barras, tipo_programa,
            stock_inicial_empaques,
            cantidad // Por si lo envías con este nombre
        } = req.body;

        // Definimos el valor final del stock a guardar
        // Si no viene ninguno, usamos undefined para no romper lógica, aunque idealmente deberíamos validar
        const nuevoStock = stock_inicial_empaques || cantidad;

        const usuarioId = req.user?.id;
        const archivoImagen = req.file;

        // --- VERIFICACIÓN DE EXISTENCIA (Igual que antes) ---
        const checkQuery = `SELECT * FROM inventario WHERE id = $1 AND user_id = $2`;
        const checkResult = await pool.query(checkQuery, [id, usuarioId]);

        if (checkResult.rows.length === 0) {
            return res.status(404).json({ message: "Ítem no encontrado o no autorizado" });
        }

        const productoActual = checkResult.rows[0];
        let finalImageUrl = req.body.imagen_url || productoActual.imagen_url;

        // --- PROCESAR IMAGEN (Igual que antes) ---
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

        // 3. 🔥 CAMBIO AQUÍ: Agregar la columna 'cantidad' al UPDATE
        // Asumo que tu columna en la base de datos se llama 'cantidad'. 
        // Si se llama 'stock', cambia la palabra 'cantidad' en el SQL de abajo.

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
                cantidad = $9,      -- <--- ¡ESTO FALTABA!
                updated_at = NOW()
            WHERE id = $10          -- <--- El índice del ID se mueve a 10
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
            nuevoStock, // $9 -> Aquí pasamos el valor de la cantidad
            id          // $10 -> El ID va al final
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
// 4. ELIMINAR ÍTEM (DELETE) - BORRANDO IMAGEN DE GCS
// ==========================================
export const deleteInventarioItem = async (req, res) => {
    try {
        const { id } = req.params;
        const { ids } = req.body; // Array de IDs
        const usuarioId = req.user?.id;

        // Lógica para obtener las URLs de las imágenes antes de borrar de DB
        let urlsToDelete = [];
        let deletedCount = 0;

        if (ids && Array.isArray(ids)) {
            // BORRADO MÚLTIPLE
            // 1. Obtener URLs
            const selectQuery = `SELECT imagen_url FROM inventario WHERE id = ANY($1) AND user_id = $2`;
            const selectResult = await pool.query(selectQuery, [ids, usuarioId]);
            urlsToDelete = selectResult.rows.map(row => row.imagen_url).filter(url => url);

            // 2. Borrar de DB
            const deleteQuery = `DELETE FROM inventario WHERE id = ANY($1) AND user_id = $2 RETURNING id`;
            const deleteResult = await pool.query(deleteQuery, [ids, usuarioId]);
            deletedCount = deleteResult.rowCount;

        } else if (id) {
            // BORRADO INDIVIDUAL
            const selectQuery = `SELECT imagen_url FROM inventario WHERE id = $1 AND user_id = $2`;
            const selectResult = await pool.query(selectQuery, [id, usuarioId]);

            if (selectResult.rows.length === 0) {
                return res.status(404).json({ message: "Ítem no encontrado" });
            }
            if (selectResult.rows[0].imagen_url) {
                urlsToDelete.push(selectResult.rows[0].imagen_url);
            }

            const deleteQuery = `DELETE FROM inventario WHERE id = $1 AND user_id = $2 RETURNING id`;
            const deleteResult = await pool.query(deleteQuery, [id, usuarioId]);
            deletedCount = deleteResult.rowCount;
        } else {
            return res.status(400).json({ message: "Se requiere ID para eliminar" });
        }

        // 3. Limpiar GCS (Asíncrono - No bloqueamos la respuesta si falla el borrado de imagen)
        if (urlsToDelete.length > 0) {
            Promise.all(urlsToDelete.map(url => deleteProductImageFromGCS(url)))
                .then(() => console.log(`[GCS] Limpieza completada: ${urlsToDelete.length} imágenes borradas.`))
                .catch(err => console.error(`[GCS] Error en limpieza de imágenes:`, err));
        }

        return res.status(200).json({ message: `${deletedCount} ítem(s) eliminado(s) correctamente.` });

    } catch (error) {
        console.error('Error eliminando:', error);
        return res.status(500).json({ message: 'Error al eliminar' });
    }
};

// ==========================================
// 5. OBTENER POR USUARIO (ADMIN)
// ==========================================
export const getInventarioByUserId = async (req, res) => {
    const { userId } = req.params;
    try {
        const query = `SELECT * FROM inventario WHERE user_id = $1 ORDER BY id DESC`;
        const result = await pool.query(query, [userId]);
        return res.status(200).json(result.rows);
    } catch (error) {
        return res.status(500).json({ message: "Error al consultar usuario específico" });
    }
};