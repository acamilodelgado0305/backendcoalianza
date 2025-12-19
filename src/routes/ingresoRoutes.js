// src/routes/ingresoRoutes.js
import express from 'express';
import multer from 'multer'; // <--- 1. IMPORTAR MULTER
import { authMiddleware } from '../middleware/authMiddleware.js';
import {
  createIngreso,
  createIngresoPublico,
  getIngresosByUsuario,
  updateIngreso,
  deleteIngreso
} from '../controllers/ingresoController.js';

const router = express.Router();

// ==========================================
// ⚙️ CONFIGURACIÓN DE CARGA (MULTER)
// ==========================================
// Esto es OBLIGATORIO para que req.file exista en el controlador.
// Usamos memoryStorage para pasar el archivo directo a Google Cloud sin guardarlo en disco.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // Límite de 5MB por foto (Seguridad)
  },
});

// ==========================================
// 🔓 ZONA PÚBLICA (Sin Token)
// ==========================================
// Esta ruta debe ir ANTES del authMiddleware.
// ⚠️ IMPORTANTE: 'comprobante' debe coincidir EXACTAMENTE con el name="comprobante" de tu input HTML
router.post(
    '/publico', 
    upload.single('comprobante'), // <--- 2. EL MIDDLEWARE MÁGICO
    createIngresoPublico
);


// ==========================================
// 🔒 ZONA PRIVADA (Con Token)
// ==========================================
router.use(authMiddleware);

// Rutas protegidas para el panel administrativo
router.post('/', createIngreso);       // Crear ingreso manual
router.get('/', getIngresosByUsuario); // Ver mis ingresos
router.put('/:id', updateIngreso);     // Editar
router.delete('/:id', deleteIngreso);  // Borrar

export default router;