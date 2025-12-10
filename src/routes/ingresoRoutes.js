// src/routes/ingresoRoutes.js
import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import {
  createIngreso,
  getIngresosByUsuario,
      updateIngreso,
    deleteIngreso
} from '../controllers/ingresoController.js';

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(authMiddleware);

// Rutas para manejar ingresos
router.post('/', createIngreso); // Crear un nuevo ingreso
router.get('/', getIngresosByUsuario); // Obtener todos los ingresos del usuario autenticado
router.put('/:id', updateIngreso);         // 
router.delete('/:id', deleteIngreso);

export default router;