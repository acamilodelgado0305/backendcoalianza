// src/routes/ingresoRoutes.js
import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import {
  createIngreso,
  getIngresosByUsuario,
} from '../controllers/ingresoController.js';

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(authMiddleware);

// Rutas para manejar ingresos
router.post('/', createIngreso); // Crear un nuevo ingreso
router.get('/', getIngresosByUsuario); // Obtener todos los ingresos del usuario autenticado

export default router;