// src/controllers/egresoController.js
import pool from "../database.js";

// Crear un nuevo egreso
export const createEgreso = async (req, res) => {
  try {
    const { fecha, valor, cuenta, descripcion } = req.body;

    const usuarioId = req.user?.id;
    if (!usuarioId) {
      return res.status(401).json({ message: "Usuario no autenticado" });
    }

    if (!fecha || !valor || !cuenta || !descripcion) {
      return res.status(400).json({ message: "Todos los campos son obligatorios" });
    }

    const parsedFecha = new Date(fecha);
    if (isNaN(parsedFecha.getTime())) {
      return res.status(400).json({ message: "La fecha no es válida" });
    }

    const query = `
      INSERT INTO egresos (
        fecha,
        valor,
        cuenta,
        descripcion,
        usuario,
        "createdAt",
        "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING *;
    `;

    const values = [
      parsedFecha,
      valor,
      cuenta,
      descripcion.trim(),
      usuarioId,
    ];

    const result = await pool.query(query, values);

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error al crear el egreso:", error);
    return res.status(500).json({ message: "Error al crear el egreso", error: error.message });
  }
};


// ✅ Obtener egresos del usuario logueado
export const getEgresosByUsuario = async (req, res) => {
  try {
    const usuarioId = req.user?.id;

    if (!usuarioId) {
      return res.status(401).json({ message: "Usuario no autenticado" });
    }

    const query = `
      SELECT *
      FROM egresos
      WHERE usuario = $1
      ORDER BY "fecha" DESC NULLS LAST, "createdAt" DESC NULLS LAST;
    `;

    const result = await pool.query(query, [usuarioId]);

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error al obtener los egresos del usuario:", error);
    return res.status(500).json({
      message: "Error al obtener los egresos del usuario",
      error: error.message,
    });
  }
};
