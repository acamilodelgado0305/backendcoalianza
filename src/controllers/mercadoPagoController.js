import prisma from '../prisma.js';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { crearPreferencia, obtenerPago, validarFirma, PRODUCTOS_MP } from '../services/mercadoPago.js';
import { sendLeadEvent, estadoToEventName } from '../services/metaConversions.js';

// Pagos con Mercado Pago (Checkout Pro) para CertiTec.
//
// Flujo: el cliente aprueba el examen en certitecol.com (eso crea el lead en
// crm_leads) → pide el link de pago con su documento → paga → Mercado Pago avisa
// al webhook → se registra la venta en `ingresos`, el lead pasa a GANADO y
// clasit-backend-api (andesback) genera y envía certificado + carnet por correo.
//
// El documento viaja como external_reference: es lo que une el pago con el lead.

const BUSINESS_ID    = Number(process.env.MP_BUSINESS_ID) || 3; // CertiTec en el CRM
const SITE_URL       = (process.env.MP_SITE_URL    || 'https://www.certitecol.com').replace(/\/+$/, '');
const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || 'https://controla-570877385695.northamerica-northeast1.run.app').replace(/\/+$/, '');
const DOCS_API_URL   = (process.env.DOCS_API_URL   || 'https://clasit-backend-api-570877385695.us-central1.run.app').replace(/\/+$/, '');
const ALERT_URL      = process.env.MP_ALERT_WEBHOOK_URL || ''; // opcional: n8n/Telegram para los casos a revisar

const EMAIL_RE     = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOCUMENTO_RE = /^[0-9A-Z]{4,15}$/;

// El landing guarda el documento tal como lo escribe el cliente; aquí se compara
// sin puntos, espacios ni guiones para que "1.234.567" y "1234567" sean el mismo.
const normalizarDocumento = (valor) => String(valor ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

const esEmail = (valor) => EMAIL_RE.test(String(valor || '').trim());

// Fecha YYYY-MM-DD en hora de Colombia (la que se imprime en certificado y carnet).
const fechaBogota = (fecha) => fecha.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

/** Lead más reciente de CertiTec con ese documento (prefiere el que tenga correo). */
const buscarLead = async (documento) => {
    const filas = await prisma.$queryRaw`
        SELECT id, nombre, tipo_documento, numero_documento, email, telefono, estado, notas
        FROM crm_leads
        WHERE business_id = ${BUSINESS_ID}
          AND UPPER(regexp_replace(COALESCE(numero_documento, ''), '[^0-9A-Za-z]', '', 'g')) = ${documento}
        ORDER BY (COALESCE(email, '') <> '') DESC, created_at DESC
        LIMIT 1
    `;
    return filas[0] || null;
};

/** Aviso opcional para los pagos que alguien tiene que revisar a mano. */
const alertar = (datos) => {
    console.warn('[MP] Revisar pago:', JSON.stringify(datos));
    if (!ALERT_URL) return;
    fetch(ALERT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evento: 'mp_pago_revisar', ...datos }),
        signal: AbortSignal.timeout(5000),
    }).catch((err) => console.error('[MP] No se pudo enviar la alerta:', err.message));
};

/** Pide a clasit-backend-api (andesback) que genere y envíe certificado + carnet. */
const enviarDocumentos = async (datos) => {
    const res = await fetch(`${DOCS_API_URL}/api/enviar-documentos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos),
        // Mercado Pago corta el webhook a los ~22 s; si andesback tarda más se
        // marca ERROR y el reintento de Mercado Pago lo vuelve a intentar.
        signal: AbortSignal.timeout(18000),
    });
    if (!res.ok) {
        const detalle = (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(`enviar-documentos → HTTP ${res.status}: ${detalle}`);
    }
};

// ==========================================
// 1. CREAR LINK DE PAGO (PÚBLICO)
// ==========================================
// POST /api/pagos/mp/preferencia  { numeroDocumento, producto?, email? }
// `email` es el correo que el cliente ve (y puede corregir) en el checkout; viaja
// en la metadata del pago y es el primero que se usa para enviar los documentos.
export const crearPreferenciaMP = async (req, res) => {
    try {
        const documento = normalizarDocumento(req.body?.numeroDocumento);
        const codigo    = req.body?.producto || 'bpm';
        const producto  = PRODUCTOS_MP[codigo];

        if (!DOCUMENTO_RE.test(documento)) {
            return res.status(400).json({ code: 'DOCUMENTO_INVALIDO', message: 'Número de documento inválido.' });
        }
        if (!producto) {
            return res.status(400).json({ code: 'PRODUCTO_INVALIDO', message: 'Producto no disponible.' });
        }

        // Sin lead no habría a quién entregarle el certificado: se exige antes de cobrar.
        const lead = await buscarLead(documento);
        if (!lead) {
            return res.status(404).json({
                code: 'LEAD_NO_ENCONTRADO',
                message: 'No encontramos un examen aprobado con ese documento.',
            });
        }

        const email = [req.body?.email, lead.email].find(esEmail)?.trim() || null;

        const preferencia = await crearPreferencia({
            items: [{
                id:          codigo,
                title:       producto.titulo,
                quantity:    1,
                unit_price:  producto.precio,
                currency_id: 'COP',
            }],
            payer: { name: lead.nombre, ...(email && { email }) },
            external_reference:   documento,
            statement_descriptor: 'CERTITEC',
            // source_news=webhooks: solo avisos en formato Webhooks (firmados), sin los IPN viejos.
            notification_url: `${PUBLIC_API_URL}/api/pagos/mp/webhook?source_news=webhooks`,
            back_urls: {
                success: `${SITE_URL}/servicios/pago-mercadopago.html`,
                pending: `${SITE_URL}/servicios/pago-mercadopago.html`,
                failure: `${SITE_URL}/servicios/pago-mercadopago.html`,
            },
            auto_return: 'approved',
            metadata: { producto: codigo, lead_id: lead.id, email },
        });

        return res.status(201).json({ init_point: preferencia.init_point, preference_id: preferencia.id });
    } catch (error) {
        console.error('[MP] Error creando preferencia:', error);
        return res.status(502).json({ code: 'MP_ERROR', message: 'No pudimos generar el link de pago. Intenta de nuevo.' });
    }
};

// ==========================================
// 2. PROCESAR UN PAGO (núcleo del webhook)
// ==========================================
// Idempotente: payment_id es UNIQUE y el pago se "reclama" con un UPDATE atómico,
// así que dos avisos simultáneos del mismo pago no entregan dos veces.
// `forzar` (solo desde el reproceso manual) vuelve a intentar SIN_LEAD / SIN_CORREO
// y salta el control de monto en MONTO_DISTINTO.
const procesarPago = async (paymentId, { forzar = false } = {}) => {
    const pago      = await obtenerPago(paymentId);
    const id        = String(pago.id);
    const documento = normalizarDocumento(pago.external_reference);
    const codigo    = PRODUCTOS_MP[pago.metadata?.producto] ? pago.metadata.producto : 'bpm';
    const producto  = PRODUCTOS_MP[codigo];
    const monto     = Number(pago.transaction_amount);

    await prisma.$executeRaw`
        INSERT INTO mp_pagos (payment_id, external_reference, producto, status, status_detail,
                              monto, moneda, payer_email, raw)
        VALUES (${id}, ${documento}, ${codigo}, ${pago.status ?? null}, ${pago.status_detail ?? null},
                ${Number.isFinite(monto) ? monto : null}, ${pago.currency_id ?? null},
                ${pago.payer?.email || null}, ${JSON.stringify(pago)}::jsonb)
        ON CONFLICT (payment_id) DO UPDATE SET
            status        = EXCLUDED.status,
            status_detail = EXCLUDED.status_detail,
            raw           = EXCLUDED.raw,
            updated_at    = NOW()
    `;

    if (pago.status !== 'approved') {
        console.log(`[MP] Pago ${id} en estado ${pago.status} (${pago.status_detail}); se espera a que se apruebe.`);
        return { payment_id: id, estado: 'NO_APROBADO', status: pago.status };
    }

    // PROCESANDO de más de 5 min = un intento que murió a mitad de camino.
    const reintentables = forzar
        ? Prisma.sql`estado_proceso IN ('RECIBIDO', 'ERROR', 'SIN_LEAD', 'SIN_CORREO', 'MONTO_DISTINTO')`
        : Prisma.sql`estado_proceso IN ('RECIBIDO', 'ERROR')`;
    const [registro] = await prisma.$queryRaw`
        UPDATE mp_pagos
        SET estado_proceso = 'PROCESANDO', intentos = intentos + 1, error = NULL, updated_at = NOW()
        WHERE payment_id = ${id}
          AND (${reintentables}
               OR (estado_proceso = 'PROCESANDO' AND updated_at < NOW() - INTERVAL '5 minutes'))
        RETURNING ingreso_id, correo_enviado_at, estado_proceso
    `;
    if (!registro) return { payment_id: id, estado: 'YA_PROCESADO' };

    const finalizar = (estado, datos = {}) => prisma.mp_pagos.update({
        where: { payment_id: id },
        data:  { estado_proceso: estado, ...datos, updated_at: new Date() },
    });

    try {
        if (!forzar && (pago.currency_id !== 'COP' || monto !== producto.precio)) {
            const error = `Monto recibido ${monto} ${pago.currency_id}; esperado ${producto.precio} COP`;
            await finalizar('MONTO_DISTINTO', { error });
            alertar({ payment_id: id, motivo: 'MONTO_DISTINTO', documento, detalle: error });
            return { payment_id: id, estado: 'MONTO_DISTINTO' };
        }

        const lead = await buscarLead(documento);
        if (!lead) {
            await finalizar('SIN_LEAD', { error: `Sin lead de CertiTec con documento ${documento}` });
            alertar({ payment_id: id, motivo: 'SIN_LEAD', documento, payer_email: pago.payer?.email || null });
            return { payment_id: id, estado: 'SIN_LEAD' };
        }

        const email = [pago.metadata?.email, lead.email, pago.payer?.email].find(esEmail)?.trim();
        if (!email) {
            await finalizar('SIN_CORREO', { lead_id: lead.id, error: 'Ni el pago ni el lead traen un correo válido' });
            alertar({ payment_id: id, motivo: 'SIN_CORREO', documento, lead_id: lead.id });
            return { payment_id: id, estado: 'SIN_CORREO' };
        }

        const ahora       = new Date();
        const vencimiento = new Date(ahora);
        vencimiento.setFullYear(vencimiento.getFullYear() + 1);
        const tipoDocumento = lead.tipo_documento || 'CC';

        // Paso 1 (una sola vez): venta en `ingresos` + lead GANADO.
        let ingresoId = registro.ingreso_id;
        if (!ingresoId) {
            const [nombre, ...resto] = String(lead.nombre).trim().split(/\s+/);

            const { ingreso, leadGanado } = await prisma.$transaction(async (tx) => {
                await tx.$executeRaw`
                    INSERT INTO "public"."personas" (
                        "tipo_documento", "numero_documento", "nombre", "apellido",
                        "celular", "direccion", "email", "tipo", "usuario", "business_id", "created_at", "updated_at"
                    ) VALUES (
                        ${tipoDocumento}, ${documento}, ${nombre}, ${resto.join(' ')},
                        ${lead.telefono || ''}, '', ${email}, 'CLIENTE', ${BUSINESS_ID}, ${BUSINESS_ID}, NOW(), NOW()
                    )
                    ON CONFLICT DO NOTHING
                `;
                const persona = await tx.personas.findFirst({
                    where:  { tipo_documento: tipoDocumento, numero_documento: documento, business_id: BUSINESS_ID },
                    select: { id: true },
                });

                const ingreso = await tx.ingresos.create({
                    data: {
                        legacyId:          uuidv4(),
                        nombre,
                        apellido:          resto.join(' '),
                        numeroDeDocumento: documento,
                        tipoDocumento,
                        fechaVencimiento:  vencimiento,
                        producto:          producto.producto,
                        descripcion:       `${producto.titulo} (Mercado Pago)`,
                        valor:             monto,
                        cuenta:            'Mercado Pago',
                        customer_email:    email,
                        payment_status:    'APPROVED',
                        payment_reference: `MP-${id}`,
                        usuario:           BUSINESS_ID,
                        business_id:       BUSINESS_ID,
                        persona_id:        persona?.id ?? null,
                        createdAt:         ahora,
                        updatedAt:         ahora,
                        v:                 '0',
                    },
                    select: { id: true },
                });

                const leadGanado = await tx.crm_leads.update({
                    where: { id: lead.id },
                    data: {
                        estado:     'GANADO',
                        notas:      [lead.notas, `Pagado por Mercado Pago #${id}`].filter(Boolean).join(' | '),
                        updated_at: ahora,
                    },
                });

                await tx.mp_pagos.update({
                    where: { payment_id: id },
                    data:  { lead_id: lead.id, ingreso_id: ingreso.id },
                });

                return { ingreso, leadGanado };
            });
            ingresoId = ingreso.id;

            // Meta Conversions API: Purchase, igual que cuando un asesor marca GANADO.
            // event_id fijo por pago para que Meta deduplique si esto se repite.
            if (lead.estado !== 'GANADO') {
                await sendLeadEvent({
                    lead:      leadGanado,
                    eventName: estadoToEventName('GANADO'),
                    eventId:   `mp-${id}`,
                });
            }
        }

        // Paso 2 (una sola vez): certificado + carnet por correo.
        if (!registro.correo_enviado_at) {
            await enviarDocumentos({
                nombre:            lead.nombre,
                numeroDocumento:   documento,
                tipoDocumento,
                email,
                intensidadHoraria: producto.intensidadHoraria,
                fechaExpedicion:   fechaBogota(ahora),
                fechaVencimiento:  fechaBogota(vencimiento),
            });
            await prisma.mp_pagos.update({
                where: { payment_id: id },
                data:  { correo_enviado_a: email, correo_enviado_at: new Date() },
            });
        }

        await finalizar('ENTREGADO', { lead_id: lead.id, ingreso_id: ingresoId });
        console.log(`[MP] Pago ${id} entregado: lead ${lead.id}, ingreso ${ingresoId}, correo ${email}`);
        return { payment_id: id, estado: 'ENTREGADO' };
    } catch (error) {
        await finalizar('ERROR', { error: String(error.message || error).slice(0, 1000) })
            .catch((e) => console.error('[MP] No se pudo marcar ERROR:', e.message));
        throw error;
    }
};

// ==========================================
// 3. WEBHOOK DE MERCADO PAGO (PÚBLICO)
// ==========================================
// POST /api/pagos/mp/webhook?data.id=123&type=payment
// Se procesa ANTES de responder: en Cloud Run la CPU se apaga al responder, así que
// el trabajo en segundo plano podría quedar a medias. Mercado Pago espera ~22 s y,
// si recibe un error, reintenta (el reintento retoma solo el paso que faltó).
export const webhookMP = async (req, res) => {
    const tipo      = req.body?.type || req.query.type || req.query.topic;
    const paymentId = String(req.query['data.id'] || req.body?.data?.id || '');

    // merchant_order y demás tópicos no se usan.
    if (tipo !== 'payment' || !paymentId) return res.sendStatus(200);

    const secret = process.env.MP_WEBHOOK_SECRET;
    if (secret) {
        const firmaValida = validarFirma({
            xSignature: req.headers['x-signature'],
            xRequestId: req.headers['x-request-id'],
            dataId:     req.query['data.id'] || paymentId,
            secret,
        });
        if (!firmaValida) {
            console.warn(`[MP] Firma inválida o ausente en aviso del pago ${paymentId}`);
            return res.sendStatus(401);
        }
    } else {
        console.warn('[MP] MP_WEBHOOK_SECRET no configurado: aviso procesado sin validar la firma');
    }

    try {
        const resultado = await procesarPago(paymentId);
        return res.status(200).json(resultado);
    } catch (error) {
        console.error(`[MP] Error procesando pago ${paymentId}:`, error);
        return res.sendStatus(500); // Mercado Pago reintenta
    }
};

// ==========================================
// 4. REPROCESAR UN PAGO (ADMIN, CON TOKEN)
// ==========================================
// POST /api/pagos/mp/reprocesar/:paymentId
// Para después de corregir un caso SIN_LEAD / SIN_CORREO, o para entregar uno
// MONTO_DISTINTO que ya se revisó. Nunca entrega dos veces un pago ENTREGADO.
export const reprocesarPagoMP = async (req, res) => {
    if (Number(req.user?.bid) !== BUSINESS_ID) {
        return res.status(403).json({ message: 'Solo disponible para el negocio de CertiTec' });
    }
    try {
        const resultado = await procesarPago(req.params.paymentId, { forzar: true });
        return res.status(200).json(resultado);
    } catch (error) {
        console.error(`[MP] Error reprocesando pago ${req.params.paymentId}:`, error);
        return res.status(500).json({ message: 'Error al reprocesar', error: error.message });
    }
};
