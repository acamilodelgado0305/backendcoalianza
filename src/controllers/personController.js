import pool from "../database.js";

// ==========================================
// 1. CREAR PERSONA (CREATE)
// ==========================================
export const createPersona = async (req, res) => {
    const client = await pool.connect();
    try {
        const {
            tipo_documento, numero_documento, nombre,
            apellido, direccion, celular, email, tipo
        } = req.body;

        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;

        if (!usuarioId)  return res.status(401).json({ message: "Usuario no autenticado" });
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });
        if (!nombre) {
            return res.status(400).json({ message: "El nombre es obligatorio" });
        }

        const createdAt = new Date().toISOString();

        // Verificar duplicado solo dentro del mismo negocio
        if (numero_documento) {
            const dup = await client.query(
                `SELECT id FROM "public"."personas" WHERE numero_documento = $1 AND business_id = $2 LIMIT 1`,
                [numero_documento, businessId]
            );
            if (dup.rows.length > 0) {
                client.release();
                return res.status(409).json({ message: "Ya existe un contacto con ese número de documento en este negocio." });
            }
        }

        await client.query('BEGIN');
        const result = await client.query(
            `INSERT INTO "public"."personas" (
                "tipo_documento", "numero_documento", "nombre", "apellido",
                "direccion", "celular", "email", "tipo",
                "usuario", "business_id", "created_at", "updated_at"
             )
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             RETURNING *;`,
            [
                tipo_documento || 'CC', numero_documento || null, nombre,
                apellido || '', direccion || '', celular || '',
                email || null, tipo || 'CLIENTE',
                usuarioId, businessId, createdAt, createdAt
            ]
        );
        await client.query('COMMIT');

        return res.status(201).json({ success: true, message: "Persona creada exitosamente", data: result.rows[0] });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error creando persona:", error);
        if (error.code === '23505') {
            return res.status(409).json({ message: "Ya existe un contacto con ese número de documento en este negocio." });
        }
        return res.status(500).json({ message: "Error interno", error: error.message });
    } finally {
        client.release();
    }
};

// ==========================================
// 2. BUSCAR PERSONAS (READ - SEARCH)
// ==========================================
export const searchPersonas = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

        const { q } = req.query;

        let query, values;

        if (q) {
            query = `
                SELECT * FROM "public"."personas"
                WHERE business_id = $1
                  AND (
                      "numero_documento" ILIKE $2 OR
                      "nombre"           ILIKE $2 OR
                      "apellido"         ILIKE $2
                  )
                ORDER BY "nombre" ASC
                LIMIT 20
            `;
            values = [businessId, `%${q}%`];
        } else {
            query = `
                SELECT * FROM "public"."personas"
                WHERE business_id = $1
                ORDER BY "created_at" DESC
                LIMIT 20
            `;
            values = [businessId];
        }

        const result = await pool.query(query, values);
        return res.status(200).json(result.rows);

    } catch (error) {
        console.error("Error en searchPersonas:", error.message);
        return res.status(500).json({ message: "Error interno al buscar personas" });
    }
};

// ==========================================
// 3. OBTENER UNA PERSONA POR ID
// ==========================================
export const getPersonaById = async (req, res) => {
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;

        const result = await pool.query(
            `SELECT * FROM "public"."personas" WHERE id = $1 AND business_id = $2`,
            [id, businessId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Persona no encontrada" });
        }

        return res.status(200).json(result.rows[0]);
    } catch (error) {
        return res.status(500).json({ message: "Error obteniendo persona" });
    }
};

// ==========================================
// 4. ACTUALIZAR PERSONA (UPDATE)
// ==========================================
export const updatePersona = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { nombre, apellido, direccion, celular, email, tipo } = req.body;
        const businessId = req.user?.bid;

        const check = await client.query(
            `SELECT id FROM personas WHERE id = $1 AND business_id = $2`,
            [id, businessId]
        );
        if (check.rows.length === 0) return res.status(404).json({ message: "Persona no encontrada" });

        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE "public"."personas"
             SET
                 "nombre"     = COALESCE($1, nombre),
                 "apellido"   = COALESCE($2, apellido),
                 "direccion"  = COALESCE($3, direccion),
                 "celular"    = COALESCE($4, celular),
                 "email"      = COALESCE($5, email),
                 "tipo"       = COALESCE($6, tipo),
                 "updated_at" = $7
             WHERE id = $8
             RETURNING *;`,
            [nombre, apellido, direccion, celular, email, tipo, new Date().toISOString(), id]
        );
        await client.query('COMMIT');

        return res.status(200).json({ success: true, message: "Datos actualizados", data: result.rows[0] });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error actualizando:", error);
        return res.status(500).json({ message: "Error al actualizar" });
    } finally {
        client.release();
    }
};

// ==========================================
// 5. HISTORIAL DE VENTAS POR PERSONA
// ==========================================
export const getPersonaVentas = async (req, res) => {
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;

        // Verificar que la persona pertenece al negocio
        const check = await pool.query(
            `SELECT id, nombre, apellido FROM personas WHERE id = $1 AND business_id = $2`,
            [id, businessId]
        );
        if (check.rows.length === 0) return res.status(404).json({ message: "Persona no encontrada" });

        // Obtener todos sus pedidos con detalle de productos
        const pedidosRes = await pool.query(
            `SELECT
                p.id,
                p.total,
                p.estado,
                p.created_at,
                p.observaciones,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'producto',  i.nombre,
                            'cantidad',  dp.cantidad,
                            'precio',    dp.precio_unitario,
                            'subtotal',  dp.cantidad * dp.precio_unitario
                        ) ORDER BY i.nombre
                    ) FILTER (WHERE i.id IS NOT NULL), '[]'
                ) AS items
            FROM pedidos p
            LEFT JOIN detalle_pedidos dp ON p.id = dp.pedido_id
            LEFT JOIN inventario i       ON dp.inventario_id = i.id
            WHERE p.persona_id = $1 AND p.business_id = $2
            GROUP BY p.id
            ORDER BY p.created_at DESC`,
            [id, businessId]
        );

        const pedidos = pedidosRes.rows;

        // Calcular resumen estadístico
        const stats = {
            total_pedidos:     pedidos.length,
            total_gastado:     pedidos
                                .filter(p => p.estado !== 'ANULADO')
                                .reduce((s, p) => s + Number(p.total), 0),
            pedidos_entregados: pedidos.filter(p => p.estado === 'ENTREGADO').length,
            pedidos_pendientes: pedidos.filter(p => p.estado === 'PENDIENTE').length,
            pedidos_anulados:   pedidos.filter(p => p.estado === 'ANULADO').length,
        };

        return res.status(200).json({ persona: check.rows[0], pedidos, stats });

    } catch (error) {
        console.error("Error obteniendo ventas de persona:", error);
        return res.status(500).json({ message: "Error al obtener historial de ventas" });
    }
};

// ==========================================
// 6. ELIMINAR PERSONA (DELETE)
// ==========================================
export const deletePersona = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;

        await client.query('BEGIN');
        const result = await client.query(
            `DELETE FROM "public"."personas" WHERE id = $1 AND business_id = $2 RETURNING id`,
            [id, businessId]
        );
        await client.query('COMMIT');

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Persona no encontrada" });
        }

        return res.status(200).json({ message: "Persona eliminada correctamente" });

    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23503') {
            return res.status(400).json({ message: "No se puede eliminar esta persona porque tiene ventas/ingresos asociados." });
        }
        return res.status(500).json({ message: "Error interno al eliminar" });
    } finally {
        client.release();
    }
};
