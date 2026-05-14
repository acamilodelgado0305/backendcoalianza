import prisma from '../prisma.js';
import { v4 as uuidv4 } from 'uuid';

// ==========================================
// 1. CREAR EGRESO (CREATE)
// ==========================================
export const createEgreso = async (req, res) => {
    try {
        const { fecha, valor, cuenta, descripcion } = req.body;
        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;

        if (!usuarioId)  return res.status(401).json({ message: "Usuario no autenticado" });
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });
        if (!fecha || !valor || !cuenta || !descripcion) {
            return res.status(400).json({ message: "Todos los campos son obligatorios" });
        }

        const egreso = await prisma.egresos.create({
            data: {
                legacyId:    uuidv4(),
                fecha:       new Date(fecha),
                valor:       parseFloat(valor),
                cuenta,
                descripcion: descripcion.trim(),
                usuario:     usuarioId,
                business_id: businessId,
                createdAt:   new Date(),
                updatedAt:   new Date(),
                v:           0,
            },
        });

        return res.status(201).json(egreso);
    } catch (error) {
        console.error("Error al crear el egreso:", error);
        return res.status(500).json({ message: "Error al crear el egreso", error: error.message });
    }
};

// ==========================================
// 2. OBTENER TODOS LOS EGRESOS (READ)
// ==========================================
export const getEgresosByUsuario = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

        const { fecha_inicio, fecha_fin } = req.query;

        const egresos = await prisma.egresos.findMany({
            where: {
                business_id: businessId,
                ...(fecha_inicio || fecha_fin ? {
                    fecha: {
                        ...(fecha_inicio && { gte: new Date(fecha_inicio) }),
                        ...(fecha_fin && { lte: new Date(new Date(fecha_fin).setHours(23, 59, 59, 999)) }),
                    },
                } : {}),
            },
            orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }],
        });

        return res.status(200).json(egresos);
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
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

        // Soporta búsqueda por id numérico o por legacyId (UUID)
        const egreso = await prisma.egresos.findFirst({
            where: {
                business_id: businessId,
                OR: [
                    { id:       isNaN(Number(id)) ? undefined : BigInt(id) },
                    { legacyId: id },
                ].filter(c => Object.values(c)[0] !== undefined),
            },
        });

        if (!egreso) return res.status(404).json({ message: "Egreso no encontrado" });
        return res.status(200).json(egreso);
    } catch (error) {
        console.error("Error obteniendo egreso:", error);
        return res.status(500).json({ message: "Error del servidor" });
    }
};

// ==========================================
// 4. ACTUALIZAR EGRESO (UPDATE)
// ==========================================
export const updateEgreso = async (req, res) => {
    try {
        const { id } = req.params;
        const { fecha, valor, cuenta, descripcion } = req.body;
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

        const existente = await prisma.egresos.findFirst({
            where: {
                business_id: businessId,
                OR: [
                    { id:       isNaN(Number(id)) ? undefined : BigInt(id) },
                    { legacyId: id },
                ].filter(c => Object.values(c)[0] !== undefined),
            },
        });
        if (!existente) return res.status(404).json({ message: "Egreso no encontrado para actualizar" });

        const egreso = await prisma.egresos.update({
            where: { id: existente.id },
            data: {
                fecha:       fecha       ? new Date(fecha) : existente.fecha,
                valor:       valor       ? parseFloat(valor) : existente.valor,
                cuenta:      cuenta      ?? existente.cuenta,
                descripcion: descripcion ?? existente.descripcion,
                updatedAt:   new Date(),
            },
        });

        return res.status(200).json({ message: "Egreso actualizado", data: egreso });
    } catch (error) {
        console.error("Error actualizando egreso:", error);
        return res.status(500).json({ message: "Error al actualizar", error: error.message });
    }
};

// ==========================================
// 5. ELIMINAR EGRESO (DELETE)
// ==========================================
export const deleteEgreso = async (req, res) => {
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;

        const existente = await prisma.egresos.findFirst({
            where: {
                business_id: businessId,
                OR: [
                    { id:       isNaN(Number(id)) ? undefined : BigInt(id) },
                    { legacyId: id },
                ].filter(c => Object.values(c)[0] !== undefined),
            },
        });
        if (!existente) return res.status(404).json({ message: "Egreso no encontrado para eliminar" });

        await prisma.egresos.delete({ where: { id: existente.id } });

        return res.status(200).json({ message: "Egreso eliminado correctamente" });
    } catch (error) {
        console.error("Error eliminando egreso:", error);
        return res.status(500).json({ message: "Error al eliminar", error: error.message });
    }
};
