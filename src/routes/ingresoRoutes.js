// src/routes/ingresoRoutes.js
import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import {
  createIngreso,
  createIngresoPublico, // <--- 1. Importamos la nueva función
  getIngresosByUsuario,
  updateIngreso,
  deleteIngreso
} from '../controllers/ingresoController.js';

const router = express.Router();

// ==========================================
// 🔓 ZONA PÚBLICA (Sin Token)
// ==========================================
// Esta ruta debe ir ANTES del authMiddleware para que la Landing Page pueda acceder
router.post('/publico', createIngresoPublico);


// ==========================================
// 🔒 ZONA PRIVADA (Con Token)
// ==========================================
// Todo lo que esté debajo de esta línea requiere iniciar sesión
router.use(authMiddleware);

// Rutas protegidas para el panel administrativo
router.post('/', createIngreso);       // Crear ingreso manual (Dashboard)
router.get('/', getIngresosByUsuario); // Ver mis ingresos
router.put('/:id', updateIngreso);     // Editar
router.delete('/:id', deleteIngreso);  // Borrar

export default router;