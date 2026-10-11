import express from 'express';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { crearPreferenciaMP, webhookMP, reprocesarPagoMP } from '../controllers/mercadoPagoController.js';

const router = express.Router();

// El link de pago es público: se limita por IP para que nadie lo use para
// martillar la API de Mercado Pago. En Cloud Run la IP real del cliente es la
// última que agrega Google en x-forwarded-for (las anteriores las puede inventar
// el propio cliente).
const limitePreferencias = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) =>
        (req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket?.remoteAddress || 'desconocida',
    validate: { xForwardedForHeader: false },
    message: { code: 'DEMASIADOS_INTENTOS', message: 'Demasiados intentos. Espera unos minutos.' },
});

// ==========================================
// RUTAS PÚBLICAS
// ==========================================

// POST /api/pagos/mp/preferencia  { numeroDocumento, producto?, email? } → { init_point }
router.post('/preferencia', limitePreferencias, crearPreferenciaMP);

// POST /api/pagos/mp/webhook  (lo llama Mercado Pago; valida x-signature)
router.post('/webhook', webhookMP);

// ==========================================
// RUTAS PROTEGIDAS
// ==========================================

// POST /api/pagos/mp/reprocesar/:paymentId  (después de corregir un SIN_LEAD, etc.)
router.post('/reprocesar/:paymentId', authMiddleware, reprocesarPagoMP);

export default router;
