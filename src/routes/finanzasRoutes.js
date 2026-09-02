// src/routes/finanzasRoutes.js
import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import {
    getFinanzasConfig,
    updateFinanzasConfig,
    getSaldo,
} from '../controllers/finanzasController.js';

const router = express.Router();

router.use(authMiddleware);

// Punto de partida del saldo (saldo inicial + fecha de corte) del negocio
// GET/PUT /api/finanzas/config
router.get('/config', getFinanzasConfig);
router.put('/config', updateFinanzasConfig);

// Saldo anterior / del periodo / final para un rango
// GET /api/finanzas/saldo?fecha_inicio=&fecha_fin=&tz_offset=
router.get('/saldo', getSaldo);

export default router;
