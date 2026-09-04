import express from 'express';
import multer from 'multer';
import {
    createInventarioItem,
    getInventario,
    updateInventarioItem,
    deleteInventarioItem,
    getInventarioByUserId,
    getInventarioItemStats,
    uploadInventarioPhoto,
    restockInventario,
    ajustarStockInventario,
    ajustarCategoriaInventario,
} from '../controllers/inventarioController.js';

import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authMiddleware);

router.get('/',           getInventario);
router.post('/',          upload.single('imagen'), createInventarioItem);
router.put('/:id',        upload.single('imagen'), updateInventarioItem);
router.delete('/:id',     deleteInventarioItem);
router.delete('/',        deleteInventarioItem);

// Stats e informe del producto
router.get('/:id/stats',  getInventarioItemStats);

// Surtir / Restock
router.post('/:id/restock', restockInventario);

// Ajustar stock directo (incluye reiniciar a 0)
router.put('/:id/stock', ajustarStockInventario);

// Cambiar categoria desde la tabla (edicion en linea)
router.put('/:id/categoria', ajustarCategoriaInventario);

// Subir foto de manera independiente (desde el modal de informe)
router.post('/:id/foto',  upload.single('imagen'), uploadInventarioPhoto);

// Admin
router.get('/user/:userId', getInventarioByUserId);

export default router;
