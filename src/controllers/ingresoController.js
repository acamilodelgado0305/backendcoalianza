// src/controllers/ingresoController.js
import pool from "../database.js";
import { v4 as uuidv4 } from 'uuid';
import { uploadReceiptToGCS } from "../services/gcsPaymentReceipts.js";

// ==========================================
// 1. CREAR INGRESO MANUAL (Privado / Admin)
// ==========================================
export const createIngreso = async (req, res) => {
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
      tipoDocumento,
      tipo_documento,
      tipoDeDocumento
    } = req.body;

    const usuarioId  = req.user?.id;
    const businessId = req.user?.bid;

    if (!usuarioId)  return res.status(401).json({ message: "Usuario no autenticado" });
    if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });
    if (!valor || !cuenta) return res.status(400).json({ message: "Valor y cuenta son obligatorios" });

    const _id = uuidv4();
    const createdAt = new Date();
    const tipoDocumentoFinal = tipoDocumento || tipo_documento || tipoDeDocumento || 'CC';
    const fechaVencimiento = new Date(createdAt);
    fechaVencimiento.setFullYear(fechaVencimiento.getFullYear() + 1);
    const payment_reference = `POS-${Date.now()}`;
    const payment_status = 'APPROVED';
    const productoStr = Array.isArray(tipo) ? tipo.join(', ') : (tipo || 'General');

    const query = `
      INSERT INTO "public"."ingresos" (
        "_id", "nombre", "apellido", "numeroDeDocumento", "tipoDocumento", "fechaVencimiento",
        "producto", "valor", "cuenta", "customer_email", "payment_status",
        "payment_reference", "usuario", "business_id", "createdAt", "updatedAt", "__v"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *;
    `;

    const values = [
      _id,
      nombre || 'Cliente',
      apellido || 'General',
      numeroDeDocumento || '0',
      tipoDocumentoFinal,
      fechaVencimiento.toISOString(),
      productoStr,
      String(valor),
      cuenta,
      customer_email || '',
      payment_status,
      payment_reference,
      usuarioId,
      businessId,
      createdAt.toISOString(),
      createdAt.toISOString(),
      '0'
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

// ==========================================
// 2. CREAR INGRESO PÚBLICO (Landing Page, sin token)
// ==========================================
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
      usuarioId,
      business_id,
      tipoDocumento,
      tipo_documento,
      tipoDeDocumento
    } = req.body;

    // business_id obligatorio; usuarioId se mantiene por compatibilidad
    const businessId = business_id || usuarioId; // fallback para formularios antiguos
    if (!businessId) return res.status(400).json({ message: "Falta business_id" });
    if (!valor || !cuenta) return res.status(400).json({ message: "Valor y cuenta son obligatorios" });

    // Subir comprobante a GCS si viene adjunto
    let comprobante_url = '';
    if (req.file) {
      if (!numeroDeDocumento) {
        return res.status(400).json({ message: "Se requiere numeroDeDocumento para subir el comprobante" });
      }
      comprobante_url = await uploadReceiptToGCS(req.file.buffer, {
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        numeroDocumento: numeroDeDocumento
      });
    }

    const _id = uuidv4();
    const createdAt = new Date();
    const tipoDocumentoFinal = tipoDocumento || tipo_documento || tipoDeDocumento || 'CC';
    const fechaVencimiento = new Date(createdAt);
    fechaVencimiento.setFullYear(fechaVencimiento.getFullYear() + 1);
    const payment_reference = `WEB-${Date.now()}`;
    const productoStr = Array.isArray(tipo) ? tipo.join(', ') : (tipo || 'Certificado Express');

    const query = `
      INSERT INTO "public"."ingresos" (
        "_id", "nombre", "apellido", "numeroDeDocumento", "tipoDocumento", "fechaVencimiento",
        "producto", "valor", "cuenta", "customer_email", "payment_status",
        "payment_reference", "usuario", "business_id", "comprobante_url", "createdAt", "updatedAt", "__v"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *;
    `;

    const values = [
      _id,
      nombre || 'Cliente',
      apellido || '',
      numeroDeDocumento || '0',
      tipoDocumentoFinal,
      fechaVencimiento.toISOString(),
      productoStr,
      String(valor),
      cuenta,
      customer_email || '',
      'VERIFICACION_PENDIENTE',
      payment_reference,
      usuarioId || String(businessId),
      businessId,
      comprobante_url,
      createdAt.toISOString(),
      createdAt.toISOString(),
      '0'
    ];

    await client.query('BEGIN');
    const result = await client.query(query, values);
    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: "Solicitud recibida. En verificación.",
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

// ==========================================
// 3. LISTAR INGRESOS (con filtros y paginación)
// ==========================================
export const getIngresosByUsuario = async (req, res) => {
  try {
    const businessId = req.user?.bid;
    if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

    const {
      fecha_inicio,
      fecha_fin,
      cuenta,
      payment_status,
      page = 1,
      limit = 50
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    const params = [businessId];
    const conditions = [`business_id = $1`];

    if (fecha_inicio) {
      params.push(new Date(fecha_inicio).toISOString());
      conditions.push(`"createdAt" >= $${params.length}`);
    }
    if (fecha_fin) {
      const fin = new Date(fecha_fin);
      fin.setHours(23, 59, 59, 999);
      params.push(fin.toISOString());
      conditions.push(`"createdAt" <= $${params.length}`);
    }
    if (cuenta) {
      params.push(cuenta);
      conditions.push(`"cuenta" = $${params.length}`);
    }
    if (payment_status) {
      params.push(payment_status.toUpperCase());
      conditions.push(`"payment_status" = $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM "public"."ingresos" WHERE ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(Number(limit), offset);
    const dataResult = await pool.query(
      `SELECT * FROM "public"."ingresos"
       WHERE ${where}
       ORDER BY "createdAt" DESC NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return res.status(200).json({
      data: dataResult.rows,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit))
      }
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
      `SELECT * FROM "public"."ingresos" WHERE "_id" = $1 AND business_id = $2`,
      [id, businessId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Ingreso no encontrado" });
    }

    return res.status(200).json(result.rows[0]);

  } catch (error) {
    console.error("Error obteniendo ingreso:", error);
    return res.status(500).json({ message: "Error del servidor", error: error.message });
  }
};

// ==========================================
// 5. ESTADÍSTICAS DE INGRESOS
// ==========================================
export const getIngresoStats = async (req, res) => {
  try {
    const businessId = req.user?.bid;
    if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

    const { fecha_inicio, fecha_fin } = req.query;

    const paramsApproved = [businessId];
    const condApproved = [`business_id = $1`, `payment_status = 'APPROVED'`];

    const paramsAll = [businessId];
    const condAll = [`business_id = $1`];

    if (fecha_inicio) {
      const fi = new Date(fecha_inicio).toISOString();
      paramsApproved.push(fi);
      condApproved.push(`"createdAt" >= $${paramsApproved.length}`);
      paramsAll.push(fi);
      condAll.push(`"createdAt" >= $${paramsAll.length}`);
    }
    if (fecha_fin) {
      const fin = new Date(fecha_fin);
      fin.setHours(23, 59, 59, 999);
      const fiStr = fin.toISOString();
      paramsApproved.push(fiStr);
      condApproved.push(`"createdAt" <= $${paramsApproved.length}`);
      paramsAll.push(fiStr);
      condAll.push(`"createdAt" <= $${paramsAll.length}`);
    }

    const whereApproved = condApproved.join(' AND ');
    const whereAll = condAll.join(' AND ');

    const [resumen, porCuenta, porProducto, porEstado] = await Promise.all([
      pool.query(
        `SELECT
          COUNT(*)::int                         AS total_registros,
          COALESCE(SUM(valor::numeric), 0)      AS total_ingresos,
          COALESCE(AVG(valor::numeric), 0)      AS promedio_ingreso,
          COALESCE(MAX(valor::numeric), 0)      AS ingreso_maximo,
          COALESCE(MIN(valor::numeric), 0)      AS ingreso_minimo
         FROM "public"."ingresos" WHERE ${whereApproved}`,
        paramsApproved
      ),
      pool.query(
        `SELECT
          cuenta,
          COUNT(*)::int                         AS cantidad,
          COALESCE(SUM(valor::numeric), 0)      AS total
         FROM "public"."ingresos"
         WHERE ${whereApproved}
         GROUP BY cuenta
         ORDER BY total DESC`,
        paramsApproved
      ),
      pool.query(
        `SELECT
          producto,
          COUNT(*)::int                         AS cantidad,
          COALESCE(SUM(valor::numeric), 0)      AS total
         FROM "public"."ingresos"
         WHERE ${whereApproved}
         GROUP BY producto
         ORDER BY total DESC
         LIMIT 10`,
        paramsApproved
      ),
      pool.query(
        `SELECT
          payment_status,
          COUNT(*)::int                         AS cantidad,
          COALESCE(SUM(valor::numeric), 0)      AS total
         FROM "public"."ingresos"
         WHERE ${whereAll}
         GROUP BY payment_status`,
        paramsAll
      ),
    ]);

    return res.status(200).json({
      resumen: resumen.rows[0],
      por_cuenta: porCuenta.rows,
      por_producto: porProducto.rows,
      por_estado: porEstado.rows,
    });

  } catch (error) {
    console.error("Error en getIngresoStats:", error);
    return res.status(500).json({ message: "Error al obtener estadísticas", error: error.message });
  }
};

// ==========================================
// 6. VERIFICAR INGRESO (PENDIENTE → APPROVED / RECHAZADO)
// ==========================================
export const verificarIngreso = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { payment_status } = req.body;
    const businessId = req.user?.bid;

    const estadosValidos = ['APPROVED', 'RECHAZADO'];
    if (!estadosValidos.includes(payment_status)) {
      return res.status(400).json({
        message: `Estado inválido. Valores permitidos: ${estadosValidos.join(' | ')}`
      });
    }

    const checkResult = await client.query(
      `SELECT * FROM "public"."ingresos" WHERE "_id" = $1 AND business_id = $2`,
      [id, businessId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: "Ingreso no encontrado" });
    }

    const ingreso = checkResult.rows[0];

    if (ingreso.payment_status !== 'VERIFICACION_PENDIENTE') {
      return res.status(409).json({
        message: `Solo se pueden verificar ingresos en VERIFICACION_PENDIENTE. Estado actual: ${ingreso.payment_status}`
      });
    }

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE "public"."ingresos"
       SET "payment_status" = $1, "updatedAt" = $2
       WHERE "_id" = $3
       RETURNING *`,
      [payment_status, new Date().toISOString(), id]
    );
    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: `Ingreso ${payment_status === 'APPROVED' ? 'aprobado' : 'rechazado'} correctamente`,
      data: result.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error en verificarIngreso:", error);
    return res.status(500).json({ message: "Error al verificar ingreso", error: error.message });
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
      nombre,
      apellido,
      numeroDeDocumento,
      valor,
      cuenta,
      tipo,
      customer_email,
      tipoDocumento,
      tipo_documento,
      tipoDeDocumento
    } = req.body;

    const checkResult = await client.query(
      `SELECT * FROM "public"."ingresos" WHERE "_id" = $1 AND business_id = $2`,
      [id, businessId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: "Ingreso no encontrado" });
    }

    const prev = checkResult.rows[0];
    const productoStr = Array.isArray(tipo) ? tipo.join(', ') : (tipo || prev.producto);
    const tipoDocumentoFinal =
      tipoDocumento || tipo_documento || tipoDeDocumento || prev.tipoDocumento || 'CC';

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE "public"."ingresos"
       SET
         "nombre"            = $1,
         "apellido"          = $2,
         "numeroDeDocumento" = $3,
         "tipoDocumento"     = $4,
         "valor"             = $5,
         "cuenta"            = $6,
         "producto"          = $7,
         "customer_email"    = $8,
         "updatedAt"         = $9
       WHERE "_id" = $10
       RETURNING *`,
      [
        nombre           ?? prev.nombre,
        apellido         ?? prev.apellido,
        numeroDeDocumento ?? prev.numeroDeDocumento,
        tipoDocumentoFinal,
        valor !== undefined ? String(valor) : prev.valor,
        cuenta           ?? prev.cuenta,
        productoStr,
        customer_email   ?? prev.customer_email,
        new Date().toISOString(),
        id
      ]
    );
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
// 8. ELIMINAR INGRESO
// ==========================================
export const deleteIngreso = async (req, res) => {
  try {
    const { id } = req.params;
    const businessId = req.user?.bid;

    const result = await pool.query(
      `DELETE FROM "public"."ingresos" WHERE "_id" = $1 AND business_id = $2 RETURNING *`,
      [id, businessId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Ingreso no encontrado" });
    }

    return res.status(200).json({ message: "Ingreso eliminado correctamente" });

  } catch (error) {
    console.error("Error eliminando ingreso:", error);
    return res.status(500).json({ message: "Error al eliminar", error: error.message });
  }
};
