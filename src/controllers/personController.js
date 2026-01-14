import pool from "../database.js";

// ==========================================
// 1. CREAR PERSONA (CREATE)
// ==========================================
export const createPersona = async (req, res) => {
    const client = await pool.connect();

    try {
        const {
            tipo_documento,
            numero_documento,
            nombre,
            apellido,
            direccion,
            celular,
            email,
            tipo // 'CLIENTE', 'PROVEEDOR', etc.
        } = req.body;

        const usuarioId = req.user?.id; // ID del cajero/admin que registra

        // Validaciones
        if (!usuarioId) return res.status(401).json({ message: "Usuario no autenticado" });
        if (!numero_documento || !nombre || !celular) {
            return res.status(400).json({ message: "Nombre, Documento y Celular son obligatorios" });
        }

        // Preparar datos por defecto
        const tipoFinal = tipo || 'CLIENTE';
        const createdAt = new Date().toISOString();

        const query = `
      INSERT INTO "public"."personas" (
        "tipo_documento", "numero_documento", "nombre", "apellido",
        "direccion", "celular", "email", "tipo",
        "usuario", "created_at", "updated_at"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *;
    `;

        const values = [
            tipo_documento || 'CC',
            numero_documento,
            nombre,
            apellido || '',
            direccion || '',
            celular,
            email || null,
            tipoFinal,
            usuarioId, // Guardamos quién lo creó
            createdAt,
            createdAt
        ];

        await client.query('BEGIN');
        const result = await client.query(query, values);
        await client.query('COMMIT');

        return res.status(201).json({
            success: true,
            message: "Persona creada exitosamente",
            data: result.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error creando persona:", error);

        // Manejo de error de duplicados (Postgres code 23505)
        if (error.code === '23505') {
            return res.status(409).json({
                message: "Ya existe una persona registrada con ese número de documento."
            });
        }

        return res.status(500).json({ message: "Error interno", error: error.message });
    } finally {
        client.release();
    }
};

// ==========================================
// 2. BUSCAR PERSONAS (READ - SEARCH)
// ==========================================
// Ideal para el autocompletado del POS
export const searchPersonas = async (req, res) => {
    try {
        const { q } = req.query; // ?q=juan o ?q=1098...

        let query = `SELECT * FROM "public"."personas" ORDER BY "created_at" DESC LIMIT 20`;
        let values = [];

        if (q) {
            // Busca por nombre, apellido O número de documento
            query = `
                SELECT * FROM "public"."personas" 
                WHERE 
                    "numero_documento" ILIKE $1 OR
                    "nombre" ILIKE $1 OR 
                    "apellido" ILIKE $1
                ORDER BY "nombre" ASC LIMIT 20
            `;
            values = [`%${q}%`];
        }

        const result = await pool.query(query, values);
        return res.status(200).json(result.rows);

    } catch (error) {
        console.error("Error buscando personas:", error);
        return res.status(500).json({ message: "Error en la búsqueda" });
    }
};

// ==========================================
// 3. OBTENER UNA PERSONA POR ID
// ==========================================
export const getPersonaById = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`SELECT * FROM "public"."personas" WHERE id = $1`, [id]);

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
        const {
            nombre, apellido, direccion, celular, email, tipo
        } = req.body;

        const updatedAt = new Date().toISOString();

        // Validamos existencia primero (opcional, pero buena práctica)
        const check = await client.query('SELECT id FROM personas WHERE id = $1', [id]);
        if (check.rows.length === 0) return res.status(404).json({ message: "Persona no existe" });

        const query = `
            UPDATE "public"."personas"
            SET 
                "nombre" = COALESCE($1, nombre),
                "apellido" = COALESCE($2, apellido),
                "direccion" = COALESCE($3, direccion),
                "celular" = COALESCE($4, celular),
                "email" = COALESCE($5, email),
                "tipo" = COALESCE($6, tipo),
                "updated_at" = $7
            WHERE id = $8
            RETURNING *;
        `;

        const values = [nombre, apellido, direccion, celular, email, tipo, updatedAt, id];

        await client.query('BEGIN');
        const result = await client.query(query, values);
        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            message: "Datos actualizados",
            data: result.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error actualizando:", error);
        return res.status(500).json({ message: "Error al actualizar" });
    } finally {
        client.release();
    }
};

// ==========================================
// 5. ELIMINAR PERSONA (DELETE)
// ==========================================
export const deletePersona = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;

        // NOTA DE ARQUITECTO:
        // Si esta persona ya tiene INGRESOS asociados, SQL lanzará un error 
        // de llave foránea (Foreign Key Violation). 
        // Es mejor capturarlo para decirle al usuario "No se puede borrar porque tiene ventas".

        await client.query('BEGIN');
        const result = await client.query('DELETE FROM "public"."personas" WHERE id = $1 RETURNING id', [id]);
        await client.query('COMMIT');

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Persona no encontrada" });
        }

        return res.status(200).json({ message: "Persona eliminada correctamente" });

    } catch (error) {
        await client.query('ROLLBACK');

        // Error de integridad referencial (ej: tiene ventas asociadas)
        if (error.code === '23503') {
            return res.status(400).json({
                message: "No se puede eliminar esta persona porque tiene ventas/ingresos asociados."
            });
        }

        return res.status(500).json({ message: "Error interno al eliminar" });
    } finally {
        client.release();
    }
};