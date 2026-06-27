import prisma from '../prisma.js';

// Estados y orígenes válidos (mismos valores que usa el frontend)
const ESTADOS_VALIDOS = ['NUEVO', 'CONTACTADO', 'CALIFICADO', 'PROPUESTA', 'GANADO', 'PERDIDO'];
const ORIGENES_VALIDOS = ['WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'REFERIDO', 'WEB', 'LLAMADA', 'OTRO'];

// ==========================================
// 1. CREAR LEAD (CREATE)
// ==========================================
export const createLead = async (req, res) => {
    try {
        const {
            nombre, empresa, tipo_documento, numero_documento, email, telefono,
            origen, estado, valor_estimado, notas, persona_id,
        } = req.body;

        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;

        if (!usuarioId)  return res.status(401).json({ message: "Usuario no autenticado" });
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });
        if (!nombre)     return res.status(400).json({ message: "El nombre es obligatorio" });

        const lead = await prisma.crm_leads.create({
            data: {
                nombre,
                empresa:          empresa  || null,
                tipo_documento:   tipo_documento   || null,
                numero_documento: numero_documento || null,
                email:            email    || null,
                telefono:         telefono || null,
                origen:           ORIGENES_VALIDOS.includes(origen) ? origen : 'OTRO',
                estado:           ESTADOS_VALIDOS.includes(estado) ? estado : 'NUEVO',
                valor_estimado:   valor_estimado != null ? Number(valor_estimado) : 0,
                notas:            notas || null,
                persona_id:       persona_id ? Number(persona_id) : null,
                usuario:          usuarioId,
                business_id:      businessId,
            },
        });

        return res.status(201).json({ success: true, message: "Lead creado exitosamente", data: lead });
    } catch (error) {
        console.error("Error creando lead:", error);
        return res.status(500).json({ message: "Error interno", error: error.message });
    }
};

// ==========================================
// 1.b CREAR LEAD DESDE FORMULARIO PÚBLICO (SIN TOKEN)
// ==========================================
// El negocio se identifica con business_id enviado en el payload.
export const createLeadPublico = async (req, res) => {
    try {
        const {
            business_id, nombre, empresa, tipo_documento, numero_documento,
            email, telefono, origen, valor_estimado, notas,
        } = req.body;

        const businessId = Number(business_id);
        if (!businessId) return res.status(400).json({ message: "Falta business_id" });
        if (!nombre)     return res.status(400).json({ message: "El nombre es obligatorio" });

        const lead = await prisma.crm_leads.create({
            data: {
                nombre,
                empresa:          empresa  || null,
                tipo_documento:   tipo_documento   || null,
                numero_documento: numero_documento || null,
                email:            email    || null,
                telefono:         telefono || null,
                origen:           ORIGENES_VALIDOS.includes(origen) ? origen : 'WEB',
                estado:           'NUEVO', // todo lead público entra como nuevo
                valor_estimado:   valor_estimado != null ? Number(valor_estimado) : 0,
                notas:            notas || null,
                usuario:          null,    // no hay usuario autenticado
                business_id:      businessId,
            },
        });

        return res.status(201).json({ success: true, message: "¡Gracias! Tus datos fueron registrados.", data: { id: lead.id } });
    } catch (error) {
        console.error("Error creando lead público:", error);
        return res.status(500).json({ message: "Error interno", error: error.message });
    }
};

// ==========================================
// 1.c ACTUALIZAR LEAD DESDE ZONA PÚBLICA (SIN TOKEN)
// ==========================================
// El negocio se identifica con business_id en el body (igual que createLeadPublico).
// Caso típico: avanzar el lead en el embudo (p. ej. estado -> 'PROPUESTA') sin sesión.
export const updateLeadPublico = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            business_id, nombre, empresa, tipo_documento, numero_documento,
            email, telefono, origen, estado, valor_estimado, notas,
        } = req.body;

        const businessId = Number(business_id);
        if (!businessId) return res.status(400).json({ message: "Falta business_id" });

        // El lead debe existir Y pertenecer a ese negocio (evita editar leads de otro business)
        const existe = await prisma.crm_leads.findFirst({
            where: { id: Number(id), business_id: businessId },
            select: { id: true },
        });
        if (!existe) return res.status(404).json({ message: "Lead no encontrado" });

        if (estado !== undefined && !ESTADOS_VALIDOS.includes(estado)) {
            return res.status(400).json({ message: "Estado inválido" });
        }
        if (origen !== undefined && !ORIGENES_VALIDOS.includes(origen)) {
            return res.status(400).json({ message: "Origen inválido" });
        }

        const lead = await prisma.crm_leads.update({
            where: { id: Number(id) },
            data: {
                ...(nombre           !== undefined && { nombre }),
                ...(empresa          !== undefined && { empresa: empresa || null }),
                ...(tipo_documento   !== undefined && { tipo_documento: tipo_documento || null }),
                ...(numero_documento !== undefined && { numero_documento: numero_documento || null }),
                ...(email            !== undefined && { email: email || null }),
                ...(telefono         !== undefined && { telefono: telefono || null }),
                ...(origen           !== undefined && { origen }),
                ...(estado           !== undefined && { estado }),
                ...(valor_estimado   !== undefined && { valor_estimado: Number(valor_estimado) || 0 }),
                ...(notas            !== undefined && { notas: notas || null }),
                updated_at: new Date(),
            },
        });

        return res.status(200).json({ success: true, message: "Lead actualizado", data: lead });
    } catch (error) {
        console.error("Error actualizando lead público:", error);
        return res.status(500).json({ message: "Error al actualizar" });
    }
};

// ==========================================
// 2. LISTAR / BUSCAR LEADS (READ)
// ==========================================
export const getLeads = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

        const { q, estado, origen, fecha_inicio, fecha_fin } = req.query;

        const where = {
            business_id: businessId,
            ...(estado && { estado }),
            ...(origen && { origen }),
            ...(q && {
                OR: [
                    { nombre:   { contains: q, mode: 'insensitive' } },
                    { empresa:  { contains: q, mode: 'insensitive' } },
                    { email:    { contains: q, mode: 'insensitive' } },
                    { telefono: { contains: q, mode: 'insensitive' } },
                ],
            }),
        };

        if (fecha_inicio) {
            where.created_at = {
                gte: new Date(fecha_inicio),
            };
        }
        if (fecha_fin) {
            const fin = new Date(fecha_fin);
            fin.setHours(23, 59, 59, 999);
            where.created_at = {
                ...(where.created_at || {}),
                lte: fin,
            };
        }

        const leads = await prisma.crm_leads.findMany({
            where,
            orderBy: { created_at: 'desc' },
        });

        return res.status(200).json(leads);
    } catch (error) {
        console.error("Error en getLeads:", error.message);
        return res.status(500).json({ message: "Error interno al obtener los leads" });
    }
};

// ==========================================
// 3. OBTENER UN LEAD POR ID
// ==========================================
export const getLeadById = async (req, res) => {
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;

        const lead = await prisma.crm_leads.findFirst({
            where: { id: Number(id), business_id: businessId },
        });

        if (!lead) return res.status(404).json({ message: "Lead no encontrado" });
        return res.status(200).json(lead);
    } catch (error) {
        return res.status(500).json({ message: "Error obteniendo el lead" });
    }
};

// ==========================================
// 4. ESTADÍSTICAS DEL EMBUDO
// ==========================================
export const getLeadStats = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

        const { fecha_inicio, fecha_fin } = req.query;

        const where = {
            business_id: businessId,
        };

        if (fecha_inicio) {
            where.created_at = {
                gte: new Date(fecha_inicio),
            };
        }
        if (fecha_fin) {
            const fin = new Date(fecha_fin);
            fin.setHours(23, 59, 59, 999);
            where.created_at = {
                ...(where.created_at || {}),
                lte: fin,
            };
        }

        const grupos = await prisma.crm_leads.groupBy({
            by: ['estado'],
            where,
            _count: { _all: true },
            _sum: { valor_estimado: true },
        });

        // Normalizar a un objeto por estado
        const porEstado = ESTADOS_VALIDOS.reduce((acc, e) => {
            const g = grupos.find(x => x.estado === e);
            acc[e] = {
                total: g?._count?._all || 0,
                valor: Number(g?._sum?.valor_estimado || 0),
            };
            return acc;
        }, {});

        const total = grupos.reduce((s, g) => s + (g._count?._all || 0), 0);
        const valorPipeline = grupos
            .filter(g => g.estado !== 'PERDIDO')
            .reduce((s, g) => s + Number(g._sum?.valor_estimado || 0), 0);

        return res.status(200).json({ total, valorPipeline, porEstado });
    } catch (error) {
        console.error("Error en getLeadStats:", error);
        return res.status(500).json({ message: "Error al obtener estadísticas" });
    }
};

// ==========================================
// 5. ACTUALIZAR LEAD (UPDATE)
// ==========================================
export const updateLead = async (req, res) => {
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;
        const {
            nombre, empresa, tipo_documento, numero_documento, email, telefono,
            origen, estado, valor_estimado, notas, persona_id,
        } = req.body;

        const existe = await prisma.crm_leads.findFirst({
            where: { id: Number(id), business_id: businessId },
            select: { id: true },
        });
        if (!existe) return res.status(404).json({ message: "Lead no encontrado" });

        if (estado !== undefined && !ESTADOS_VALIDOS.includes(estado)) {
            return res.status(400).json({ message: "Estado inválido" });
        }
        if (origen !== undefined && !ORIGENES_VALIDOS.includes(origen)) {
            return res.status(400).json({ message: "Origen inválido" });
        }

        const lead = await prisma.crm_leads.update({
            where: { id: Number(id) },
            data: {
                ...(nombre           !== undefined && { nombre }),
                ...(empresa          !== undefined && { empresa: empresa || null }),
                ...(tipo_documento   !== undefined && { tipo_documento: tipo_documento || null }),
                ...(numero_documento !== undefined && { numero_documento: numero_documento || null }),
                ...(email            !== undefined && { email: email || null }),
                ...(telefono       !== undefined && { telefono: telefono || null }),
                ...(origen         !== undefined && { origen }),
                ...(estado         !== undefined && { estado }),
                ...(valor_estimado !== undefined && { valor_estimado: Number(valor_estimado) || 0 }),
                ...(notas          !== undefined && { notas: notas || null }),
                ...(persona_id     !== undefined && { persona_id: persona_id ? Number(persona_id) : null }),
                updated_at: new Date(),
            },
        });

        return res.status(200).json({ success: true, message: "Lead actualizado", data: lead });
    } catch (error) {
        console.error("Error actualizando lead:", error);
        return res.status(500).json({ message: "Error al actualizar" });
    }
};

// ==========================================
// 6. ELIMINAR LEAD (DELETE)
// ==========================================
export const deleteLead = async (req, res) => {
    try {
        const { id } = req.params;
        const businessId = req.user?.bid;

        const existe = await prisma.crm_leads.findFirst({
            where: { id: Number(id), business_id: businessId },
            select: { id: true },
        });
        if (!existe) return res.status(404).json({ message: "Lead no encontrado" });

        await prisma.crm_leads.delete({ where: { id: Number(id) } });

        return res.status(200).json({ message: "Lead eliminado correctamente" });
    } catch (error) {
        console.error("Error eliminando lead:", error);
        return res.status(500).json({ message: "Error interno al eliminar" });
    }
};
