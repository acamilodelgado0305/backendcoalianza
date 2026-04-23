import pool from "../database.js";
import { v4 as uuidv4 } from 'uuid';
import { uploadReceiptToGCS } from "../services/gcsPaymentReceipts.js";

// ==========================================
// 1. CREAR INGRESO (Privado / Admin)
// ==========================================
export const createIngreso = async (req, res) => {
    const client = await pool.connect();
    try {
        const {
            persona_id,     // FK a personas (opcional)
            items,          // [{inventario_id?, descripcion?, cantidad, precio_unitario}]
            descripcion,    // Texto libre si no hay items de inventario
            valor,          // Se puede omitir si se calcula desde items
            cuenta,
            customer_email,
            observaciones,
            // Campos legacy (backwards compat con formularios viejos)
            nombre, apellido, numeroDeDocumento,
            tipoDocumento, tipo_documento, tipoDeDocumento,
            tipo,           // Legacy: nombre de producto como string/array
        } = req.body;

        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;

        if (!usuarioId)  return res.status(401).json({ message: "Usuario no autenticado" });
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });
        if (!cuenta)     return res.status(400).json({ message: "La cuenta de destino es obligatoria" });

        await client.query('BEGIN');

        // Obtener datos de persona si se provee persona_id
        let personaData = null;
        if (persona_id) {
            const pRes = await client.query(
                `SELECT * FROM personas WHERE id = $1 AND business_id = $2`,
                [persona_id, businessId]
            );
            personaData = pRes.rows[0] || null;
        }

        // Parsear items (nuevo formato) o construirlos desde tipo legacy
        const parsedItems = Array.isArray(items) ? items : [];

        // Si vienen en formato legacy (tipo como array de nombres de inventario)
        if (parsedItems.length === 0 && tipo) {
            const tipoArr = Array.isArray(tipo) ? tipo : [tipo];
            for (const nombreProd of tipoArr) {
                const invRes = await client.query(
                    `SELECT id, nombre, monto FROM inventario WHERE nombre = $1 AND business_id = $2 LIMIT 1`,
                    [nombreProd, businessId]
                );
                const inv = invRes.rows[0];
                parsedItems.push({
                    inventario_id:   inv?.id || null,
                    descripcion:     nombreProd,
                    cantidad:        1,
                    precio_unitario: inv?.monto || 0,
                });
            }
        }

        // Calcular total desde items si no se pasa valor
        let totalValor = Number(valor) || 0;
        if (!totalValor && parsedItems.length > 0) {
            totalValor = parsedItems.reduce(
                (sum, i) => sum + Number(i.precio_unitario || 0) * Number(i.cantidad || 1),
                0
            );
        }

        if (!totalValor) return res.status(400).json({ message: "El valor total es obligatorio" });

        // Campos para backwards compat con tablas/reportes existentes
        const nombreFinal    = personaData?.nombre           || nombre      || 'Cliente';
        const apellidoFinal  = personaData?.apellido         || apellido    || 'General';
        const docFinal       = personaData?.numero_documento || numeroDeDocumento || '0';
        const tipoDocFinal   = personaData?.tipo_documento   || tipoDocumento || tipo_documento || tipoDeDocumento || 'CC';
        const emailFinal     = personaData?.email            || customer_email || '';

        // Descripción del producto (se actualizará con nombres reales de inventario)
        const descripcionFinal = descripcion
            || (Array.isArray(tipo) ? tipo.join(', ') : tipo)
            || 'Venta';

        const _id              = uuidv4();
        const createdAt        = new Date();
        const fechaVencimiento = new Date(createdAt);
        fechaVencimiento.setFullYear(fechaVencimiento.getFullYear() + 1);
        const payment_reference = `POS-${Date.now()}`;

        await client.query(
            `INSERT INTO "public"."ingresos" (
                "_id", "nombre", "apellido", "numeroDeDocumento", "tipoDocumento", "fechaVencimiento",
                "producto", "descripcion", "valor", "cuenta", "customer_email", "payment_status",
                "payment_reference", "usuario", "business_id", "createdAt", "updatedAt", "__v",
                "persona_id"
             )
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
            [
                _id, nombreFinal, apellidoFinal, docFinal, tipoDocFinal,
                fechaVencimiento.toISOString(), descripcionFinal, descripcionFinal,
                String(totalValor), cuenta, emailFinal, 'APPROVED',
                payment_reference, usuarioId, businessId,
                createdAt.toISOString(), createdAt.toISOString(), '0',
                persona_id || null,
            ]
        );

        // Insertar ingreso_items y construir nombre de producto real
        if (parsedItems.length > 0) {
            const nombresProducto = [];
            for (const item of parsedItems) {
                let prodNombre = item.descripcion || null;
                if (item.inventario_id) {
                    const invRes = await client.query(
                        `SELECT nombre FROM inventario WHERE id = $1 AND business_id = $2`,
                        [item.inventario_id, businessId]
                    );
                    prodNombre = invRes.rows[0]?.nombre || prodNombre || 'Producto';
                }
                nombresProducto.push(prodNombre);

                await client.query(
                    `INSERT INTO ingreso_items (ingreso_id, inventario_id, descripcion, cantidad, precio_unitario)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [_id, item.inventario_id || null, prodNombre, Number(item.cantidad) || 1, Number(item.precio_unitario) || 0]
                );
            }

            // Actualizar campo producto con nombres reales
            const productoFinal = nombresProducto.filter(Boolean).join(', ') || descripcionFinal;
            await client.query(
                `UPDATE "public"."ingresos" SET "producto" = $1, "descripcion" = $1 WHERE "_id" = $2`,
                [productoFinal, _id]
            );
        }

        await client.query('COMMIT');
        return res.status(201).json({
            success: true,
            message: "Ingreso registrado exitosamente",
            data: { _id, total: totalValor }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error al crear ingreso:", error);
        return res.status(500).json({ message: "Error interno al crear el ingreso", error: error.message });
    } finally {
        client.release();
    }
};

// ==========================================
// 2. CREAR INGRESO PÚBLICO (Landing Page)
// ==========================================
export const createIngresoPublico = async (req, res) => {
    const client = await pool.connect();
    try {
        const {
            nombre, apellido, numeroDeDocumento, valor, cuenta,
            tipo, customer_email, usuarioId, business_id,
            tipoDocumento, tipo_documento, tipoDeDocumento
        } = req.body;

        const businessId = business_id || usuarioId;
        if (!businessId) return res.status(400).json({ message: "Falta business_id" });
        if (!valor || !cuenta) return res.status(400).json({ message: "Valor y cuenta son obligatorios" });

        let comprobante_url = '';
        if (req.file) {
            if (!numeroDeDocumento) return res.status(400).json({ message: "Se requiere numeroDeDocumento para subir el comprobante" });
            comprobante_url = await uploadReceiptToGCS(req.file.buffer, {
                filename: req.file.originalname, mimetype: req.file.mimetype,
                numeroDocumento: numeroDeDocumento
            });
        }

        const _id              = uuidv4();
        const createdAt        = new Date();
        const fechaVencimiento = new Date(createdAt);
        fechaVencimiento.setFullYear(fechaVencimiento.getFullYear() + 1);
        const tipoDocumentoFinal = tipoDocumento || tipo_documento || tipoDeDocumento || 'CC';
        const productoStr = Array.isArray(tipo) ? tipo.join(', ') : (tipo || 'Certificado Express');

        await client.query('BEGIN');
        await client.query(
            `INSERT INTO "public"."ingresos" (
                "_id", "nombre", "apellido", "numeroDeDocumento", "tipoDocumento", "fechaVencimiento",
                "producto", "descripcion", "valor", "cuenta", "customer_email", "payment_status",
                "payment_reference", "usuario", "business_id", "comprobante_url", "createdAt", "updatedAt", "__v"
             )
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
            [
                _id, nombre || 'Cliente', apellido || '', numeroDeDocumento || '0',
                tipoDocumentoFinal, fechaVencimiento.toISOString(),
                productoStr, productoStr, String(valor), cuenta,
                customer_email || '', 'VERIFICACION_PENDIENTE',
                `WEB-${Date.now()}`, usuarioId || String(businessId),
                businessId, comprobante_url,
                createdAt.toISOString(), createdAt.toISOString(), '0',
            ]
        );

        // Registrar o ignorar si ya existe el contacto (upsert silencioso)
        if (numeroDeDocumento && numeroDeDocumento !== '0') {
            await client.query(
                `INSERT INTO "public"."personas" (
                    "tipo_documento", "numero_documento", "nombre", "apellido",
                    "celular", "direccion", "email", "tipo", "usuario", "business_id", "created_at", "updated_at"
                 )
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                 ON CONFLICT DO NOTHING`,
                [
                    tipoDocumentoFinal,
                    String(numeroDeDocumento),
                    nombre || 'Cliente',
                    apellido || '',
                    '',
                    '',
                    customer_email || null,
                    'CLIENTE',
                    usuarioId || String(businessId),
                    businessId,
                    createdAt.toISOString(),
                    createdAt.toISOString(),
                ]
            );
        }

        await client.query('COMMIT');

        return res.status(201).json({
            success: true, message: "Solicitud recibida. En verificación."
        });

    } catch (error) {
        await client.query('ROLLBACK');
        return res.status(500).json({ message: "Error interno", error: error.message });
    } finally {
        client.release();
    }
};

// ==========================================
// 3. LISTAR INGRESOS — enriquecidos con persona e items
// ==========================================
export const getIngresosByUsuario = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: "No autorizado" });

        const { fecha_inicio, fecha_fin, cuenta, payment_status, page = 1, limit = 50 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const params = [businessId];
        const conditions = [`i.business_id = $1`];

        if (fecha_inicio) {
            params.push(new Date(fecha_inicio).toISOString());
            conditions.push(`i."createdAt" >= $${params.length}`);
        }
        if (fecha_fin) {
            const fin = new Date(fecha_fin); fin.setHours(23, 59, 59, 999);
            params.push(fin.toISOString());
            conditions.push(`i."createdAt" <= $${params.length}`);
        }
        if (cuenta) {
            params.push(cuenta);
            conditions.push(`i."cuenta" = $${params.length}`);
        }
        if (payment_status) {
            params.push(payment_status.toUpperCase());
            conditions.push(`i."payment_status" = $${params.length}`);
        }

        const where = conditions.join(' AND ');

        const countResult = await pool.query(
            `SELECT COUNT(DISTINCT i."_id") FROM "public"."ingresos" i WHERE ${where}`,
            params
        );
        const total = parseInt(countResult.rows[0].count, 10);

        params.push(Number(limit), offset);
        const dataResult = await pool.query(
            `SELECT
                i.*,
                COALESCE(per.nombre,   i.nombre)   AS cliente_nombre,
                COALESCE(per.apellido, i.apellido)  AS cliente_apellido,
                COALESCE(per.numero_documento, i."numeroDeDocumento") AS cliente_documento,
                COALESCE(per.tipo_documento,   i."tipoDocumento")     AS cliente_tipo_doc,
                per.celular AS cliente_celular,
                COALESCE(agg.items_detalle, '[]') AS items_detalle
            FROM "public"."ingresos" i
            LEFT JOIN "public"."personas" per ON per.id = i.persona_id
            LEFT JOIN (
                SELECT
                    ii.ingreso_id,
                    json_agg(
                        json_build_object(
                            'inventario_id', ii.inventario_id,
                            'descripcion',   COALESCE(inv.nombre, ii.descripcion),
                            'nombre_producto', COALESCE(inv.nombre, ii.descripcion),
                            'cantidad',      ii.cantidad,
                            'precio_unitario', ii.precio_unitario,
                            'subtotal',      ii.cantidad * ii.precio_unitario
                        ) ORDER BY ii.id
                    ) AS items_detalle
                FROM "public"."ingreso_items" ii
                LEFT JOIN "public"."inventario" inv ON inv.id = ii.inventario_id
                GROUP BY ii.ingreso_id
            ) agg ON agg.ingreso_id = i."_id"
            WHERE ${where}
            ORDER BY i."createdAt" DESC NULLS LAST
            LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );

        return res.status(200).json({
            data: dataResult.rows,
            pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) }
        });

    } catch (error) {
        console.error("Error al obtener ingresos:", error);
        return res.status(500).json({ message: "Error al obtener los ingresos", error: error.message });
    }
};

// ==========================================
// 4. OBTENER UN INGRESO POR ID
// ==========================================
export const getIngresoById = async (req, res) => {
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;

        const result = await pool.query(
            `SELECT
                i.*,
                COALESCE(per.nombre,   i.nombre)   AS cliente_nombre,
                COALESCE(per.apellido, i.apellido)  AS cliente_apellido,
                COALESCE(per.numero_documento, i."numeroDeDocumento") AS cliente_documento,
                COALESCE(per.tipo_documento,   i."tipoDocumento")     AS cliente_tipo_doc,
                COALESCE(agg.items_detalle, '[]') AS items_detalle
            FROM "public"."ingresos" i
            LEFT JOIN "public"."personas" per ON per.id = i.persona_id
            LEFT JOIN (
                SELECT
                    ii.ingreso_id,
                    json_agg(
                        json_build_object(
                            'inventario_id', ii.inventario_id,
                            'descripcion',   COALESCE(inv.nombre, ii.descripcion),
                            'nombre_producto', COALESCE(inv.nombre, ii.descripcion),
                            'cantidad',      ii.cantidad,
                            'precio_unitario', ii.precio_unitario,
                            'subtotal',      ii.cantidad * ii.precio_unitario
                        ) ORDER BY ii.id
                    ) AS items_detalle
                FROM "public"."ingreso_items" ii
                LEFT JOIN "public"."inventario" inv ON inv.id = ii.inventario_id
                GROUP BY ii.ingreso_id
            ) agg ON agg.ingreso_id = i."_id"
            WHERE i."_id" = $1 AND i.business_id = $2`,
            [id, businessId]
        );

        if (result.rows.length === 0) return res.status(404).json({ message: "Ingreso no encontrado" });
        return res.status(200).json(result.rows[0]);

    } catch (error) {
        return res.status(500).json({ message: "Error del servidor", error: error.message });
    }
};

// ==========================================
// 5. ESTADÍSTICAS DE INGRESOS
// ==========================================
export const getIngresoStats = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: "No autorizado" });

        const { fecha_inicio, fecha_fin } = req.query;
        const paramsApproved = [businessId];
        const condApproved   = [`business_id = $1`, `payment_status = 'APPROVED'`];
        const paramsAll      = [businessId];
        const condAll        = [`business_id = $1`];

        if (fecha_inicio) {
            const fi = new Date(fecha_inicio).toISOString();
            paramsApproved.push(fi); condApproved.push(`"createdAt" >= $${paramsApproved.length}`);
            paramsAll.push(fi);      condAll.push(`"createdAt" >= $${paramsAll.length}`);
        }
        if (fecha_fin) {
            const fin = new Date(fecha_fin); fin.setHours(23, 59, 59, 999);
            const fiStr = fin.toISOString();
            paramsApproved.push(fiStr); condApproved.push(`"createdAt" <= $${paramsApproved.length}`);
            paramsAll.push(fiStr);      condAll.push(`"createdAt" <= $${paramsAll.length}`);
        }

        const whereApproved = condApproved.join(' AND ');
        const whereAll      = condAll.join(' AND ');

        const [resumen, porCuenta, porProducto, porEstado] = await Promise.all([
            pool.query(
                `SELECT COUNT(*)::int AS total_registros,
                        COALESCE(SUM(valor::numeric), 0) AS total_ingresos,
                        COALESCE(AVG(valor::numeric), 0) AS promedio_ingreso,
                        COALESCE(MAX(valor::numeric), 0) AS ingreso_maximo
                 FROM "public"."ingresos" WHERE ${whereApproved}`,
                paramsApproved
            ),
            pool.query(
                `SELECT cuenta, COUNT(*)::int AS cantidad, COALESCE(SUM(valor::numeric), 0) AS total
                 FROM "public"."ingresos" WHERE ${whereApproved}
                 GROUP BY cuenta ORDER BY total DESC`,
                paramsApproved
            ),
            pool.query(
                `SELECT COALESCE(inv.nombre, ii.descripcion, i.producto) AS producto,
                        COUNT(DISTINCT i."_id")::int AS cantidad,
                        COALESCE(SUM(ii.cantidad * ii.precio_unitario), SUM(i.valor::numeric)) AS total
                 FROM "public"."ingresos" i
                 LEFT JOIN "public"."ingreso_items" ii ON ii.ingreso_id = i."_id"
                 LEFT JOIN "public"."inventario" inv ON inv.id = ii.inventario_id
                 WHERE ${whereApproved.replace(/\bi\./g, 'i.')}
                 GROUP BY 1 ORDER BY total DESC LIMIT 10`,
                paramsApproved
            ),
            pool.query(
                `SELECT payment_status, COUNT(*)::int AS cantidad, COALESCE(SUM(valor::numeric), 0) AS total
                 FROM "public"."ingresos" WHERE ${whereAll} GROUP BY payment_status`,
                paramsAll
            ),
        ]);

        return res.status(200).json({
            resumen:     resumen.rows[0],
            por_cuenta:  porCuenta.rows,
            por_producto: porProducto.rows,
            por_estado:  porEstado.rows,
        });

    } catch (error) {
        return res.status(500).json({ message: "Error al obtener estadísticas", error: error.message });
    }
};

// ==========================================
// 6. VERIFICAR INGRESO (PENDIENTE → APPROVED)
// ==========================================
export const verificarIngreso = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { payment_status } = req.body;
        const businessId = req.user?.bid;

        if (!['APPROVED', 'RECHAZADO'].includes(payment_status))
            return res.status(400).json({ message: "Estado inválido" });

        const check = await client.query(
            `SELECT * FROM "public"."ingresos" WHERE "_id" = $1 AND business_id = $2`,
            [id, businessId]
        );
        if (check.rows.length === 0) return res.status(404).json({ message: "Ingreso no encontrado" });
        if (check.rows[0].payment_status !== 'VERIFICACION_PENDIENTE')
            return res.status(409).json({ message: "Solo se pueden verificar ingresos en VERIFICACION_PENDIENTE" });

        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE "public"."ingresos" SET "payment_status" = $1, "updatedAt" = $2 WHERE "_id" = $3 RETURNING *`,
            [payment_status, new Date().toISOString(), id]
        );
        await client.query('COMMIT');

        return res.status(200).json({ success: true, data: result.rows[0] });

    } catch (error) {
        await client.query('ROLLBACK');
        return res.status(500).json({ message: "Error al verificar", error: error.message });
    } finally {
        client.release();
    }
};

// ==========================================
// 7. ACTUALIZAR INGRESO
// ==========================================
export const updateIngreso = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;
        const {
            persona_id, items, descripcion, valor, cuenta,
            customer_email,
            // legacy
            nombre, apellido, numeroDeDocumento, tipoDocumento, tipo_documento, tipoDeDocumento, tipo,
        } = req.body;

        const check = await client.query(
            `SELECT * FROM "public"."ingresos" WHERE "_id" = $1 AND business_id = $2`,
            [id, businessId]
        );
        if (check.rows.length === 0) return res.status(404).json({ message: "Ingreso no encontrado" });
        const prev = check.rows[0];

        await client.query('BEGIN');

        // Obtener persona si se provee
        let personaData = null;
        if (persona_id) {
            const pRes = await client.query(
                `SELECT * FROM personas WHERE id = $1 AND business_id = $2`,
                [persona_id, businessId]
            );
            personaData = pRes.rows[0] || null;
        }

        // Parsear items
        const parsedItems = Array.isArray(items) ? items : [];
        if (parsedItems.length === 0 && tipo) {
            const tipoArr = Array.isArray(tipo) ? tipo : [tipo];
            for (const nombreProd of tipoArr) {
                const invRes = await client.query(
                    `SELECT id, monto FROM inventario WHERE nombre = $1 AND business_id = $2 LIMIT 1`,
                    [nombreProd, businessId]
                );
                const inv = invRes.rows[0];
                parsedItems.push({ inventario_id: inv?.id || null, descripcion: nombreProd, cantidad: 1, precio_unitario: inv?.monto || 0 });
            }
        }

        // Recalcular valor
        let totalValor = Number(valor) || 0;
        if (!totalValor && parsedItems.length > 0)
            totalValor = parsedItems.reduce((s, i) => s + Number(i.precio_unitario || 0) * Number(i.cantidad || 1), 0);
        if (!totalValor) totalValor = Number(prev.valor) || 0;

        const tipoDocFinal = tipoDocumento || tipo_documento || tipoDeDocumento || prev.tipoDocumento || 'CC';
        const productoStr  = descripcion || (Array.isArray(tipo) ? tipo.join(', ') : tipo) || prev.producto;

        await client.query(
            `UPDATE "public"."ingresos" SET
                "nombre"            = $1,
                "apellido"          = $2,
                "numeroDeDocumento" = $3,
                "tipoDocumento"     = $4,
                "valor"             = $5,
                "cuenta"            = $6,
                "producto"          = $7,
                "descripcion"       = $7,
                "customer_email"    = $8,
                "persona_id"        = $9,
                "updatedAt"         = $10
             WHERE "_id" = $11`,
            [
                personaData?.nombre           || nombre    || prev.nombre,
                personaData?.apellido         || apellido  || prev.apellido,
                personaData?.numero_documento || numeroDeDocumento || prev.numeroDeDocumento,
                tipoDocFinal,
                String(totalValor),
                cuenta ?? prev.cuenta,
                productoStr,
                personaData?.email || customer_email || prev.customer_email,
                persona_id ?? prev.persona_id,
                new Date().toISOString(),
                id,
            ]
        );

        // Reemplazar items si se enviaron
        if (parsedItems.length > 0) {
            await client.query(`DELETE FROM ingreso_items WHERE ingreso_id = $1`, [id]);
            const nombresProducto = [];
            for (const item of parsedItems) {
                let prodNombre = item.descripcion || null;
                if (item.inventario_id) {
                    const invRes = await client.query(
                        `SELECT nombre FROM inventario WHERE id = $1`, [item.inventario_id]
                    );
                    prodNombre = invRes.rows[0]?.nombre || prodNombre;
                }
                nombresProducto.push(prodNombre);
                await client.query(
                    `INSERT INTO ingreso_items (ingreso_id, inventario_id, descripcion, cantidad, precio_unitario)
                     VALUES ($1,$2,$3,$4,$5)`,
                    [id, item.inventario_id || null, prodNombre, Number(item.cantidad) || 1, Number(item.precio_unitario) || 0]
                );
            }
            const productoFinal = nombresProducto.filter(Boolean).join(', ');
            if (productoFinal) await client.query(
                `UPDATE "public"."ingresos" SET "producto" = $1, "descripcion" = $1 WHERE "_id" = $2`,
                [productoFinal, id]
            );
        }

        await client.query('COMMIT');
        return res.status(200).json({ message: "Ingreso actualizado", success: true });

    } catch (error) {
        await client.query('ROLLBACK');
        return res.status(500).json({ message: "Error al actualizar", error: error.message });
    } finally {
        client.release();
    }
};

// ==========================================
// 8. ELIMINAR INGRESO
// ==========================================
export const deleteIngreso = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;

        await client.query('BEGIN');
        await client.query(`DELETE FROM ingreso_items WHERE ingreso_id = $1`, [id]);
        const result = await client.query(
            `DELETE FROM "public"."ingresos" WHERE "_id" = $1 AND business_id = $2 RETURNING *`,
            [id, businessId]
        );
        await client.query('COMMIT');

        if (result.rows.length === 0) return res.status(404).json({ message: "Ingreso no encontrado" });
        return res.status(200).json({ message: "Ingreso eliminado correctamente" });

    } catch (error) {
        await client.query('ROLLBACK');
        return res.status(500).json({ message: "Error al eliminar", error: error.message });
    } finally {
        client.release();
    }
};
