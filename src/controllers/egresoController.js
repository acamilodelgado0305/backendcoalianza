import prisma from '../prisma.js';
import { v4 as uuidv4 } from 'uuid';
import { buildFiltroFechas } from '../utils/dateRange.js';

// Prisma devuelve el campo `_id` de la DB como `legacyId` (por el @map).
// El frontend espera `_id`, así que normalizamos antes de responder.
// La etiqueta (categoría en BD) viaja aplanada como `categoria_nombre` / `categoria_color`.
const normalizeEgreso = ({ categoria, ...e }) => ({
    ...e,
    _id: e.legacyId,
    categoria_nombre: categoria?.nombre ?? null,
    categoria_color:  categoria?.color ?? null,
});

const INCLUDE_CATEGORIA = { categoria: { select: { nombre: true, color: true } } };

const errorHttp = (status, message) => Object.assign(new Error(message), { status });

// Solo se aceptan categorías del negocio activo. null / '' quita la categoría.
const resolverCategoria = async (valor, businessId) => {
    if (valor === null || valor === undefined || valor === '') return null;
    const id = Number(valor);
    if (!Number.isInteger(id)) throw errorHttp(400, 'Etiqueta inválida');
    const categoria = await prisma.egreso_categorias.findFirst({
        where:  { id, business_id: businessId },
        select: { id: true },
    });
    if (!categoria) throw errorHttp(400, 'La etiqueta no existe en este negocio');
    return id;
};

// ==========================================
// 1. CREAR EGRESO (CREATE)
// ==========================================
export const createEgreso = async (req, res) => {
    try {
        const { fecha, valor, cuenta, descripcion, categoria_id } = req.body;
        const usuarioId  = req.user?.id;
        const businessId = req.user?.bid;

        if (!usuarioId)  return res.status(401).json({ message: "Usuario no autenticado" });
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });
        if (!fecha || !valor || !cuenta || !descripcion) {
            return res.status(400).json({ message: "Todos los campos son obligatorios" });
        }

        const egreso = await prisma.egresos.create({
            data: {
                legacyId:     uuidv4(),
                fecha:        new Date(fecha),
                valor:        parseFloat(valor),
                cuenta,
                descripcion:  descripcion.trim(),
                categoria_id: await resolverCategoria(categoria_id, businessId),
                usuario:      usuarioId,
                business_id:  businessId,
                createdAt:    new Date(),
                updatedAt:    new Date(),
                v:            0,
            },
            include: INCLUDE_CATEGORIA,
        });

        return res.status(201).json(normalizeEgreso(egreso));
    } catch (error) {
        if (error.status === 400) return res.status(400).json({ message: error.message });
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

        const rangoFechas = buildFiltroFechas(req.query);

        const egresos = await prisma.egresos.findMany({
            where: {
                business_id: businessId,
                ...(rangoFechas && { fecha: rangoFechas }),
            },
            include: INCLUDE_CATEGORIA,
            orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }],
        });

        return res.status(200).json(egresos.map(normalizeEgreso));
    } catch (error) {
        if (error.status === 400) return res.status(400).json({ message: error.message });
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
            include: INCLUDE_CATEGORIA,
        });

        if (!egreso) return res.status(404).json({ message: "Egreso no encontrado" });
        return res.status(200).json(normalizeEgreso(egreso));
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
        const { fecha, valor, cuenta, descripcion, categoria_id } = req.body;
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
                // Sin el campo en el body se conserva; con null se quita.
                categoria_id: categoria_id !== undefined
                    ? await resolverCategoria(categoria_id, businessId)
                    : existente.categoria_id,
                updatedAt:   new Date(),
            },
            include: INCLUDE_CATEGORIA,
        });

        return res.status(200).json({ message: "Egreso actualizado", data: normalizeEgreso(egreso) });
    } catch (error) {
        if (error.status === 400) return res.status(400).json({ message: error.message });
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

// ==========================================
// 6. CATEGORÍAS DE EGRESO (por negocio)
// ==========================================
// En la interfaz se llaman «etiquetas» y tienen color (los mensajes de error
// también dicen etiqueta); tablas, columnas y endpoints conservan `categoria`.
// Se crean, editan y eliminan desde el formulario del gasto.
const NOMBRE_CATEGORIA_MAX = 80;
const COLOR_ETIQUETA_DEFAULT = '#475569';
const SELECT_ETIQUETA = { id: true, nombre: true, color: true };

// '#RRGGBB' en minúsculas, o null si no es un color válido.
const normalizarColor = (valor) =>
    (/^#[0-9a-f]{6}$/i.test(String(valor ?? '')) ? String(valor).toLowerCase() : null);

// Espacios colapsados; devuelve { nombre } o { error }.
const validarNombre = (valor) => {
    const nombre = String(valor ?? '').trim().replace(/\s+/g, ' ');
    if (!nombre) return { error: "Escribe el nombre de la etiqueta" };
    if (nombre.length > NOMBRE_CATEGORIA_MAX) {
        return { error: `El nombre no puede pasar de ${NOMBRE_CATEGORIA_MAX} caracteres` };
    }
    return { nombre };
};

// Etiqueta del negocio con ese nombre (sin distinguir mayúsculas), opcionalmente excluyendo un id.
const buscarPorNombre = (businessId, nombre, excluirId = null) =>
    prisma.egreso_categorias.findFirst({
        where: {
            business_id: businessId,
            nombre: { equals: nombre, mode: 'insensitive' },
            ...(excluirId != null && { id: { not: excluirId } }),
        },
        select: SELECT_ETIQUETA,
    });

const etiquetaDelNegocio = (id, businessId) =>
    prisma.egreso_categorias.findFirst({ where: { id, business_id: businessId }, select: { id: true } });

export const getCategoriasEgreso = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

        const categorias = await prisma.egreso_categorias.findMany({
            where:   { business_id: businessId },
            select:  SELECT_ETIQUETA,
            orderBy: { nombre: 'asc' },
        });

        return res.status(200).json(categorias);
    } catch (error) {
        console.error("Error obteniendo categorías de egreso:", error);
        return res.status(500).json({ message: "Error al obtener las etiquetas" });
    }
};

export const createCategoriaEgreso = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

        const { nombre, error } = validarNombre(req.body?.nombre);
        if (error) return res.status(400).json({ message: error });
        const color = normalizarColor(req.body?.color) || COLOR_ETIQUETA_DEFAULT;

        // No se duplican dentro del negocio (sin distinguir mayúsculas): si ya
        // existe, se devuelve esa para que el formulario simplemente la elija.
        const existente = await buscarPorNombre(businessId, nombre);
        if (existente) return res.status(200).json(existente);

        try {
            const categoria = await prisma.egreso_categorias.create({
                data:   { business_id: businessId, nombre, color },
                select: SELECT_ETIQUETA,
            });
            return res.status(201).json(categoria);
        } catch (err) {
            // Otra petición la creó al mismo tiempo (índice único): se devuelve esa.
            const creada = await buscarPorNombre(businessId, nombre);
            if (creada) return res.status(200).json(creada);
            throw err;
        }
    } catch (error) {
        console.error("Error creando categoría de egreso:", error);
        return res.status(500).json({ message: "Error al crear la etiqueta" });
    }
};

export const updateCategoriaEgreso = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return res.status(400).json({ message: "Etiqueta inválida" });
        if (!(await etiquetaDelNegocio(id, businessId))) {
            return res.status(404).json({ message: "Etiqueta no encontrada" });
        }

        const data = {};
        if (req.body?.nombre !== undefined) {
            const { nombre, error } = validarNombre(req.body.nombre);
            if (error) return res.status(400).json({ message: error });
            if (await buscarPorNombre(businessId, nombre, id)) {
                return res.status(409).json({ message: "Ya existe una etiqueta con ese nombre" });
            }
            data.nombre = nombre;
        }
        if (req.body?.color !== undefined) {
            const color = normalizarColor(req.body.color);
            if (!color) return res.status(400).json({ message: "Color inválido" });
            data.color = color;
        }
        if (!Object.keys(data).length) return res.status(400).json({ message: "Nada que actualizar" });

        const categoria = await prisma.egreso_categorias.update({
            where:  { id },
            data,
            select: SELECT_ETIQUETA,
        });

        return res.status(200).json(categoria);
    } catch (error) {
        console.error("Error actualizando categoría de egreso:", error);
        return res.status(500).json({ message: "Error al actualizar la etiqueta" });
    }
};

export const deleteCategoriaEgreso = async (req, res) => {
    try {
        const businessId = req.user?.bid;
        if (!businessId) return res.status(401).json({ message: "No se pudo determinar el negocio activo" });

        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return res.status(400).json({ message: "Etiqueta inválida" });
        if (!(await etiquetaDelNegocio(id, businessId))) {
            return res.status(404).json({ message: "Etiqueta no encontrada" });
        }

        // La FK egresos.categoria_id es ON DELETE SET NULL: sus gastos quedan sin etiqueta.
        const gastosSinEtiqueta = await prisma.egresos.count({ where: { categoria_id: id, business_id: businessId } });
        await prisma.egreso_categorias.delete({ where: { id } });

        return res.status(200).json({ message: "Etiqueta eliminada", id, gastos_sin_etiqueta: gastosSinEtiqueta });
    } catch (error) {
        console.error("Error eliminando categoría de egreso:", error);
        return res.status(500).json({ message: "Error al eliminar la etiqueta" });
    }
};
