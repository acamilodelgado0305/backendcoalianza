// src/routes/ingresoRoutes.js
import express from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/authMiddleware.js';
import {
  createIngreso,
  createIngresoPublico,
  getIngresosByUsuario,
  getIngresoById,
  getIngresoStats,
  verificarIngreso,
  updateIngreso,
  deleteIngreso
} from '../controllers/ingresoController.js';

const router = express.Router();

// Multer en memoria — el archivo va directo a GCS sin tocar el disco
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB máximo
});

// ==========================================
// ZONA PÚBLICA (sin token)
// ==========================================
// POST /api/ingresos/publico
// Campo del formulario: name="comprobante"
router.post('/publico', upload.single('comprobante'), createIngresoPublico);

// ==========================================
// ZONA PRIVADA (requiere JWT)
// ==========================================
router.use(authMiddleware);

// Listar ingresos con filtros opcionales y paginación
// GET /api/ingresos?fecha_inicio=&fecha_fin=&cuenta=&payment_status=&page=1&limit=50
router.get('/', getIngresosByUsuario);

// Estadísticas / resumen
// GET /api/ingresos/stats?fecha_inicio=&fecha_fin=
router.get('/stats', getIngresoStats);

// Obtener uno por ID
// GET /api/ingresos/:id
router.get('/:id', getIngresoById);

// Crear ingreso manual (admin/backoffice)
// POST /api/ingresos
router.post('/', createIngreso);

// Verificar pago pendiente: VERIFICACION_PENDIENTE → APPROVED | RECHAZADO
// PATCH /api/ingresos/:id/verificar  { payment_status: "APPROVED" }
router.patch('/:id/verificar', verificarIngreso);

// Editar datos de un ingreso
// PUT /api/ingresos/:id
router.put('/:id', updateIngreso);

// Eliminar
// DELETE /api/ingresos/:id
router.delete('/:id', deleteIngreso);

export default router;
