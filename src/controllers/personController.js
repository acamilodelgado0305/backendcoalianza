import prisma from '../prisma.js';
import { Prisma } from '@prisma/client';

// ==========================================
// 1. CREAR PERSONA (CREATE)
// ==========================================
export const createPersona = async (req, res) => {
    try {
        const {
            tipo_documento, numero_documento, nombre,
            apellido, direccion, celular, email, tipo
        } = req.body;

        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;

        if (!usuarioId)  return res.status(401).json({ message: "Usuario no autenticado" });
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });
        if (!nombre)     return res.status(400).json({ message: "El nombre es obligatorio" });

        if (numero_documento) {
            const existe = await prisma.personas.findFirst({
                where: { numero_documento, business_id: businessId },
                select: { id: true },
            });
            if (existe) return res.status(409).json({ message: "Ya existe un contacto con ese número de documento en este negocio." });
        }

        const persona = await prisma.personas.create({
            data: {
                tipo_documento: tipo_documento || 'CC',
                numero_documento: numero_documento || null,
                nombre,
                apellido:   apellido   || '',
                direccion:  direccion  || '',
                celular:    celular    || '',
                email:      email      || null,
                tipo:       tipo       || 'CLIENTE',
                usuario:    usuarioId,
                business_id: businessId,
            },
        });

        return res.status(201).json({ success: true, message: "Persona creada exitosamente", data: persona });

    } catch (error) {
        console.error("Error creando persona:", error);
        if (error.code === 'P2002') {
            return res.status(409).json({ message: "Ya existe un contacto con ese número de documento en este negocio." });
        }
        return res.status(500).json({ message: "Error interno", error: error.message });
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

        const personas = await prisma.personas.findMany({
            where: {
                business_id: businessId,
                ...(q && {
                    OR: [
                        { numero_documento: { contains: q, mode: 'insensitive' } },
                        { nombre:           { contains: q, mode: 'insensitive' } },
                        { apellido:         { contains: q, mode: 'insensitive' } },
                    ],
                }),
            },
            orderBy: q ? { nombre: 'asc' } : { created_at: 'desc' },
            take: 20,
        });

        return res.status(200).json(personas);
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

        const persona = await prisma.personas.findFirst({
            where: { id: Number(id), business_id: businessId },
        });

        if (!persona) return res.status(404).json({ message: "Persona no encontrada" });
        return res.status(200).json(persona);
    } catch (error) {
        return res.status(500).json({ message: "Error obteniendo persona" });
    }
};

// ==========================================
// 4. ACTUALIZAR PERSONA (UPDATE)
// ==========================================
export const updatePersona = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, apellido, direccion, celular, email, tipo } = req.body;
        const businessId = req.user?.bid;

        const existe = await prisma.personas.findFirst({
            where: { id: Number(id), business_id: businessId },
            select: { id: true },
        });
        if (!existe) return res.status(404).json({ message: "Persona no encontrada" });

        const persona = await prisma.personas.update({
            where: { id: Number(id) },
            data: {
                ...(nombre    !== undefined && { nombre }),
                ...(apellido  !== undefined && { apellido }),
                ...(direccion !== undefined && { direccion }),
                ...(celular   !== undefined && { celular }),
                ...(email     !== undefined && { email }),
                ...(tipo      !== undefined && { tipo }),
                updated_at: new Date(),
            },
        });

        return res.status(200).json({ success: true, message: "Datos actualizados", data: persona });
    } catch (error) {
        console.error("Error actualizando persona:", error);
        return res.status(500).json({ message: "Error al actualizar" });
    }
};

// ==========================================
// 5. HISTORIAL DE VENTAS POR PERSONA
// ==========================================
export const getPersonaVentas = async (req, res) => {
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;

        const persona = await prisma.personas.findFirst({
            where: { id: Number(id), business_id: businessId },
            select: { id: true, nombre: true, apellido: true },
        });
        if (!persona) return res.status(404).json({ message: "Persona no encontrada" });

        // json_agg con ORDER BY requiere SQL puro
        const pedidos = await prisma.$queryRaw(
            Prisma.sql`
                SELECT
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
                WHERE p.persona_id = ${Number(id)} AND p.business_id = ${businessId}
                GROUP BY p.id
                ORDER BY p.created_at DESC
            `
        );

        const stats = {
            total_pedidos:      pedidos.length,
            total_gastado:      pedidos
                                    .filter(p => p.estado !== 'ANULADO')
                                    .reduce((s, p) => s + Number(p.total), 0),
            pedidos_entregados: pedidos.filter(p => p.estado === 'ENTREGADO').length,
            pedidos_pendientes: pedidos.filter(p => p.estado === 'PENDIENTE').length,
            pedidos_anulados:   pedidos.filter(p => p.estado === 'ANULADO').length,
        };

        return res.status(200).json({ persona, pedidos, stats });
    } catch (error) {
        console.error("Error obteniendo ventas de persona:", error);
        return res.status(500).json({ message: "Error al obtener historial de ventas" });
    }
};

// ==========================================
// 6. ELIMINAR PERSONA (DELETE)
// ==========================================
export const deletePersona = async (req, res) => {
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;

        const existe = await prisma.personas.findFirst({
            where: { id: Number(id), business_id: businessId },
            select: { id: true },
        });
        if (!existe) return res.status(404).json({ message: "Persona no encontrada" });

        await prisma.personas.delete({ where: { id: Number(id) } });

        return res.status(200).json({ message: "Persona eliminada correctamente" });
    } catch (error) {
        console.error("Error eliminando persona:", error);
        if (error.code === 'P2003') {
            return res.status(400).json({ message: "No se puede eliminar esta persona porque tiene ventas/ingresos asociados." });
        }
        return res.status(500).json({ message: "Error interno al eliminar" });
    }
};
