import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import {
    createPersona,
    searchPersonas,
    getPersonaById,
    updatePersona,
    deletePersona
} from '../controllers/personController.js';

const router = express.Router();

// Todas las rutas requieren Token JWT
router.use(authMiddleware);

// ================= RUTAS =================

// GET /api/personas?q=juan  -> Buscar (Autocompletado)
router.get('/', searchPersonas);

// GET /api/personas/:id     -> Ver detalle
router.get('/:id', getPersonaById);

// POST /api/personas        -> Crear nuevo cliente
router.post('/', createPersona);

// PUT /api/personas/:id     -> Actualizar datos
router.put('/:id', updatePersona);

// DELETE /api/personas/:id  -> Borrar (Solo si no tiene ventas)
router.delete('/:id', deletePersona);

export default router;