// src/controllers/ingresoController.js
import pool from "../database.js";

// Crear un nuevo ingreso
import { v4 as uuidv4 } from 'uuid'; // Importamos la librería UUID

export const createIngreso = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      nombre,
      apellido,
      numeroDeDocumento,
      valor,
      cuenta,
      tipo, // En el front se llama 'tipo', en la DB 'producto'
      customer_email
    } = req.body;

    const usuarioId = req.user?.id; // Asumiendo que usas un middleware de auth

    // Validaciones básicas
    if (!usuarioId) return res.status(401).json({ message: "Usuario no autenticado" });
    if (!valor || !cuenta) return res.status(400).json({ message: "Valor y cuenta son obligatorios" });

    // 1. Preparar datos
    const _id = uuidv4();
    const createdAt = new Date();

    // Lógica: Fecha de vencimiento 1 año después (según patrones de tu SQL)
    const fechaVencimiento = new Date(createdAt);
    fechaVencimiento.setFullYear(fechaVencimiento.getFullYear() + 1);

    const payment_reference = `POS-${Date.now()}`;
    const payment_status = 'APPROVED';

    // 2. Manejo de Productos (Array a String)
    let productoStr = '';
    if (Array.isArray(tipo)) {
      productoStr = tipo.join(', ');
    } else {
      productoStr = tipo || 'General';
    }

    // 3. Query SQL optimizada
    const query = `
      INSERT INTO "public"."ingresos" (
        "_id", "nombre", "apellido", "numeroDeDocumento", "fechaVencimiento",
        "producto", "valor", "cuenta", "customer_email", "payment_status",
        "payment_reference", "usuario", "createdAt", "updatedAt", "__v"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *;
    `;

    const values = [
      _id,
      nombre || 'Cliente',
      apellido || 'General',
      numeroDeDocumento || '0',
      fechaVencimiento.toISOString(),
      productoStr,
      String(valor), // Tu DB espera 'text' para valor
      cuenta,
      customer_email || '',
      payment_status,
      payment_reference,
      usuarioId,
      createdAt.toISOString(),
      createdAt.toISOString(), // updatedAt igual al created al inicio
      '0' // __v
    ];

    await client.query('BEGIN');
    const result = await client.query(query, values);
    await client.query('COMMIT');

    return res.status(201).json(result.rows[0]);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error al crear el ingreso:", error);
    return res.status(500).json({ message: "Error interno al crear el ingreso", error: error.message });
  } finally {
    client.release();
  }
};


// ... (Tus importaciones y código existente arriba) ...

// NUEVA FUNCIÓN PARA LA LANDING PAGE (SIN TOKEN)
export const createIngresoPublico = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      nombre,
      apellido,
      numeroDeDocumento,
      valor,
      cuenta,
      tipo, 
      customer_email,
      usuarioId // <--- AHORA LO RECIBIMOS OBLIGATORIAMENTE DEL BODY
    } = req.body;

    // 1. Validación específica para este endpoint público
    if (!usuarioId) {
        return res.status(400).json({ message: "Error: Se requiere el ID del beneficiario (usuarioId) para registrar la venta pública." });
    }
    
    if (!valor || !cuenta) {
        return res.status(400).json({ message: "Valor y cuenta son obligatorios" });
    }

    // 2. Preparar datos (Misma lógica que el original para mantener consistencia)
    const _id = uuidv4();
    const createdAt = new Date();
    
    // Fecha de vencimiento: 1 año después
    const fechaVencimiento = new Date(createdAt);
    fechaVencimiento.setFullYear(fechaVencimiento.getFullYear() + 1);

    const payment_reference = `WEB-${Date.now()}`; // Cambié 'POS' por 'WEB' para que sepas que vino de la página
    const payment_status = 'APPROVED'; // O 'PENDING' si prefieres validar manual

    // Convertir array de productos a string
    let productoStr = '';
    if (Array.isArray(tipo)) {
      productoStr = tipo.join(', ');
    } else {
      productoStr = tipo || 'General';
    }

    // 3. Query SQL (Exactamente igual a tu tabla actual)
    const query = `
      INSERT INTO "public"."ingresos" (
        "_id", "nombre", "apellido", "numeroDeDocumento", "fechaVencimiento",
        "producto", "valor", "cuenta", "customer_email", "payment_status",
        "payment_reference", "usuario", "createdAt", "updatedAt", "__v"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *;
    `;

    const values = [
      _id,
      nombre || 'Cliente Web',
      apellido || '',
      numeroDeDocumento || '0',
      fechaVencimiento.toISOString(),
      productoStr,
      String(valor),
      cuenta,
      customer_email || '',
      payment_status,
      payment_reference,
      usuarioId, // Usamos el ID que llegó del body
      createdAt.toISOString(),
      createdAt.toISOString(),
      '0'
    ];

    await client.query('BEGIN');
    const result = await client.query(query, values);
    await client.query('COMMIT');

    // Respondemos éxito
    return res.status(201).json({ 
        success: true, 
        message: "Venta pública registrada", 
        data: result.rows[0] 
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error en createIngresoPublico:", error);
    return res.status(500).json({ message: "Error interno", error: error.message });
  } finally {
    client.release();
  }
};

// ✅ Obtener ingresos del usuario logueado
export const getIngresosByUsuario = async (req, res) => {
  try {
    const usuarioId = req.user?.id;

    if (!usuarioId) {
      return res.status(401).json({ message: "Usuario no autenticado" });
    }

    const query = `
      SELECT *
      FROM ingresos
      WHERE usuario = $1
      ORDER BY "fechaVencimiento" DESC NULLS LAST, "createdAt" DESC NULLS LAST;
    `;

    const result = await pool.query(query, [usuarioId]);

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error al obtener los ingresos del usuario:", error);
    return res.status(500).json({
      message: "Error al obtener los ingresos del usuario",
      error: error.message,
    });
  }
};



export const updateIngreso = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const {
            nombre,
            apellido,
            numeroDeDocumento,
            valor,
            cuenta,
            tipo, // Array desde el frontend
            customer_email
        } = req.body;

        // Validar existencia primero
        const checkQuery = `SELECT * FROM "public"."ingresos" WHERE "_id" = $1`;
        const checkResult = await client.query(checkQuery, [id]);

        if (checkResult.rows.length === 0) {
            return res.status(404).json({ message: "Ingreso no encontrado para actualizar" });
        }

        // Procesar array a string
        let productoStr = '';
        if (Array.isArray(tipo)) {
            productoStr = tipo.join(', ');
        } else {
            productoStr = tipo || checkResult.rows[0].producto; // Mantener anterior si no llega
        }

        const updatedAt = new Date().toISOString();

        const updateQuery = `
            UPDATE "public"."ingresos"
            SET 
                "nombre" = $1,
                "apellido" = $2,
                "numeroDeDocumento" = $3,
                "valor" = $4,
                "cuenta" = $5,
                "producto" = $6,
                "customer_email" = $7,
                "updatedAt" = $8
            WHERE "_id" = $9
            RETURNING *;
        `;

        const values = [
            nombre,
            apellido,
            numeroDeDocumento,
            String(valor),
            cuenta,
            productoStr,
            customer_email,
            updatedAt,
            id
        ];

        await client.query('BEGIN');
        const result = await client.query(updateQuery, values);
        await client.query('COMMIT');

        return res.status(200).json({ message: "Ingreso actualizado", data: result.rows[0] });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error actualizando ingreso:", error);
        return res.status(500).json({ message: "Error al actualizar", error: error.message });
    } finally {
        client.release();
    }
};

// ==========================================
// 5. ELIMINAR INGRESO (DELETE)
// ==========================================
export const deleteIngreso = async (req, res) => {
    try {
        const { id } = req.params;
        
        const query = `DELETE FROM "public"."ingresos" WHERE "_id" = $1 RETURNING *`;
        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Ingreso no encontrado para eliminar" });
        }

        return res.status(200).json({ message: "Ingreso eliminado correctamente" });

    } catch (error) {
        console.error("Error eliminando ingreso:", error);
        return res.status(500).json({ message: "Error al eliminar", error: error.message });
    }
};