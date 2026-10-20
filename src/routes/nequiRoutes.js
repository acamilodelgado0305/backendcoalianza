import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { confirmarPagoNequi, reprocesarPagoNequi } from '../controllers/nequiController.js';

const router = express.Router();

// POST /api/pagos/nequi/confirmar  (lo llama n8n con x-api-key)
router.post('/confirmar', confirmarPagoNequi);

// POST /api/pagos/nequi/reprocesar/:referencia  (después de revisar un SIN_LEAD, MONTO_DISTINTO, etc.)
router.post('/reprocesar/:referencia', authMiddleware, reprocesarPagoNequi);

export default router;
