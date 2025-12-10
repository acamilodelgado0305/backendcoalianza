// src/routes/egresoRoutes.js
import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import {
    createEgreso,
    getEgresosByUsuario,
} from '../controllers/egresoController.js';

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(authMiddleware);

// Rutas para manejar egresos
router.post('/', createEgreso); // Crear un nuevo egreso
router.get('/', getEgresosByUsuario); // Obtener todos los egresos del usuario autenticado

export default router;
