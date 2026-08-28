import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import {
  createCuentaPorPagar,
  getCuentasPorPagar,
  getCuentaPorPagarById,
  updateCuentaPorPagar,
  deleteCuentaPorPagar,
  registrarAbono,
  aumentarDeuda,
  editarMontoMovimiento,
  getEstadisticasCuentasPorPagar,
} from '../controllers/cuentaPorPagarController.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/stats',       getEstadisticasCuentasPorPagar);
router.get('/',            getCuentasPorPagar);
router.get('/:id',         getCuentaPorPagarById);
router.post('/',           createCuentaPorPagar);
router.put('/:id',         updateCuentaPorPagar);
router.delete('/:id',      deleteCuentaPorPagar);
router.post('/:id/abonar',   registrarAbono);
router.post('/:id/aumentar', aumentarDeuda);
router.put('/:id/movimientos/:movId', editarMontoMovimiento);

export default router;
