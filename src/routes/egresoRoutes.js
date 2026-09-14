// src/routes/egresoRoutes.js
import express from 'express';

// Middleware de autenticación (Ajusta la ruta si es necesario)
import { authMiddleware } from '../middleware/authMiddleware.js';

import {
    createEgreso,
    getEgresosByUsuario,
    getEgresoById,
    updateEgreso,
    deleteEgreso,
    getCategoriasEgreso,
    createCategoriaEgreso,
    updateCategoriaEgreso,
    deleteCategoriaEgreso,
} from '../controllers/egresoController.js';

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(authMiddleware);

// Categorías = «etiquetas» en la interfaz (antes de '/:id' para que
// "categorias" no se tome como un id)
router.get('/categorias', getCategoriasEgreso);
router.post('/categorias', createCategoriaEgreso);
router.put('/categorias/:id', updateCategoriaEgreso);
router.delete('/categorias/:id', deleteCategoriaEgreso);

// Endpoints CRUD
router.post('/', createEgreso);           // Crear
router.get('/', getEgresosByUsuario);     // Listar todos
router.get('/:id', getEgresoById);        // Obtener uno
router.put('/:id', updateEgreso);         // Actualizar
router.delete('/:id', deleteEgreso);      // Eliminar

export default router;