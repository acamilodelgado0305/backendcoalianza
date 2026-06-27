import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import {
    createLead,
    createLeadPublico,
    updateLeadPublico,
    getLeads,
    getLeadById,
    getLeadStats,
    updateLead,
    deleteLead,
} from '../controllers/crmLeadController.js';

const router = express.Router();

// ==========================================
// ZONA PÚBLICA (sin token) — formularios web
// POST /api/crm/leads/publico
// ==========================================
router.post('/publico', createLeadPublico);

// PUT /api/crm/leads/publico/:id  -> Actualizar lead sin token (business_id en el body)
// Útil para avanzar el embudo desde una página pública, p. ej. estado -> 'PROPUESTA'
router.put('/publico/:id', updateLeadPublico);

// ==========================================
// ZONA PRIVADA (requiere JWT)
// ==========================================
router.use(authMiddleware);

// ================= RUTAS =================

// GET /api/crm/leads?q=&estado=&origen=  -> Listar / buscar leads
router.get('/', getLeads);

// GET /api/crm/leads/stats               -> Resumen del embudo (debe ir antes de /:id)
router.get('/stats', getLeadStats);

// GET /api/crm/leads/:id                 -> Ver detalle de un lead
router.get('/:id', getLeadById);

// POST /api/crm/leads                    -> Crear nuevo lead
router.post('/', createLead);

// PUT /api/crm/leads/:id                 -> Actualizar lead
router.put('/:id', updateLead);

// DELETE /api/crm/leads/:id              -> Eliminar lead
router.delete('/:id', deleteLead);

export default router;
