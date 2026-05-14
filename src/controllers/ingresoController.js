import prisma from '../prisma.js';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { uploadReceiptToGCS } from '../services/gcsPaymentReceipts.js';

// ==========================================
// 1. CREAR INGRESO (Privado / Admin)
// ==========================================
export const createIngreso = async (req, res) => {
    try {
        const {
            persona_id, items, descripcion, valor, cuenta,
            customer_email,
            nombre, apellido, numeroDeDocumento,
            tipoDocumento, tipo_documento, tipoDeDocumento,
            tipo,
        } = req.body;

        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;

        if (!usuarioId)  return res.status(401).json({ message: "Usuario no autenticado" });
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });
        if (!cuenta)     return res.status(400).json({ message: "La cuenta de destino es obligatoria" });

        let personaData = null;
        if (persona_id) {
            personaData = await prisma.personas.findFirst({
                where: { id: persona_id, business_id: businessId },
            });
        }

        const parsedItems = Array.isArray(items) ? items : [];

        if (parsedItems.length === 0 && tipo) {
            const tipoArr = Array.isArray(tipo) ? tipo : [tipo];
            for (const nombreProd of tipoArr) {
                const inv = await prisma.inventario.findFirst({
                    where:  { nombre: nombreProd, business_id: businessId },
                    select: { id: true, monto: true },
                });
                parsedItems.push({
                    inventario_id:   inv?.id || null,
                    descripcion:     nombreProd,
                    cantidad:        1,
                    precio_unitario: inv ? Number(inv.monto) : 0,
                });
            }
        }

        let totalValor = Number(valor) || 0;
        if (!totalValor && parsedItems.length > 0) {
            totalValor = parsedItems.reduce(
                (sum, i) => sum + Number(i.precio_unitario || 0) * Number(i.cantidad || 1), 0
            );
        }
        if (!totalValor) return res.status(400).json({ message: "El valor total es obligatorio" });

        const nombreFinal   = personaData?.nombre           || nombre    || 'Cliente';
        const apellidoFinal = personaData?.apellido         || apellido  || 'General';
        const docFinal      = personaData?.numero_documento || numeroDeDocumento || '0';
        const tipoDocFinal  = personaData?.tipo_documento   || tipoDocumento || tipo_documento || tipoDeDocumento || 'CC';
        const emailFinal    = personaData?.email            || customer_email || '';
        const descripcionFinal = descripcion || (Array.isArray(tipo) ? tipo.join(', ') : tipo) || 'Venta';

        const legacyId         = uuidv4();
        const createdAt        = new Date();
        const fechaVencimiento = new Date(createdAt);
        fechaVencimiento.setFullYear(fechaVencimiento.getFullYear() + 1);

        const ingreso = await prisma.$transaction(async (tx) => {
            const created = await tx.ingresos.create({
                data: {
                    legacyId,
                    nombre:           nombreFinal,
                    apellido:         apellidoFinal,
                    numeroDeDocumento: docFinal,
                    tipoDocumento:    tipoDocFinal,
                    fechaVencimiento,
                    producto:         descripcionFinal,
                    descripcion:      descripcionFinal,
                    valor:            totalValor,
                    cuenta,
                    customer_email:   emailFinal,
                    payment_status:   'APPROVED',
                    payment_reference: `POS-${Date.now()}`,
                    usuario:          usuarioId,
                    business_id:      businessId,
                    createdAt,
                    updatedAt:        createdAt,
                    v:                '0',
                    ...(persona_id && {
                        personas: { connect: { id: persona_id } },
                    }),
                },
            });

            if (parsedItems.length > 0) {
                const nombresProducto = [];
                for (const item of parsedItems) {
                    let prodNombre = item.descripcion || null;
                    if (item.inventario_id) {
                        const inv = await tx.inventario.findFirst({
                            where:  { id: item.inventario_id, business_id: businessId },
                            select: { nombre: true },
                        });
                        prodNombre = inv?.nombre || prodNombre || 'Producto';
                    }
                    nombresProducto.push(prodNombre);
                    await tx.ingreso_items.create({
                        data: {
                            ingreso_id:      legacyId,
                            inventario_id:   item.inventario_id || null,
                            descripcion:     prodNombre,
                            cantidad:        Number(item.cantidad) || 1,
                            precio_unitario: Number(item.precio_unitario) || 0,
                        },
                    });
                }
                const productoFinal = nombresProducto.filter(Boolean).join(', ') || descripcionFinal;
                await tx.ingresos.update({
                    where: { id: created.id },
                    data:  { producto: productoFinal, descripcion: productoFinal },
                });
            }

            return created;
        });

        return res.status(201).json({
            success: true,
            message: "Ingreso registrado exitosamente",
            data: { _id: legacyId, id: ingreso.id, total: totalValor },
        });
    } catch (error) {
        console.error("Error al crear ingreso:", error);
        return res.status(500).json({ message: "Error interno al crear el ingreso", error: error.message });
    }
};

// ==========================================
// 2. CREAR INGRESO PÚBLICO (Landing Page)
// ==========================================
export const createIngresoPublico = async (req, res) => {
    try {
        const {
            nombre, apellido, numeroDeDocumento, valor, cuenta,
            tipo, customer_email, usuarioId, business_id,
            tipoDocumento, tipo_documento, tipoDeDocumento,
        } = req.body;

        const businessId = business_id || usuarioId;
        if (!businessId) return res.status(400).json({ message: "Falta business_id" });
        if (!valor || !cuenta) return res.status(400).json({ message: "Valor y cuenta son obligatorios" });

        let comprobante_url = '';
        if (req.file) {
            if (!numeroDeDocumento) return res.status(400).json({ message: "Se requiere numeroDeDocumento para subir el comprobante" });
            comprobante_url = await uploadReceiptToGCS(req.file.buffer, {
                filename: req.file.originalname, mimetype: req.file.mimetype,
                numeroDocumento: numeroDeDocumento,
            });
        }

        const legacyId           = uuidv4();
        const createdAt          = new Date();
        const fechaVencimiento   = new Date(createdAt);
        fechaVencimiento.setFullYear(fechaVencimiento.getFullYear() + 1);
        const tipoDocumentoFinal = tipoDocumento || tipo_documento || tipoDeDocumento || 'CC';
        const productoStr        = Array.isArray(tipo) ? tipo.join(', ') : (tipo || 'Certificado Express');

        await prisma.$transaction(async (tx) => {
            await tx.ingresos.create({
                data: {
                    legacyId,
                    nombre:           nombre || 'Cliente',
                    apellido:         apellido || '',
                    numeroDeDocumento: numeroDeDocumento || '0',
                    tipoDocumento:    tipoDocumentoFinal,
                    fechaVencimiento,
                    producto:         productoStr,
                    descripcion:      productoStr,
                    valor:            parseFloat(valor),
                    cuenta,
                    customer_email:   customer_email || '',
                    payment_status:   'VERIFICACION_PENDIENTE',
                    payment_reference: `WEB-${Date.now()}`,
                    usuario:          usuarioId || businessId,
                    business_id:      businessId,
                    comprobante_url,
                    createdAt,
                    updatedAt:        createdAt,
                    v:                '0',
                },
            });

            if (numeroDeDocumento && numeroDeDocumento !== '0') {
                await tx.$executeRaw(Prisma.sql`
                    INSERT INTO "public"."personas" (
                        "tipo_documento","numero_documento","nombre","apellido",
                        "celular","direccion","email","tipo","usuario","business_id","created_at","updated_at"
                    ) VALUES (
                        ${tipoDocumentoFinal},${String(numeroDeDocumento)},
                        ${nombre || 'Cliente'},${apellido || ''},
                        ${''},${''},${customer_email || null},${'CLIENTE'},
                        ${usuarioId || String(businessId)},${businessId},
                        ${createdAt.toISOString()},${createdAt.toISOString()}
                    )
                    ON CONFLICT DO NOTHING
                `);
            }
        });

        return res.status(201).json({ success: true, message: "Solicitud recibida. En verificación." });
    } catch (error) {
        console.error("Error en ingreso público:", error);
        return res.status(500).json({ message: "Error interno", error: error.message });
    }
};

// ==========================================
// 3. LISTAR INGRESOS — con items enriquecidos
// ==========================================
export const getIngresosByUsuario = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: "No autorizado" });

        const { fecha_inicio, fecha_fin, cuenta, payment_status, page = 1, limit = 50 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        // json_agg con subquery de items requiere $queryRaw
        const conditions = [Prisma.sql`i.business_id = ${businessId}`];
        if (fecha_inicio) conditions.push(Prisma.sql`i."createdAt" >= ${new Date(fecha_inicio)}`);
        if (fecha_fin) {
            const fin = new Date(fecha_fin); fin.setHours(23, 59, 59, 999);
            conditions.push(Prisma.sql`i."createdAt" <= ${fin}`);
        }
        if (cuenta)          conditions.push(Prisma.sql`i."cuenta" = ${cuenta}`);
        if (payment_status)  conditions.push(Prisma.sql`i."payment_status" = ${payment_status.toUpperCase()}`);

        const whereClause = Prisma.join(conditions, ' AND ');

        const [countRows, dataRows] = await Promise.all([
            prisma.$queryRaw(Prisma.sql`
                SELECT COUNT(DISTINCT i.id)::int AS total
                FROM "public"."ingresos" i WHERE ${whereClause}
            `),
            prisma.$queryRaw(Prisma.sql`
                SELECT
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
                                'inventario_id',   ii.inventario_id,
                                'descripcion',     COALESCE(inv.nombre, ii.descripcion),
                                'nombre_producto', COALESCE(inv.nombre, ii.descripcion),
                                'cantidad',        ii.cantidad,
                                'precio_unitario', ii.precio_unitario,
                                'subtotal',        ii.cantidad * ii.precio_unitario
                            ) ORDER BY ii.id
                        ) AS items_detalle
                    FROM "public"."ingreso_items" ii
                    LEFT JOIN "public"."inventario" inv ON inv.id = ii.inventario_id
                    GROUP BY ii.ingreso_id
                ) agg ON agg.ingreso_id = i."_id"
                WHERE ${whereClause}
                ORDER BY i."createdAt" DESC NULLS LAST
                LIMIT ${Number(limit)} OFFSET ${offset}
            `),
        ]);

        const total = countRows[0]?.total || 0;
        return res.status(200).json({
            data: dataRows,
            pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
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

        // Buscar por id numérico o por legacyId (UUID)
        const ingreso = await prisma.ingresos.findFirst({
            where: {
                business_id: businessId,
                OR: [
                    { id:       isNaN(Number(id)) ? undefined : BigInt(id) },
                    { legacyId: id },
                ].filter(c => Object.values(c)[0] !== undefined),
            },
            include: {
                personas: { select: { nombre: true, apellido: true, numero_documento: true, tipo_documento: true } },
            },
        });

        if (!ingreso) return res.status(404).json({ message: "Ingreso no encontrado" });

        const items = await prisma.ingreso_items.findMany({
            where: { ingreso_id: ingreso.legacyId },
            include: { inventario: { select: { nombre: true } } },
        });

        return res.status(200).json({
            ...ingreso,
            cliente_nombre:   ingreso.personas?.nombre   || ingreso.nombre,
            cliente_apellido: ingreso.personas?.apellido || ingreso.apellido,
            items_detalle: items.map(i => ({
                inventario_id:   i.inventario_id,
                nombre_producto: i.inventario?.nombre || i.descripcion,
                descripcion:     i.descripcion,
                cantidad:        Number(i.cantidad),
                precio_unitario: Number(i.precio_unitario),
                subtotal:        Number(i.cantidad) * Number(i.precio_unitario),
            })),
        });
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

        const condApproved = [Prisma.sql`business_id = ${businessId}`, Prisma.sql`payment_status = 'APPROVED'`];
        const condAll      = [Prisma.sql`business_id = ${businessId}`];

        if (fecha_inicio) {
            const fi = new Date(fecha_inicio);
            condApproved.push(Prisma.sql`"createdAt" >= ${fi}`);
            condAll.push(Prisma.sql`"createdAt" >= ${fi}`);
        }
        if (fecha_fin) {
            const fin = new Date(fecha_fin); fin.setHours(23, 59, 59, 999);
            condApproved.push(Prisma.sql`"createdAt" <= ${fin}`);
            condAll.push(Prisma.sql`"createdAt" <= ${fin}`);
        }

        const whereApproved = Prisma.join(condApproved, ' AND ');
        const whereAll      = Prisma.join(condAll, ' AND ');

        const [resumen, porCuenta, porProducto, porEstado] = await Promise.all([
            prisma.$queryRaw(Prisma.sql`
                SELECT COUNT(*)::int AS total_registros,
                       COALESCE(SUM(valor), 0) AS total_ingresos,
                       COALESCE(AVG(valor), 0) AS promedio_ingreso,
                       COALESCE(MAX(valor), 0) AS ingreso_maximo
                FROM "public"."ingresos" WHERE ${whereApproved}
            `),
            prisma.$queryRaw(Prisma.sql`
                SELECT cuenta, COUNT(*)::int AS cantidad, COALESCE(SUM(valor), 0) AS total
                FROM "public"."ingresos" WHERE ${whereApproved}
                GROUP BY cuenta ORDER BY total DESC
            `),
            prisma.$queryRaw(Prisma.sql`
                SELECT COALESCE(inv.nombre, ii.descripcion, i.producto) AS producto,
                       COUNT(DISTINCT i.id)::int AS cantidad,
                       COALESCE(SUM(ii.cantidad * ii.precio_unitario), SUM(i.valor)) AS total
                FROM "public"."ingresos" i
                LEFT JOIN "public"."ingreso_items" ii ON ii.ingreso_id = i."_id"
                LEFT JOIN "public"."inventario" inv ON inv.id = ii.inventario_id
                WHERE ${whereApproved}
                GROUP BY 1 ORDER BY total DESC LIMIT 10
            `),
            prisma.$queryRaw(Prisma.sql`
                SELECT payment_status, COUNT(*)::int AS cantidad, COALESCE(SUM(valor), 0) AS total
                FROM "public"."ingresos" WHERE ${whereAll} GROUP BY payment_status
            `),
        ]);

        return res.status(200).json({
            resumen:      resumen[0],
            por_cuenta:   porCuenta,
            por_producto: porProducto,
            por_estado:   porEstado,
        });
    } catch (error) {
        return res.status(500).json({ message: "Error al obtener estadísticas", error: error.message });
    }
};

// ==========================================
// 6. VERIFICAR INGRESO
// ==========================================
export const verificarIngreso = async (req, res) => {
    try {
        const { id } = req.params;
        const { payment_status } = req.body;
        const businessId = req.user?.bid;

        if (!['APPROVED', 'RECHAZADO'].includes(payment_status))
            return res.status(400).json({ message: "Estado inválido" });

        const ingreso = await prisma.ingresos.findFirst({
            where: {
                business_id: businessId,
                OR: [
                    { id:       isNaN(Number(id)) ? undefined : BigInt(id) },
                    { legacyId: id },
                ].filter(c => Object.values(c)[0] !== undefined),
            },
        });

        if (!ingreso) return res.status(404).json({ message: "Ingreso no encontrado" });
        if (ingreso.payment_status !== 'VERIFICACION_PENDIENTE')
            return res.status(409).json({ message: "Solo se pueden verificar ingresos en VERIFICACION_PENDIENTE" });

        await prisma.ingresos.update({
            where: { id: ingreso.id },
            data:  { payment_status, updatedAt: new Date() },
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ message: "Error al verificar", error: error.message });
    }
};

// ==========================================
// 7. ACTUALIZAR INGRESO
// ==========================================
export const updateIngreso = async (req, res) => {
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;
        const {
            persona_id, items, descripcion, valor, cuenta, customer_email,
            nombre, apellido, numeroDeDocumento, tipoDocumento, tipo_documento, tipoDeDocumento, tipo,
        } = req.body;

        const ingreso = await prisma.ingresos.findFirst({
            where: {
                business_id: businessId,
                OR: [
                    { id:       isNaN(Number(id)) ? undefined : BigInt(id) },
                    { legacyId: id },
                ].filter(c => Object.values(c)[0] !== undefined),
            },
        });
        if (!ingreso) return res.status(404).json({ message: "Ingreso no encontrado" });

        let personaData = null;
        if (persona_id) {
            personaData = await prisma.personas.findFirst({ where: { id: persona_id, business_id: businessId } });
        }

        const parsedItems = Array.isArray(items) ? items : [];
        if (parsedItems.length === 0 && tipo) {
            const tipoArr = Array.isArray(tipo) ? tipo : [tipo];
            for (const nombreProd of tipoArr) {
                const inv = await prisma.inventario.findFirst({
                    where:  { nombre: nombreProd, business_id: businessId },
                    select: { id: true, monto: true },
                });
                parsedItems.push({ inventario_id: inv?.id || null, descripcion: nombreProd, cantidad: 1, precio_unitario: inv ? Number(inv.monto) : 0 });
            }
        }

        let totalValor = Number(valor) || 0;
        if (!totalValor && parsedItems.length > 0)
            totalValor = parsedItems.reduce((s, i) => s + Number(i.precio_unitario || 0) * Number(i.cantidad || 1), 0);
        if (!totalValor) totalValor = Number(ingreso.valor) || 0;

        const tipoDocFinal = tipoDocumento || tipo_documento || tipoDeDocumento || ingreso.tipoDocumento || 'CC';
        const productoStr  = descripcion || (Array.isArray(tipo) ? tipo.join(', ') : tipo) || ingreso.producto;

        await prisma.$transaction(async (tx) => {
            await tx.ingresos.update({
                where: { id: ingreso.id },
                data: {
                    nombre:           personaData?.nombre           || nombre    || ingreso.nombre,
                    apellido:         personaData?.apellido         || apellido  || ingreso.apellido,
                    numeroDeDocumento: personaData?.numero_documento || numeroDeDocumento || ingreso.numeroDeDocumento,
                    tipoDocumento:    tipoDocFinal,
                    valor:            totalValor,
                    cuenta:           cuenta           ?? ingreso.cuenta,
                    producto:         productoStr,
                    descripcion:      productoStr,
                    customer_email:   personaData?.email || customer_email || ingreso.customer_email,
                    persona_id:       persona_id ?? ingreso.persona_id,
                    updatedAt:        new Date(),
                },
            });

            if (parsedItems.length > 0) {
                await tx.ingreso_items.deleteMany({ where: { ingreso_id: ingreso.legacyId } });
                const nombresProducto = [];
                for (const item of parsedItems) {
                    let prodNombre = item.descripcion || null;
                    if (item.inventario_id) {
                        const inv = await tx.inventario.findFirst({ where: { id: item.inventario_id }, select: { nombre: true } });
                        prodNombre = inv?.nombre || prodNombre;
                    }
                    nombresProducto.push(prodNombre);
                    await tx.ingreso_items.create({
                        data: {
                            ingreso_id:      ingreso.legacyId,
                            inventario_id:   item.inventario_id || null,
                            descripcion:     prodNombre,
                            cantidad:        Number(item.cantidad) || 1,
                            precio_unitario: Number(item.precio_unitario) || 0,
                        },
                    });
                }
                const productoFinal = nombresProducto.filter(Boolean).join(', ');
                if (productoFinal) {
                    await tx.ingresos.update({
                        where: { id: ingreso.id },
                        data:  { producto: productoFinal, descripcion: productoFinal },
                    });
                }
            }
        });

        return res.status(200).json({ message: "Ingreso actualizado", success: true });
    } catch (error) {
        return res.status(500).json({ message: "Error al actualizar", error: error.message });
    }
};

// ==========================================
// 8. ELIMINAR INGRESO
// ==========================================
export const deleteIngreso = async (req, res) => {
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;

        const ingreso = await prisma.ingresos.findFirst({
            where: {
                business_id: businessId,
                OR: [
                    { id:       isNaN(Number(id)) ? undefined : BigInt(id) },
                    { legacyId: id },
                ].filter(c => Object.values(c)[0] !== undefined),
            },
        });
        if (!ingreso) return res.status(404).json({ message: "Ingreso no encontrado" });

        await prisma.$transaction(async (tx) => {
            await tx.ingreso_items.deleteMany({ where: { ingreso_id: ingreso.legacyId } });
            await tx.ingresos.delete({ where: { id: ingreso.id } });
        });

        return res.status(200).json({ message: "Ingreso eliminado correctamente" });
    } catch (error) {
        return res.status(500).json({ message: error.message || "Error al eliminar" });
    }
};
