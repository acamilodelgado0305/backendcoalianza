import prisma from '../prisma.js';
import { NEGOCIOS_WEB } from '../config/pedidosWeb.js';
import { registrarPedidoWeb, registrarLeadWeb } from '../services/pedidoWebService.js';

// Pedidos y leads que llegan desde la página web de un negocio (sin token).
// El negocio debe estar habilitado en config/pedidosWeb.js.

const negocioWeb = (req) => {
    const businessId = Number(req.body?.business_id);
    const cfg = NEGOCIOS_WEB[businessId];
    return cfg ? { businessId, cfg } : null;
};

const responderError = (res, error, contexto) => {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error(`Error registrando ${contexto} web:`, error);
    return res.status(500).json({ message: 'Error interno' });
};

// POST /api/publico/pedidos
export const crearPedidoWeb = async (req, res) => {
    const negocio = negocioWeb(req);
    if (!negocio) return res.status(404).json({ message: 'Negocio no habilitado para pedidos web' });
    try {
        const data = await prisma.$transaction(tx => registrarPedidoWeb(tx, negocio.businessId, negocio.cfg, req.body));
        return res.status(data.duplicado ? 200 : 201).json({ success: true, data });
    } catch (error) {
        return responderError(res, error, 'pedido');
    }
};

// POST /api/publico/leads
export const crearLeadWeb = async (req, res) => {
    const negocio = negocioWeb(req);
    if (!negocio) return res.status(404).json({ message: 'Negocio no habilitado para formularios web' });
    try {
        const data = await prisma.$transaction(tx => registrarLeadWeb(tx, negocio.businessId, negocio.cfg, req.body));
        return res.status(data.duplicado ? 200 : 201).json({ success: true, data });
    } catch (error) {
        return responderError(res, error, 'lead');
    }
};
