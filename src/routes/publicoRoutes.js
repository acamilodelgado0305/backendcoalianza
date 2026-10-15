import express from 'express';
import rateLimit from 'express-rate-limit';
import { crearPedidoWeb, crearLeadWeb } from '../controllers/publicoController.js';

const router = express.Router();

// ==========================================
// ZONA PÚBLICA (sin token) — páginas web de los negocios
// Solo negocios habilitados en config/pedidosWeb.js
// ==========================================

// Freno contra abuso: pocas solicitudes por IP. En Cloud Run la IP real del cliente
// es la última de X-Forwarded-For (la agrega el balanceador de Google).
const limitePorIp = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
        const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
        return xff[xff.length - 1] || req.ip;
    },
    validate: { xForwardedForHeader: false },
    message: { message: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' },
});

router.use(limitePorIp);

// POST /api/publico/pedidos -> Pedido desde la página (queda PENDIENTE en RapiCtrl)
router.post('/pedidos', crearPedidoWeb);

// POST /api/publico/leads   -> "Trabaja con nosotros" (lead NUEVO en el CRM)
router.post('/leads', crearLeadWeb);

export default router;
