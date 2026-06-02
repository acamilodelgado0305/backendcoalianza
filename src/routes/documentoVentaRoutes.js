import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import {
  createDocumentoVenta,
  getDocumentosVenta,
  getDocumentoVentaById,
  updateDocumentoVenta,
  deleteDocumentoVenta,
  convertirCotizacionAFactura,
  registrarAbono,
  getEstadisticasDocumentos,
  duplicarDocumento,
} from '../controllers/documentoVentaController.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/stats',          getEstadisticasDocumentos);
router.get('/',               getDocumentosVenta);
router.get('/:id',            getDocumentoVentaById);
router.post('/',              createDocumentoVenta);
router.put('/:id',            updateDocumentoVenta);
router.delete('/:id',         deleteDocumentoVenta);
router.post('/:id/convertir', convertirCotizacionAFactura);
router.post('/:id/abonar',    registrarAbono);
router.post('/:id/duplicar',  duplicarDocumento);

export default router;
