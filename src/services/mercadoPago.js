// src/services/mercadoPago.js
//
// Cliente mínimo de la API de Mercado Pago (Checkout Pro) para CertiTec.
// Se usa fetch nativo de Node en vez del SDK: solo hacen falta dos llamadas.
//
// Variables de entorno:
//   MP_ACCESS_TOKEN    Access Token de producción de la app "CertiTec Pagos" (obligatorio)
//   MP_WEBHOOK_SECRET  Clave secreta de Webhooks del panel de Mercado Pago (valida x-signature)

import crypto from 'crypto';

const API_URL = 'https://api.mercadopago.com';

// Catálogo de lo que se puede cobrar. El precio SIEMPRE sale de aquí y nunca del
// cliente: el webhook compara contra este mismo valor para detectar montos raros.
//   producto          → texto que queda en `ingresos.producto` (la página de
//                       verificación lo reconoce por 'manipulac'/'alimentos')
//   intensidadHoraria → horas impresas en certificado y carnet (10 h es lo que se
//                       envía para manipulación desde andesfront)
export const PRODUCTOS_MP = {
    bpm: {
        titulo:            'BPM - Manipulación de alimentos',
        precio:            25000,
        producto:          'Manipulación de alimentos',
        servicio:          'manipulacion-alimentos',
        intensidadHoraria: '10',
    },
};

const accessToken = () => {
    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) throw new Error('MP_ACCESS_TOKEN no está configurado');
    return token;
};

const mpFetch = async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${accessToken()}`,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
        const err = new Error(`Mercado Pago ${method} ${path} → HTTP ${res.status}: ${data?.message || 'sin detalle'}`);
        err.status = res.status;
        throw err;
    }
    return data;
};

/** POST /checkout/preferences → devuelve la preferencia creada (trae init_point). */
export const crearPreferencia = (preferencia) =>
    mpFetch('/checkout/preferences', { method: 'POST', body: preferencia });

/** GET /v1/payments/{id} → el pago tal como lo ve Mercado Pago (fuente de verdad). */
export const obtenerPago = (paymentId) =>
    mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}`);

/**
 * Valida el header x-signature de una notificación de Mercado Pago.
 *
 * El header llega como "ts=1704908010,v1=<hmac hex>". El HMAC-SHA256 se calcula
 * con la clave secreta sobre el manifiesto "id:{data.id};request-id:{x-request-id};ts:{ts};"
 * (las partes que no lleguen se omiten, tal como indica la documentación).
 *
 * @returns {boolean}
 */
export const validarFirma = ({ xSignature, xRequestId, dataId, secret }) => {
    if (!xSignature || !secret) return false;

    const partes = {};
    for (const parte of String(xSignature).split(',')) {
        const i = parte.indexOf('=');
        if (i > 0) partes[parte.slice(0, i).trim()] = parte.slice(i + 1).trim();
    }
    const { ts, v1 } = partes;
    if (!ts || !v1 || !/^[0-9a-f]+$/i.test(v1)) return false;

    let manifiesto = '';
    if (dataId)     manifiesto += `id:${String(dataId).toLowerCase()};`;
    if (xRequestId) manifiesto += `request-id:${xRequestId};`;
    manifiesto += `ts:${ts};`;

    const esperado = crypto.createHmac('sha256', secret).update(manifiesto).digest();
    const recibido = Buffer.from(v1, 'hex');
    return recibido.length === esperado.length && crypto.timingSafeEqual(recibido, esperado);
};
