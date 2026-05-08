import pool from "../database.js";
import { v4 as uuidv4 } from "uuid";

// ─── Generador de número secuencial por negocio ───────────────────────────────
const generarNumero = async (client, tipo, businessId) => {
  const prefix = tipo === 'FACTURA' ? 'FAC' : 'COT';
  const year = new Date().getFullYear();
  const { rows } = await client.query(
    `SELECT COUNT(*) FROM documentos_venta
     WHERE tipo = $1 AND business_id = $2 AND EXTRACT(YEAR FROM created_at) = $3`,
    [tipo, businessId, year]
  );
  const seq = parseInt(rows[0].count) + 1;
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
};

// ─── 1. CREAR ─────────────────────────────────────────────────────────────────
export const createDocumentoVenta = async (req, res) => {
  const client = await pool.connect();
  try {
    const usuarioId  = req.user?.id;
    const businessId = req.user?.bid;

    if (!usuarioId)  return res.status(401).json({ message: "Usuario no autenticado" });
    if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

    const {
      tipo = 'COTIZACION',
      persona_id,
      cliente_nombre, cliente_identificacion,
      cliente_email, cliente_telefono, cliente_direccion,
      items = [],
      subtotal = 0, descuento_global = 0, impuesto_total = 0, total = 0,
      notas, condiciones,
      fecha_emision, fecha_vencimiento,
      origen_cotizacion_id,
    } = req.body;

    if (!['FACTURA', 'COTIZACION'].includes(tipo)) {
      return res.status(400).json({ message: 'Tipo inválido. Use FACTURA o COTIZACION.' });
    }

    await client.query('BEGIN');

    const numero = await generarNumero(client, tipo, businessId);
    const estado = tipo === 'COTIZACION' ? 'BORRADOR' : 'EMITIDA';

    const { rows } = await client.query(
      `INSERT INTO documentos_venta
        (tipo, numero, business_id, usuario_id, persona_id,
         cliente_nombre, cliente_identificacion, cliente_email, cliente_telefono, cliente_direccion,
         items, subtotal, descuento_global, impuesto_total, total,
         notas, condiciones, estado,
         fecha_emision, fecha_vencimiento, origen_cotizacion_id)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING *`,
      [
        tipo, numero, businessId, usuarioId, persona_id || null,
        cliente_nombre || null, cliente_identificacion || null,
        cliente_email || null, cliente_telefono || null, cliente_direccion || null,
        JSON.stringify(items),
        subtotal, descuento_global, impuesto_total, total,
        notas || null, condiciones || null, estado,
        fecha_emision || new Date().toISOString().split('T')[0],
        fecha_vencimiento || null,
        origen_cotizacion_id || null,
      ]
    );

    await client.query('COMMIT');
    return res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('createDocumentoVenta:', err);
    return res.status(500).json({ message: 'Error al crear documento', error: err.message });
  } finally {
    client.release();
  }
};

// ─── 2. LISTAR ────────────────────────────────────────────────────────────────
export const getDocumentosVenta = async (req, res) => {
  try {
    const businessId = req.user?.bid;
    if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

    const { tipo, estado, q } = req.query;
    const values = [businessId];
    let idx = 2;

    let sql = `
      SELECT dv.*,
             p.nombre  AS persona_nombre,
             p.celular AS persona_celular
      FROM documentos_venta dv
      LEFT JOIN personas p ON dv.persona_id = p.id
      WHERE dv.business_id = $1
    `;

    if (tipo)   { sql += ` AND dv.tipo = $${idx++}`;   values.push(tipo); }
    if (estado) { sql += ` AND dv.estado = $${idx++}`; values.push(estado); }
    if (q) {
      sql += ` AND (dv.numero ILIKE $${idx} OR dv.cliente_nombre ILIKE $${idx} OR p.nombre ILIKE $${idx})`;
      values.push(`%${q}%`);
      idx++;
    }

    sql += ` ORDER BY dv.created_at DESC`;

    const { rows } = await pool.query(sql, values);
    return res.status(200).json(rows);
  } catch (err) {
    console.error('getDocumentosVenta:', err);
    return res.status(500).json({ message: 'Error al obtener documentos' });
  }
};

// ─── 3. OBTENER UNO ───────────────────────────────────────────────────────────
export const getDocumentoVentaById = async (req, res) => {
  try {
    const businessId = req.user?.bid;
    const { id } = req.params;

    const { rows } = await pool.query(
      `SELECT dv.*,
              p.nombre AS persona_nombre, p.celular AS persona_celular, p.email AS persona_email
       FROM documentos_venta dv
       LEFT JOIN personas p ON dv.persona_id = p.id
       WHERE dv.id = $1 AND dv.business_id = $2`,
      [id, businessId]
    );

    if (!rows[0]) return res.status(404).json({ message: 'Documento no encontrado' });
    return res.status(200).json(rows[0]);
  } catch (err) {
    console.error('getDocumentoVentaById:', err);
    return res.status(500).json({ message: 'Error al obtener documento' });
  }
};

// ─── 4. ACTUALIZAR ────────────────────────────────────────────────────────────
export const updateDocumentoVenta = async (req, res) => {
  const client = await pool.connect();
  try {
    const usuarioId  = req.user?.id;
    const businessId = req.user?.bid;
    const { id }     = req.params;
    const { cuenta, ...bodyRest } = req.body; // cuenta solo para ingreso, no va al doc

    const allowed = [
      'persona_id', 'cliente_nombre', 'cliente_identificacion',
      'cliente_email', 'cliente_telefono', 'cliente_direccion',
      'items', 'subtotal', 'descuento_global', 'impuesto_total', 'total',
      'notas', 'condiciones', 'estado',
      'fecha_emision', 'fecha_vencimiento', 'fecha_pago',
    ];

    const setClauses = [];
    const values = [];
    let idx = 1;

    for (const key of allowed) {
      if (bodyRest[key] !== undefined) {
        setClauses.push(`${key} = $${idx++}`);
        values.push(key === 'items' ? JSON.stringify(bodyRest[key]) : bodyRest[key]);
      }
    }

    if (!setClauses.length) return res.status(400).json({ message: 'Sin campos para actualizar' });

    await client.query('BEGIN');

    // Obtener doc actual antes de actualizar (necesitamos tipo y estado anterior)
    const { rows: prevRows } = await client.query(
      `SELECT tipo, estado, numero, total, persona_id,
              cliente_nombre, cliente_identificacion, cliente_email, items
       FROM documentos_venta WHERE id = $1 AND business_id = $2`,
      [id, businessId]
    );
    const prevDoc = prevRows[0];
    if (!prevDoc) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Documento no encontrado' });
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id, businessId);

    const { rows } = await client.query(
      `UPDATE documentos_venta SET ${setClauses.join(', ')}
       WHERE id = $${idx++} AND business_id = $${idx} RETURNING *`,
      values
    );

    // Auto-crear ingreso cuando FACTURA → PAGADA
    const nuevoEstado = bodyRest.estado;
    if (
      nuevoEstado === 'PAGADA' &&
      prevDoc.tipo  === 'FACTURA' &&
      prevDoc.estado !== 'PAGADA'
    ) {
      const ingresoId  = uuidv4();
      const now        = new Date();
      const vencimiento = new Date(now);
      vencimiento.setFullYear(vencimiento.getFullYear() + 1);

      const clienteNombre = prevDoc.cliente_nombre || 'Cliente';
      const descripcion   = `Factura ${prevDoc.numero} - ${clienteNombre}`;
      const cuentaFinal   = cuenta || 'Otra';
      const totalVal      = String(prevDoc.total || 0);

      await client.query(
        `INSERT INTO "public"."ingresos" (
           "_id", "nombre", "apellido", "numeroDeDocumento", "tipoDocumento", "fechaVencimiento",
           "producto", "descripcion", "valor", "cuenta", "customer_email", "payment_status",
           "payment_reference", "usuario", "business_id", "createdAt", "updatedAt", "__v", "persona_id"
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          ingresoId,
          clienteNombre, '',
          prevDoc.cliente_identificacion || '0',
          'NIT',
          vencimiento.toISOString(),
          descripcion, descripcion,
          totalVal, cuentaFinal,
          prevDoc.cliente_email || '',
          'APPROVED',
          `FAC-${prevDoc.numero}-${Date.now()}`,
          usuarioId, businessId,
          now.toISOString(), now.toISOString(), '0',
          prevDoc.persona_id || null,
        ]
      );

      // Insertar ingreso_items desde los ítems de la factura
      const items = Array.isArray(prevDoc.items)
        ? prevDoc.items
        : (typeof prevDoc.items === 'string' ? JSON.parse(prevDoc.items) : []);

      for (const item of items) {
        await client.query(
          `INSERT INTO ingreso_items (ingreso_id, inventario_id, descripcion, cantidad, precio_unitario)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            ingresoId,
            item.inventario_id || null,
            item.descripcion   || 'Servicio',
            Number(item.cantidad)        || 1,
            Number(item.precio_unitario) || 0,
          ]
        );
      }
    }

    await client.query('COMMIT');
    if (!rows[0]) return res.status(404).json({ message: 'Documento no encontrado' });
    return res.status(200).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('updateDocumentoVenta:', err);
    return res.status(500).json({ message: 'Error al actualizar documento' });
  } finally {
    client.release();
  }
};

// ─── 5. ELIMINAR ──────────────────────────────────────────────────────────────
export const deleteDocumentoVenta = async (req, res) => {
  try {
    const businessId = req.user?.bid;
    const { id } = req.params;

    const { rows } = await pool.query(
      `DELETE FROM documentos_venta WHERE id = $1 AND business_id = $2 RETURNING id`,
      [id, businessId]
    );

    if (!rows[0]) return res.status(404).json({ message: 'Documento no encontrado' });
    return res.status(200).json({ message: 'Documento eliminado', id: rows[0].id });
  } catch (err) {
    console.error('deleteDocumentoVenta:', err);
    return res.status(500).json({ message: 'Error al eliminar documento' });
  }
};

// ─── 6. CONVERTIR COTIZACIÓN → FACTURA ───────────────────────────────────────
export const convertirCotizacionAFactura = async (req, res) => {
  const client = await pool.connect();
  try {
    const usuarioId  = req.user?.id;
    const businessId = req.user?.bid;
    const { id } = req.params;

    await client.query('BEGIN');

    const { rows: cotRows } = await client.query(
      `SELECT * FROM documentos_venta WHERE id = $1 AND business_id = $2`,
      [id, businessId]
    );

    const cot = cotRows[0];
    if (!cot) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Cotización no encontrada' });
    }
    if (cot.tipo !== 'COTIZACION') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'El documento no es una cotización' });
    }

    // Marcar cotización como ACEPTADA
    await client.query(
      `UPDATE documentos_venta SET estado = 'ACEPTADA', updated_at = NOW() WHERE id = $1`,
      [id]
    );

    const numero = await generarNumero(client, 'FACTURA', businessId);

    const { rows: facRows } = await client.query(
      `INSERT INTO documentos_venta
        (tipo, numero, business_id, usuario_id, persona_id,
         cliente_nombre, cliente_identificacion, cliente_email, cliente_telefono, cliente_direccion,
         items, subtotal, descuento_global, impuesto_total, total,
         notas, condiciones, estado, fecha_emision, fecha_vencimiento, origen_cotizacion_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING *`,
      [
        'FACTURA', numero, businessId, usuarioId, cot.persona_id,
        cot.cliente_nombre, cot.cliente_identificacion, cot.cliente_email,
        cot.cliente_telefono, cot.cliente_direccion,
        cot.items,
        cot.subtotal, cot.descuento_global, cot.impuesto_total, cot.total,
        cot.notas, cot.condiciones, 'EMITIDA',
        new Date().toISOString().split('T')[0],
        cot.fecha_vencimiento, id,
      ]
    );

    await client.query('COMMIT');
    return res.status(201).json(facRows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('convertirCotizacionAFactura:', err);
    return res.status(500).json({ message: 'Error al convertir cotización' });
  } finally {
    client.release();
  }
};

// ─── 7. ESTADÍSTICAS ──────────────────────────────────────────────────────────
export const getEstadisticasDocumentos = async (req, res) => {
  try {
    const businessId = req.user?.bid;
    if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

    const { rows } = await pool.query(
      `SELECT
         tipo,
         estado,
         COUNT(*)::int            AS cantidad,
         COALESCE(SUM(total), 0)  AS total_suma
       FROM documentos_venta
       WHERE business_id = $1
       GROUP BY tipo, estado
       ORDER BY tipo, estado`,
      [businessId]
    );

    return res.status(200).json(rows);
  } catch (err) {
    console.error('getEstadisticasDocumentos:', err);
    return res.status(500).json({ message: 'Error al obtener estadísticas' });
  }
};
