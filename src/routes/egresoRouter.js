// src/routes/egresoRoutes.js

import express from 'express';
import {
  createEgreso,
  getEgresos,
  getEgresoById,
  updateEgreso,
  deleteEgreso,
} from '../controllers/egresoController.js';

const router = express.Router();

// Rutas para manejar egresos
router.post('/', createEgreso); // Crear un nuevo egreso
router.get('/', getEgresos); // Obtener todos los egresos
router.get('/:id', getEgresoById); // Obtener un egreso por ID
router.put('/:id', updateEgreso); // Actualizar un egreso por ID
router.delete('/:id', deleteEgreso); // Eliminar un egreso por ID

export default router;