// src/controllers/egresoController.js
import pool from "../database.js";
import { v4 as uuidv4 } from 'uuid';

// ==========================================
// 1. CREAR EGRESO (CREATE)
// ==========================================
export const createEgreso = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { fecha, valor, cuenta, descripcion } = req.body;
    const usuarioId = req.user?.id;

    // Validaciones
    if (!usuarioId) return res.status(401).json({ message: "Usuario no autenticado" });
    if (!fecha || !valor || !cuenta || !descripcion) {
      return res.status(400).json({ message: "Todos los campos son obligatorios" });
    }

    // Preparar datos
    const _id = uuidv4();
    const now = new Date();
    // Aseguramos que la fecha del gasto sea ISO String (para compatibilidad con tu columna text)
    const fechaEgreso = new Date(fecha).toISOString(); 

    const query = `
      INSERT INTO "public"."egresos" (
        "_id", "fecha", "valor", "cuenta", "descripcion", 
        "usuario", "createdAt", "updatedAt", "__v"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;

    const values = [
      _id,
      fechaEgreso,
      valor,
      cuenta,
      descripcion.trim(),
      usuarioId,
      now.toISOString(), // createdAt como texto ISO
      now.toISOString(), // updatedAt como texto ISO
      0 // __v
    ];

    await client.query('BEGIN');
    const result = await client.query(query, values);
    await client.query('COMMIT');

    return res.status(201).json(result.rows[0]);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error al crear el egreso:", error);
    return res.status(500).json({ message: "Error al crear el egreso", error: error.message });
  } finally {
    client.release();
  }
};

// ==========================================
// 2. OBTENER TODOS LOS EGRESOS DEL USUARIO (READ)
// ==========================================
export const getEgresosByUsuario = async (req, res) => {
  try {
    const usuarioId = req.user?.id;

    if (!usuarioId) {
      return res.status(401).json({ message: "Usuario no autenticado" });
    }

    // Ordenamos por fecha del gasto descendente, y luego por creación
    const query = `
      SELECT *
      FROM "public"."egresos"
      WHERE usuario = $1
      ORDER BY "fecha" DESC NULLS LAST, "createdAt" DESC NULLS LAST;
    `;

    const result = await pool.query(query, [usuarioId]);

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error al obtener los egresos:", error);
    return res.status(500).json({ message: "Error al obtener los egresos", error: error.message });
  }
};

// ==========================================
// 3. OBTENER UN EGRESO POR ID (READ ONE)
// ==========================================
export const getEgresoById = async (req, res) => {
    try {
        const { id } = req.params;
        const query = `SELECT * FROM "public"."egresos" WHERE "_id" = $1`;
        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Egreso no encontrado" });
        }

        return res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error("Error obteniendo egreso:", error);
        return res.status(500).json({ message: "Error del servidor" });
    }
};

// ==========================================
// 4. ACTUALIZAR EGRESO (UPDATE)
// ==========================================
export const updateEgreso = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { fecha, valor, cuenta, descripcion } = req.body;

        // Validar existencia
        const checkQuery = `SELECT * FROM "public"."egresos" WHERE "_id" = $1`;
        const checkResult = await client.query(checkQuery, [id]);

        if (checkResult.rows.length === 0) {
            return res.status(404).json({ message: "Egreso no encontrado para actualizar" });
        }

        const fechaEgreso = fecha ? new Date(fecha).toISOString() : checkResult.rows[0].fecha;
        const updatedAt = new Date().toISOString();

        const updateQuery = `
            UPDATE "public"."egresos"
            SET 
                "fecha" = $1,
                "valor" = $2,
                "cuenta" = $3,
                "descripcion" = $4,
                "updatedAt" = $5
            WHERE "_id" = $6
            RETURNING *;
        `;

        const values = [
            fechaEgreso,
            valor,
            cuenta,
            descripcion,
            updatedAt,
            id
        ];

        await client.query('BEGIN');
        const result = await client.query(updateQuery, values);
        await client.query('COMMIT');

        return res.status(200).json({ message: "Egreso actualizado", data: result.rows[0] });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error actualizando egreso:", error);
        return res.status(500).json({ message: "Error al actualizar", error: error.message });
    } finally {
        client.release();
    }
};

// ==========================================
// 5. ELIMINAR EGRESO (DELETE)
// ==========================================
export const deleteEgreso = async (req, res) => {
    try {
        const { id } = req.params;
        
        const query = `DELETE FROM "public"."egresos" WHERE "_id" = $1 RETURNING *`;
        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Egreso no encontrado para eliminar" });
        }

        return res.status(200).json({ message: "Egreso eliminado correctamente" });

    } catch (error) {
        console.error("Error eliminando egreso:", error);
        return res.status(500).json({ message: "Error al eliminar", error: error.message });
    }
};