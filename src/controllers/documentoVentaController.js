import prisma from '../prisma.js';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

// ─── Generador de número secuencial por negocio ───────────────────────────────
const generarNumero = async (tx, tipo, businessId) => {
    const prefix = tipo === 'FACTURA' ? 'FAC' : 'COT';
    const year   = new Date().getFullYear();
    const count  = await tx.documentos_venta.count({
        where: {
            tipo,
            business_id: businessId,
            created_at: {
                gte: new Date(`${year}-01-01T00:00:00Z`),
                lt:  new Date(`${year + 1}-01-01T00:00:00Z`),
            },
        },
    });
    return `${prefix}-${year}-${String(count + 1).padStart(4, '0')}`;
};

// ─── 1. CREAR ─────────────────────────────────────────────────────────────────
export const createDocumentoVenta = async (req, res) => {
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

        const doc = await prisma.$transaction(async (tx) => {
            const numero = await generarNumero(tx, tipo, businessId);
            const estado = tipo === 'COTIZACION' ? 'BORRADOR' : 'EMITIDA';

            return tx.documentos_venta.create({
                data: {
                    tipo,
                    numero,
                    business_id:           businessId,
                    usuario_id:            usuarioId,
                    persona_id:            persona_id || null,
                    cliente_nombre:        cliente_nombre        || null,
                    cliente_identificacion: cliente_identificacion || null,
                    cliente_email:         cliente_email         || null,
                    cliente_telefono:      cliente_telefono      || null,
                    cliente_direccion:     cliente_direccion     || null,
                    items:                 items,
                    subtotal,
                    descuento_global,
                    impuesto_total,
                    total,
                    notas:                 notas       || null,
                    condiciones:           condiciones || null,
                    estado,
                    fecha_emision:         fecha_emision
                        ? new Date(fecha_emision)
                        : new Date(),
                    fecha_vencimiento:     fecha_vencimiento ? new Date(fecha_vencimiento) : null,
                    origen_cotizacion_id:  origen_cotizacion_id || null,
                },
            });
        });

        return res.status(201).json(doc);
    } catch (err) {
        console.error('createDocumentoVenta:', err);
        return res.status(500).json({ message: 'Error al crear documento', error: err.message });
    }
};

// ─── 2. LISTAR ────────────────────────────────────────────────────────────────
export const getDocumentosVenta = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

        const { tipo, estado, q } = req.query;

        // LEFT JOIN con personas para búsqueda por nombre del contacto requiere $queryRaw
        const conditions = [Prisma.sql`dv.business_id = ${businessId}`];
        if (tipo)   conditions.push(Prisma.sql`dv.tipo   = ${tipo}`);
        if (estado) conditions.push(Prisma.sql`dv.estado = ${estado}`);
        if (q) {
            const like = `%${q}%`;
            conditions.push(Prisma.sql`(dv.numero ILIKE ${like} OR dv.cliente_nombre ILIKE ${like} OR p.nombre ILIKE ${like})`);
        }

        const whereClause = Prisma.join(conditions, ' AND ');

        const rows = await prisma.$queryRaw(Prisma.sql`
            SELECT dv.*,
                   p.nombre  AS persona_nombre,
                   p.celular AS persona_celular
            FROM documentos_venta dv
            LEFT JOIN personas p ON dv.persona_id = p.id
            WHERE ${whereClause}
            ORDER BY dv.created_at DESC
        `);

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

        const [row] = await prisma.$queryRaw(Prisma.sql`
            SELECT dv.*,
                   p.nombre  AS persona_nombre,
                   p.celular AS persona_celular,
                   p.email   AS persona_email
            FROM documentos_venta dv
            LEFT JOIN personas p ON dv.persona_id = p.id
            WHERE dv.id = ${Number(id)} AND dv.business_id = ${businessId}
        `);

        if (!row) return res.status(404).json({ message: 'Documento no encontrado' });
        return res.status(200).json(row);
    } catch (err) {
        console.error('getDocumentoVentaById:', err);
        return res.status(500).json({ message: 'Error al obtener documento' });
    }
};

// ─── 4. ACTUALIZAR ────────────────────────────────────────────────────────────
export const updateDocumentoVenta = async (req, res) => {
    try {
        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;
        const { id }     = req.params;
        const { cuenta, ...bodyRest } = req.body;

        const allowed = [
            'persona_id', 'cliente_nombre', 'cliente_identificacion',
            'cliente_email', 'cliente_telefono', 'cliente_direccion',
            'items', 'subtotal', 'descuento_global', 'impuesto_total', 'total',
            'notas', 'condiciones', 'estado',
            'fecha_emision', 'fecha_vencimiento', 'fecha_pago',
        ];
        const dateFields = new Set(['fecha_emision', 'fecha_vencimiento', 'fecha_pago']);

        const updateData = {};
        for (const key of allowed) {
            if (bodyRest[key] !== undefined) {
                updateData[key] = dateFields.has(key) && bodyRest[key]
                    ? new Date(bodyRest[key])
                    : bodyRest[key];
            }
        }

        if (!Object.keys(updateData).length) {
            return res.status(400).json({ message: 'Sin campos para actualizar' });
        }

        const doc = await prisma.$transaction(async (tx) => {
            const prevDoc = await tx.documentos_venta.findFirst({
                where: { id: Number(id), business_id: businessId },
                select: {
                    tipo: true, estado: true, numero: true, total: true,
                    persona_id: true, cliente_nombre: true,
                    cliente_identificacion: true, cliente_email: true, items: true,
                },
            });
            if (!prevDoc) throw Object.assign(new Error('Documento no encontrado'), { status: 404 });

            const updated = await tx.documentos_venta.update({
                where: { id: Number(id) },
                data:  { ...updateData, updated_at: new Date() },
            });

            // Auto-crear ingreso cuando FACTURA → PAGADA
            const nuevoEstado = bodyRest.estado;
            if (nuevoEstado === 'PAGADA' && prevDoc.tipo === 'FACTURA' && prevDoc.estado !== 'PAGADA') {
                const ingresoId    = uuidv4();
                const now          = new Date();
                const vencimiento  = new Date(now);
                vencimiento.setFullYear(vencimiento.getFullYear() + 1);

                const clienteNombre = prevDoc.cliente_nombre || 'Cliente';
                const descripcion   = `Factura ${prevDoc.numero} - ${clienteNombre}`;
                const cuentaFinal   = cuenta || 'Otra';
                const totalVal      = Number(prevDoc.total || 0);

                await tx.$executeRaw(Prisma.sql`
                    INSERT INTO "public"."ingresos" (
                        "_id","nombre","apellido","numeroDeDocumento","tipoDocumento","fechaVencimiento",
                        "producto","descripcion","valor","cuenta","customer_email","payment_status",
                        "payment_reference","usuario","business_id","createdAt","updatedAt","__v","persona_id"
                    ) VALUES (
                        ${ingresoId},
                        ${clienteNombre}, ${''},
                        ${prevDoc.cliente_identificacion || '0'},
                        ${'NIT'},
                        ${vencimiento},
                        ${descripcion}, ${descripcion},
                        ${totalVal}, ${cuentaFinal},
                        ${prevDoc.cliente_email || ''},
                        ${'APPROVED'},
                        ${'FAC-' + prevDoc.numero + '-' + Date.now()},
                        ${usuarioId}, ${businessId},
                        ${now}, ${now}, ${'0'},
                        ${prevDoc.persona_id || null}
                    )
                `);

                const items = Array.isArray(prevDoc.items)
                    ? prevDoc.items
                    : (typeof prevDoc.items === 'string' ? JSON.parse(prevDoc.items) : []);

                for (const item of items) {
                    await tx.ingreso_items.create({
                        data: {
                            ingreso_id:      ingresoId,
                            inventario_id:   item.inventario_id || null,
                            descripcion:     item.descripcion   || 'Servicio',
                            cantidad:        Number(item.cantidad)        || 1,
                            precio_unitario: Number(item.precio_unitario) || 0,
                        },
                    });
                }
            }

            return updated;
        });

        return res.status(200).json(doc);
    } catch (err) {
        console.error('updateDocumentoVenta:', err);
        const status = err.status || 500;
        return res.status(status).json({ message: err.message || 'Error al actualizar documento' });
    }
};

// ─── 5. ELIMINAR ──────────────────────────────────────────────────────────────
export const deleteDocumentoVenta = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        const { id } = req.params;

        const doc = await prisma.documentos_venta.findFirst({
            where: { id: Number(id), business_id: businessId },
            select: { id: true },
        });
        if (!doc) return res.status(404).json({ message: 'Documento no encontrado' });

        await prisma.documentos_venta.delete({ where: { id: Number(id) } });

        return res.status(200).json({ message: 'Documento eliminado', id: Number(id) });
    } catch (err) {
        console.error('deleteDocumentoVenta:', err);
        return res.status(500).json({ message: 'Error al eliminar documento' });
    }
};

// ─── 6. CONVERTIR COTIZACIÓN → FACTURA ───────────────────────────────────────
export const convertirCotizacionAFactura = async (req, res) => {
    try {
        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;
        const { id } = req.params;

        const factura = await prisma.$transaction(async (tx) => {
            const cot = await tx.documentos_venta.findFirst({
                where: { id: Number(id), business_id: businessId },
            });
            if (!cot) throw Object.assign(new Error('Cotización no encontrada'), { status: 404 });
            if (cot.tipo !== 'COTIZACION') throw Object.assign(new Error('El documento no es una cotización'), { status: 400 });

            await tx.documentos_venta.update({
                where: { id: Number(id) },
                data:  { estado: 'ACEPTADA', updated_at: new Date() },
            });

            const numero = await generarNumero(tx, 'FACTURA', businessId);

            return tx.documentos_venta.create({
                data: {
                    tipo:                  'FACTURA',
                    numero,
                    business_id:           businessId,
                    usuario_id:            usuarioId,
                    persona_id:            cot.persona_id,
                    cliente_nombre:        cot.cliente_nombre,
                    cliente_identificacion: cot.cliente_identificacion,
                    cliente_email:         cot.cliente_email,
                    cliente_telefono:      cot.cliente_telefono,
                    cliente_direccion:     cot.cliente_direccion,
                    items:                 cot.items,
                    subtotal:              cot.subtotal,
                    descuento_global:      cot.descuento_global,
                    impuesto_total:        cot.impuesto_total,
                    total:                 cot.total,
                    notas:                 cot.notas,
                    condiciones:           cot.condiciones,
                    estado:                'EMITIDA',
                    fecha_emision:         new Date(),
                    fecha_vencimiento:     cot.fecha_vencimiento,
                    origen_cotizacion_id:  Number(id),
                },
            });
        });

        return res.status(201).json(factura);
    } catch (err) {
        console.error('convertirCotizacionAFactura:', err);
        const status = err.status || 500;
        return res.status(status).json({ message: err.message || 'Error al convertir cotización' });
    }
};

// ─── 7. REGISTRAR ABONO ───────────────────────────────────────────────────────
export const registrarAbono = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        const usuarioId  = req.user?.id;
        const { id }     = req.params;
        const { monto, cuenta = 'Efectivo', nota } = req.body;

        const montoNum = Number(monto);
        if (!montoNum || montoNum <= 0) {
            return res.status(400).json({ message: 'El monto del abono debe ser mayor a 0' });
        }

        const doc = await prisma.$transaction(async (tx) => {
            const prevDoc = await tx.documentos_venta.findFirst({
                where: { id: Number(id), business_id: businessId },
            });
            if (!prevDoc) throw Object.assign(new Error('Documento no encontrado'), { status: 404 });
            if (prevDoc.tipo !== 'FACTURA') throw Object.assign(new Error('Solo se pueden abonar facturas'), { status: 400 });
            if (prevDoc.estado === 'ANULADA') throw Object.assign(new Error('La factura está anulada'), { status: 400 });
            if (prevDoc.estado === 'PAGADA')  throw Object.assign(new Error('La factura ya está pagada'), { status: 400 });

            const abonosAnt = Array.isArray(prevDoc.abonos)
                ? prevDoc.abonos
                : (typeof prevDoc.abonos === 'string' ? JSON.parse(prevDoc.abonos || '[]') : []);

            const nuevoAbono = { id: uuidv4(), fecha: new Date().toISOString(), monto: montoNum, cuenta, nota: nota || null };
            const abonosNuevos  = [...abonosAnt, nuevoAbono];
            const totalAbonado  = abonosNuevos.reduce((s, a) => s + Number(a.monto), 0);
            const totalFactura  = Number(prevDoc.total);
            const pagadoFull    = totalAbonado >= totalFactura;

            // Usar $executeRaw para no depender del cliente Prisma generado
            if (pagadoFull) {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE documentos_venta SET
                        abonos        = ${JSON.stringify(abonosNuevos)}::jsonb,
                        total_abonado = ${totalAbonado},
                        estado        = 'PAGADA',
                        fecha_pago    = NOW(),
                        updated_at    = NOW()
                    WHERE id = ${Number(id)}
                `);
            } else {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE documentos_venta SET
                        abonos        = ${JSON.stringify(abonosNuevos)}::jsonb,
                        total_abonado = ${totalAbonado},
                        estado        = 'ABONO',
                        updated_at    = NOW()
                    WHERE id = ${Number(id)}
                `);
            }
            const [updated] = await tx.$queryRaw(Prisma.sql`
                SELECT * FROM documentos_venta WHERE id = ${Number(id)}
            `);

            // Ingreso por el abono
            const ingresoId    = uuidv4();
            const now          = new Date();
            const vencimiento  = new Date(now);
            vencimiento.setFullYear(vencimiento.getFullYear() + 1);
            const clienteNombre = prevDoc.cliente_nombre || 'Cliente';
            const descripcion   = `Abono Factura ${prevDoc.numero} - ${clienteNombre}`;

            await tx.$executeRaw(Prisma.sql`
                INSERT INTO "public"."ingresos" (
                    "_id","nombre","apellido","numeroDeDocumento","tipoDocumento","fechaVencimiento",
                    "producto","descripcion","valor","cuenta","customer_email","payment_status",
                    "payment_reference","usuario","business_id","createdAt","updatedAt","__v","persona_id"
                ) VALUES (
                    ${ingresoId},
                    ${clienteNombre}, ${''},
                    ${prevDoc.cliente_identificacion || '0'}, ${'NIT'},
                    ${vencimiento},
                    ${descripcion}, ${descripcion},
                    ${montoNum}, ${cuenta},
                    ${prevDoc.cliente_email || ''},
                    ${'APPROVED'},
                    ${'ABONO-' + prevDoc.numero + '-' + Date.now()},
                    ${usuarioId}, ${businessId},
                    ${now}, ${now}, ${'0'},
                    ${prevDoc.persona_id || null}
                )
            `);

            return updated;
        });

        return res.status(200).json(doc);
    } catch (err) {
        console.error('registrarAbono:', err);
        const status = err.status || 500;
        return res.status(status).json({ message: err.message || 'Error al registrar abono' });
    }
};

// ─── 8. ESTADÍSTICAS ──────────────────────────────────────────────────────────
export const getEstadisticasDocumentos = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

        const rows = await prisma.$queryRaw(Prisma.sql`
            SELECT
                tipo,
                estado,
                COUNT(*)::int            AS cantidad,
                COALESCE(SUM(total), 0)  AS total_suma
            FROM documentos_venta
            WHERE business_id = ${businessId}
            GROUP BY tipo, estado
            ORDER BY tipo, estado
        `);

        return res.status(200).json(rows);
    } catch (err) {
        console.error('getEstadisticasDocumentos:', err);
        return res.status(500).json({ message: 'Error al obtener estadísticas' });
    }
};
