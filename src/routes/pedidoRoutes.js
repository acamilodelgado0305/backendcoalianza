import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import {
    createPedido,
    getPedidos,
    getPedidoById,
    updateEstadoPedido,
    deletePedido,
    updatePedido,
    getOrderStats,
    realizarCierre,
    getCierres
} from '../controllers/pedidoController.js';

const router = express.Router();

// 🔒 Seguridad: Todas las rutas requieren Token JWT (Usuario autenticado)
router.use(authMiddleware);

// ================= RUTAS DE PEDIDOS =================

// GET /api/pedidos
// Filtros opcionales: ?estado=PENDIENTE&fecha_inicio=Y-M-D&page=1
router.get('/', getPedidos);
router.get('/stats', getOrderStats);


router.post('/cierre', realizarCierre);

router.get('/historial-cierres', getCierres);

// GET /api/pedidos/:id
// Obtener el pedido y sus items (detalle)
router.get('/:id', getPedidoById);


router.put('/:id', updatePedido); // Asegúrate de importar updatePedido
// POST /api/pedidos
// Crear nuevo pedido (Valida stock y lo descuenta)
router.post('/', createPedido);




// PATCH /api/pedidos/:id/estado
// Cambiar estado (PENDIENTE -> ENTREGADO / ANULADO)
// Nota: Usamos PATCH porque solo estamos modificando un campo específico
router.patch('/:id/estado', updateEstadoPedido);

// DELETE /api/pedidos/:id
// Eliminar pedido (Restaura el stock si el pedido estaba activo)
router.delete('/:id', deletePedido);

export default router;