// src/routes/egresoRoutes.js
import express from 'express';

// Middleware de autenticación (Ajusta la ruta si es necesario)
import { authMiddleware } from '../middleware/authMiddleware.js';
import { recibirComprobante } from '../middleware/uploadComprobante.js';

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
    subirComprobanteEgreso,
    quitarComprobanteEgreso,
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

// Documento soporte (PDF o imagen). Campo del formulario: name="archivo"
router.put('/:id/comprobante', recibirComprobante, subirComprobanteEgreso);   // Subir o reemplazar
router.delete('/:id/comprobante', quitarComprobanteEgreso);                  // Quitar

export default router;