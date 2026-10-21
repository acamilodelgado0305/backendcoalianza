import crypto from 'crypto';
import prisma from '../prisma.js';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { sendLeadEvent, estadoToEventName } from '../services/metaConversions.js';

// Pagos por Nequi Negocios de CertiTec.
//
// n8n solo lee el correo de notificación de Nequi (notificaciones@nequi.com.co),
// saca el documento del cliente ("Referencia1"), el monto y el código de Nequi, y
// llama a POST /api/pagos/nequi/confirmar con el id del correo de Gmail como
// `referencia` (un correo = un pago). Todo lo demás pasa aquí: el
// lead pasa a GANADO, se registra la venta en `ingresos` (cuenta Nequi), se manda
// el Purchase a Meta y andesback (clasit-backend-api) envía los documentos.

const BUSINESS_ID  = Number(process.env.NEQUI_BUSINESS_ID) || 3; // CertiTec en el CRM
const API_KEY      = process.env.NEQUI_WEBHOOK_SECRET || '';     // la manda n8n en x-api-key
const DOCS_API_URL = (process.env.DOCS_API_URL || 'https://clasit-backend-api-570877385695.us-central1.run.app').replace(/\/+$/, '');
const CUENTA       = 'Nequi';

// Lo que se cobra por Nequi. El monto pagado decide el curso —así se hacía a mano:
// hay clientes con un lead por cada curso, y el del curso pagado es el que pasa a
// GANADO—. El ítem del inventario decide qué queda en la venta y qué documentos
// salen por correo (send_mail / plantilla_correo / intensidad_horaria), igual que
// cuando se vende desde el CRM.
const PRODUCTOS_NEQUI = [
    { servicio: 'manipulacion-alimentos', precio: 25000, inventarioId: 2 },   // certificado + carnet
    { servicio: 'auxiliar-bodega',        precio: 50000, inventarioId: 149 }, // diploma + certificado
];

const DOCUMENTO_RE  = /^[0-9A-Z]{4,15}$/;
const REFERENCIA_RE = /^[0-9A-Za-z_.:-]{1,60}$/;
const EMAIL_RE      = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// El landing guarda el documento tal como lo escribe el cliente; aquí se compara
// sin puntos, espacios ni guiones para que "1.234.567" y "1234567" sean el mismo.
const normalizarDocumento = (valor) => String(valor ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

const esEmail = (valor) => EMAIL_RE.test(String(valor || '').trim());

// Fecha YYYY-MM-DD en hora de Colombia (la que se imprime en los documentos).
const fechaBogota = (fecha) => fecha.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

/**
 * Lead más reciente de CertiTec con ese documento (prefiere el que tenga correo).
 * Hay clientes que hacen los dos cursos y tienen un lead por cada uno: con
 * `servicioPreferido` gana el lead del curso que se pagó.
 */
const buscarLead = async (documento, servicioPreferido = null) => {
    const filas = await prisma.$queryRaw`
        SELECT id, nombre, tipo_documento, numero_documento, email, telefono, estado, notas,
               persona_id, servicio, valor_estimado, fbc, fbp
        FROM crm_leads
        WHERE business_id = ${BUSINESS_ID}
          AND UPPER(regexp_replace(COALESCE(numero_documento, ''), '[^0-9A-Za-z]', '', 'g')) = ${documento}
        ORDER BY (servicio = ${servicioPreferido}) IS TRUE DESC,
                 (COALESCE(email, '') <> '') DESC,
                 created_at DESC
        LIMIT 1
    `;
    return filas[0] || null;
};

/** Pide a andesback que genere y envíe los documentos del curso por correo. */
const enviarCorreoDocumentos = async (endpoint, datos) => {
    const res = await fetch(`${DOCS_API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos),
        signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) {
        const detalle = (await res.text().catch(() => '')).slice(0, 300);
        throw new Error(`${endpoint.replace('/api/', '')} → HTTP ${res.status}: ${detalle}`);
    }
};

const claveValida = (recibida) => {
    const a = Buffer.from(String(recibida || ''));
    const b = Buffer.from(API_KEY);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// n8n manda un número; si llega como texto se lee en formato colombiano
// ("$25.000" o "25.000,00").
const leerMonto = (valor) => {
    if (typeof valor === 'number') return valor;
    const limpio = String(valor ?? '').replace(/[^\d,]/g, '').replace(',', '.');
    return limpio ? Number(limpio) : NaN;
};


// Días de calendario de Colombia representados a mediodía UTC: así sumar o restar
// días y meses nunca salta de fecha por la zona horaria.
const dia = (anio, mes, dd) => new Date(Date.UTC(anio, mes, dd, 12));
const iso = (f) => f.toISOString().slice(0, 10);

// Expedición de los documentos (las dos plantillas): el día en que llegó el pago,
// pero nunca domingo — un pago del domingo se expide el sábado.
const diaDeExpedicion = (fechaVenta) => {
    const [y, m, d] = fechaBogota(fechaVenta).split('-').map(Number);
    const expedicion = dia(y, m - 1, d);
    if (expedicion.getUTCDay() === 0) expedicion.setUTCDate(expedicion.getUTCDate() - 1);
    return expedicion;
};

// Fechas del diploma de acreditación (Auxiliar de Bodega):
//   · expedición: diaDeExpedicion
//   · fin: el día antes de la expedición, para que no figure terminando el mismo
//     día en que se expide
//   · inicio: un mes calendario antes del fin (19 sep → 19 oct; si ese día no
//     existe en el mes anterior, el último día de ese mes: 31 mar → 28/29 feb)
const periodoAcreditacion = (fechaVenta) => {
    const expedicion = diaDeExpedicion(fechaVenta);
    const fin = dia(expedicion.getUTCFullYear(), expedicion.getUTCMonth(), expedicion.getUTCDate() - 1);
    const ultimoDelMesAnterior = dia(fin.getUTCFullYear(), fin.getUTCMonth(), 0).getUTCDate();
    const inicio = dia(fin.getUTCFullYear(), fin.getUTCMonth() - 1, Math.min(fin.getUTCDate(), ultimoDelMesAnterior));

    return { fechaInicio: iso(inicio), fechaFin: iso(fin), fechaExpedicion: iso(expedicion) };
};

// Mismas plantillas que andesfront (components/Certificados/envioDocumentos.js):
//   · 'alimentos'    → certificado + carnet  (10 h si el ítem no trae horas), expedido
//     en diaDeExpedicion y con el carnet vencido un año después
//   · 'acreditacion' → diploma + certificado (40 h), fechas de periodoAcreditacion
const construirCorreo = (item, cliente, fechaVenta) => {
    if (item.plantilla_correo === 'acreditacion') {
        return {
            endpoint: '/api/enviar-acreditacion',
            body: {
                ...cliente,
                curso:             item.nombre,
                intensidadHoraria: item.intensidad_horaria || '40',
                ...periodoAcreditacion(fechaVenta),
            },
        };
    }

    // El carnet vence un año después de la expedición.
    const expedicion = diaDeExpedicion(fechaVenta);
    const vencimiento = dia(expedicion.getUTCFullYear() + 1, expedicion.getUTCMonth(), expedicion.getUTCDate());
    return {
        endpoint: '/api/enviar-documentos',
        body: {
            ...cliente,
            intensidadHoraria: item.intensidad_horaria || '10',
            fechaExpedicion:   iso(expedicion),
            fechaVencimiento:  iso(vencimiento),
        },
    };
};

// ==========================================
// 1. PROCESAR UN PAGO
// ==========================================
// Idempotente: referencia es UNIQUE y el pago se "reclama" con un UPDATE atómico.
// Cada paso queda marcado (ingreso_id, capi_estado, correo_enviado_at), así que un
// reintento solo hace lo que faltó.
// `forzar` (solo desde el reproceso manual) vuelve a intentar MONTO_DISTINTO y
// YA_REGISTRADO, y los ENTREGADO a los que les quedó pendiente el Purchase.
const procesarPagoNequi = async (referencia, { forzar = false } = {}) => {
    // PROCESANDO de más de 5 min = un intento que murió a mitad de camino.
    const reintentables = forzar
        ? Prisma.sql`(estado_proceso IN ('RECIBIDO', 'ERROR', 'SIN_LEAD', 'SIN_CORREO', 'MONTO_DISTINTO', 'YA_REGISTRADO')
                      OR (estado_proceso = 'ENTREGADO' AND capi_estado = 'PENDIENTE'))`
        : Prisma.sql`estado_proceso IN ('RECIBIDO', 'ERROR', 'SIN_LEAD', 'SIN_CORREO')`;
    const [pago] = await prisma.$queryRaw`
        UPDATE nequi_pagos
        SET estado_proceso = 'PROCESANDO', intentos = intentos + 1, error = NULL, updated_at = NOW()
        WHERE referencia = ${referencia}
          AND (${reintentables}
               OR (estado_proceso = 'PROCESANDO' AND updated_at < NOW() - INTERVAL '5 minutes'))
        RETURNING documento, monto, lead_id, inventario_id, ingreso_id, capi_estado, correo_enviado_at, created_at,
                  raw->>'referencia_nequi' AS referencia_nequi
    `;
    if (!pago) {
        const actual = await prisma.nequi_pagos.findUnique({
            where:  { referencia },
            select: { estado_proceso: true, lead_id: true, ingreso_id: true },
        });
        return {
            referencia,
            estado:          'YA_PROCESADO',
            estado_anterior: actual?.estado_proceso ?? null,
            lead_id:         actual?.lead_id ?? null,
            ingreso_id:      actual?.ingreso_id ?? null,
        };
    }

    const finalizar = (estado, datos = {}) => prisma.nequi_pagos.update({
        where: { referencia },
        data:  { estado_proceso: estado, ...datos, updated_at: new Date() },
    });

    const documento = pago.documento;
    const monto     = Number(pago.monto);

    try {
        // 1. ¿Qué compró? El monto tiene que ser el precio de un curso (o el curso
        //    lo eligió alguien al reprocesar).
        const inventarioId = pago.inventario_id ?? PRODUCTOS_NEQUI.find((p) => p.precio === monto)?.inventarioId;
        if (!inventarioId) {
            const error = `Monto ${monto} no corresponde a ningún curso`;
            await finalizar('MONTO_DISTINTO', { error });
            return { referencia, estado: 'MONTO_DISTINTO', documento, valor: monto, detalle: error };
        }
        const servicio = PRODUCTOS_NEQUI.find((p) => p.inventarioId === inventarioId)?.servicio ?? null;

        // 2. ¿De quién es el pago? Si tiene un lead por curso, el del curso pagado.
        const lead = pago.lead_id
            ? await prisma.crm_leads.findUnique({ where: { id: pago.lead_id } })
            : await buscarLead(documento, servicio);
        if (!lead) {
            const error = `Sin lead de CertiTec con documento ${documento}`;
            await finalizar('SIN_LEAD', { inventario_id: inventarioId, error });
            return { referencia, estado: 'SIN_LEAD', documento, valor: monto, detalle: error };
        }

        const item = await prisma.inventario.findFirst({
            where:  { id: inventarioId, business_id: BUSINESS_ID },
            select: { id: true, nombre: true, send_mail: true, plantilla_correo: true, intensidad_horaria: true },
        });
        if (!item) throw new Error(`El ítem ${inventarioId} no existe en el inventario del negocio ${BUSINESS_ID}`);

        const email = esEmail(lead.email) ? lead.email.trim() : null;
        if (item.send_mail && !email) {
            const error = 'El lead no tiene un correo válido para enviar los documentos';
            await finalizar('SIN_CORREO', { lead_id: lead.id, inventario_id: item.id, error });
            return { referencia, estado: 'SIN_CORREO', documento, lead_id: lead.id, nombre: lead.nombre, detalle: error };
        }

        // 3. ¿Ya la registraron a mano? Mientras conviven el proceso manual y este,
        //    una venta del mismo documento y valor en los últimos 3 días se deja quieta.
        if (!pago.ingreso_id && !forzar) {
            const [previa] = await prisma.$queryRaw`
                SELECT id FROM ingresos
                WHERE business_id = ${BUSINESS_ID}
                  AND UPPER(regexp_replace(COALESCE("numeroDeDocumento", ''), '[^0-9A-Za-z]', '', 'g')) = ${documento}
                  AND valor = ${monto}::numeric
                  AND "createdAt" > NOW() - INTERVAL '3 days'
                ORDER BY "createdAt" DESC
                LIMIT 1
            `;
            if (previa) {
                const error = `Ya existe la venta #${previa.id} con ese documento y valor`;
                await finalizar('YA_REGISTRADO', { lead_id: lead.id, inventario_id: item.id, error });
                return { referencia, estado: 'YA_REGISTRADO', documento, lead_id: lead.id, nombre: lead.nombre, ingreso_id: previa.id, detalle: error };
            }
        }

        const tipoDocumento = lead.tipo_documento || 'CC';
        let ingresoId  = pago.ingreso_id;
        let capiEstado = pago.capi_estado;

        // 4. Una sola vez: cliente + venta + lead GANADO.
        if (!ingresoId) {
            const ahora = new Date();
            const vencimiento = new Date(ahora);
            vencimiento.setFullYear(vencimiento.getFullYear() + 1);
            const [nombre, ...resto] = String(lead.nombre).trim().split(/\s+/);
            const apellido = resto.join(' ');
            const legacyId = uuidv4();
            // Si el lead ya estaba GANADO, Meta ya recibió su Purchase cuando lo marcaron.
            capiEstado = lead.estado === 'GANADO' ? 'OMITIDO' : 'PENDIENTE';

            const ingreso = await prisma.$transaction(async (tx) => {
                let persona = lead.persona_id
                    ? await tx.personas.findFirst({ where: { id: lead.persona_id, business_id: BUSINESS_ID }, select: { id: true } })
                    : null;
                if (!persona) {
                    [persona] = await tx.$queryRaw`
                        SELECT id FROM personas
                        WHERE business_id = ${BUSINESS_ID}
                          AND UPPER(regexp_replace(COALESCE(numero_documento, ''), '[^0-9A-Za-z]', '', 'g')) = ${documento}
                        ORDER BY id
                        LIMIT 1
                    `;
                }
                if (!persona) {
                    await tx.$executeRaw`
                        INSERT INTO "public"."personas" (
                            "tipo_documento", "numero_documento", "nombre", "apellido",
                            "celular", "direccion", "email", "tipo", "usuario", "business_id", "created_at", "updated_at"
                        ) VALUES (
                            ${tipoDocumento}, ${documento}, ${nombre.slice(0, 100)}, ${apellido.slice(0, 100)},
                            ${String(lead.telefono || '').slice(0, 20)}, '', ${email}, 'CLIENTE', ${BUSINESS_ID}, ${BUSINESS_ID}, NOW(), NOW()
                        )
                        ON CONFLICT DO NOTHING
                    `;
                    persona = await tx.personas.findFirst({
                        where:  { tipo_documento: tipoDocumento, numero_documento: documento, business_id: BUSINESS_ID },
                        select: { id: true },
                    });
                }

                const ingreso = await tx.ingresos.create({
                    data: {
                        legacyId,
                        nombre,
                        apellido,
                        numeroDeDocumento: documento,
                        tipoDocumento,
                        fechaVencimiento:  vencimiento,
                        producto:          item.nombre,
                        descripcion:       item.nombre,
                        valor:             monto,
                        cuenta:            CUENTA,
                        customer_email:    email || '',
                        payment_status:    'APPROVED',
                        payment_reference: `NEQUI-${referencia}`,
                        usuario:           BUSINESS_ID,
                        business_id:       BUSINESS_ID,
                        persona_id:        persona?.id ?? null,
                        createdAt:         ahora,
                        updatedAt:         ahora,
                        v:                 '0',
                    },
                    select: { id: true },
                });

                // Mismo detalle y descuento de inventario que una venta hecha a mano.
                await tx.ingreso_items.create({
                    data: { ingreso_id: legacyId, inventario_id: item.id, descripcion: item.nombre, cantidad: 1, precio_unitario: monto },
                });
                await tx.inventario.updateMany({
                    where: { id: item.id, business_id: BUSINESS_ID },
                    data:  { cantidad: { decrement: 1 } },
                });

                await tx.crm_leads.update({
                    where: { id: lead.id },
                    data: {
                        estado:     'GANADO',
                        persona_id: persona?.id ?? lead.persona_id ?? null,
                        notas:      [lead.notas, `Pagado por Nequi (ref ${pago.referencia_nequi || referencia})`].filter(Boolean).join(' | '),
                        updated_at: ahora,
                    },
                });

                await tx.nequi_pagos.update({
                    where: { referencia },
                    data:  { lead_id: lead.id, inventario_id: item.id, ingreso_id: ingreso.id, capi_estado: capiEstado },
                });

                return ingreso;
            }, { timeout: 15000, maxWait: 5000 });
            ingresoId = ingreso.id;
        }

        // 5. Purchase a Meta con el valor realmente pagado. event_id fijo por pago:
        //    si esto se repite, Meta lo deduplica.
        if (capiEstado === 'PENDIENTE') {
            const capi = await sendLeadEvent({
                lead:      { ...lead, valor_estimado: monto },
                eventName: estadoToEventName('GANADO'),
                servicio:  servicio ?? undefined, // content_ids del curso pagado, no el del lead
                eventId:   `nequi-${referencia}`,
            });
            capiEstado = capi.ok ? 'ENVIADO' : capi.skipped ? 'OMITIDO' : 'PENDIENTE';
            await prisma.nequi_pagos.update({ where: { referencia }, data: { capi_estado: capiEstado } });
        }

        // 6. Una sola vez: los documentos del curso por correo, si el ítem los manda.
        //    Las fechas salen del día en que llegó el pago, no del reintento.
        if (item.send_mail && !pago.correo_enviado_at) {
            const { endpoint, body } = construirCorreo(
                item,
                { nombre: lead.nombre, numeroDocumento: documento, tipoDocumento, email },
                pago.created_at,
            );
            await enviarCorreoDocumentos(endpoint, body);
            await prisma.nequi_pagos.update({
                where: { referencia },
                data:  { correo_enviado_a: email, correo_enviado_at: new Date() },
            });
        }

        await finalizar('ENTREGADO', { lead_id: lead.id, inventario_id: item.id, ingreso_id: ingresoId });
        console.log(`[Nequi] Pago ${referencia} entregado: lead ${lead.id}, ingreso ${ingresoId}, capi ${capiEstado}`);
        return {
            referencia,
            estado:     'ENTREGADO',
            documento,
            lead_id:    lead.id,
            nombre:     lead.nombre,
            ingreso_id: ingresoId,
            producto:   item.nombre,
            valor:      monto,
            correo:     item.send_mail ? email : null,
            capi:       capiEstado,
        };
    } catch (error) {
        await finalizar('ERROR', { error: String(error.message || error).slice(0, 1000) })
            .catch((e) => console.error('[Nequi] No se pudo marcar ERROR:', e.message));
        throw error;
    }
};

// ==========================================
// 2. CONFIRMAR UN PAGO (LO LLAMA n8n)
// ==========================================
// POST /api/pagos/nequi/confirmar   header x-api-key: NEQUI_WEBHOOK_SECRET
// { referencia, documento, monto, estado, fecha? }
// `estado` es el "Estado:" del correo de Nequi. Solo APROBADA se procesa: Nequi
// manda el mismo correo, con monto y Referencia1, también para las RECHAZADAS.
// Responde 200 con `estado` para todo lo que se pudo decidir (ENTREGADO,
// YA_PROCESADO, SIN_LEAD, SIN_CORREO, MONTO_DISTINTO, YA_REGISTRADO, NO_APROBADO)
// y 500 con estado ERROR si algo falló a mitad de camino (reenviarlo retoma lo que faltó).
export const confirmarPagoNequi = async (req, res) => {
    // Este endpoint entrega certificados: sin clave configurada no se abre.
    if (!API_KEY) {
        console.error('[Nequi] NEQUI_WEBHOOK_SECRET no está configurado; se rechaza el aviso');
        return res.status(503).json({ message: 'Confirmación de pagos Nequi no configurada' });
    }
    if (!claveValida(req.headers['x-api-key'])) return res.sendStatus(401);

    const referencia = String(req.body?.referencia ?? '').trim();
    const documento  = normalizarDocumento(req.body?.documento);
    const monto      = leerMonto(req.body?.monto);
    const estadoPago = String(req.body?.estado ?? '').trim().toUpperCase();
    const fecha      = req.body?.fecha ? new Date(req.body.fecha) : null;

    if (!REFERENCIA_RE.test(referencia)) {
        return res.status(400).json({ code: 'REFERENCIA_INVALIDA', message: 'Referencia del pago inválida.' });
    }
    // Sin estado no se entrega nada: es preferible que un pago quede para revisar
    // a que una transacción rechazada reciba sus documentos.
    if (!estadoPago) {
        return res.status(400).json({ code: 'ESTADO_REQUERIDO', message: 'Falta el estado de la transacción (APROBADA/RECHAZADA).' });
    }
    if (estadoPago !== 'APROBADA') {
        console.log(`[Nequi] Aviso ${referencia} ignorado: transacción ${estadoPago}`);
        return res.status(200).json({ referencia, estado: 'NO_APROBADO', estado_nequi: estadoPago, detalle: `Transacción ${estadoPago} en Nequi` });
    }
    if (!DOCUMENTO_RE.test(documento)) {
        return res.status(400).json({ code: 'DOCUMENTO_INVALIDO', message: 'Número de documento inválido.' });
    }
    if (!(monto > 0)) {
        return res.status(400).json({ code: 'MONTO_INVALIDO', message: 'Monto inválido.' });
    }

    try {
        await prisma.$executeRaw`
            INSERT INTO nequi_pagos (referencia, documento, monto, fecha_pago, raw)
            VALUES (${referencia}, ${documento}, ${monto}, ${fecha && !isNaN(fecha) ? fecha : null},
                    ${JSON.stringify(req.body)}::jsonb)
            ON CONFLICT (referencia) DO NOTHING
        `;
        const resultado = await procesarPagoNequi(referencia);
        return res.status(200).json(resultado);
    } catch (error) {
        console.error(`[Nequi] Error procesando pago ${referencia}:`, error);
        return res.status(500).json({ referencia, estado: 'ERROR', detalle: error.message });
    }
};

// ==========================================
// 3. REPROCESAR UN PAGO (ADMIN, CON TOKEN)
// ==========================================
// POST /api/pagos/nequi/reprocesar/:referencia  { documento?, inventario_id? }
// Para después de revisar un caso: corregir el documento (cliente que escribió mal
// la cédula en Nequi), elegir el curso de un MONTO_DISTINTO, o entregar un
// YA_REGISTRADO que en realidad era otra compra. Nunca entrega dos veces.
export const reprocesarPagoNequi = async (req, res) => {
    if (Number(req.user?.bid) !== BUSINESS_ID) {
        return res.status(403).json({ message: 'Solo disponible para el negocio de CertiTec' });
    }
    const referencia = String(req.params.referencia || '').trim();

    try {
        const pago = await prisma.nequi_pagos.findUnique({ where: { referencia }, select: { ingreso_id: true } });
        if (!pago) return res.status(404).json({ message: 'Pago no encontrado' });

        const cambios = {};
        if (req.body?.documento !== undefined) {
            const documento = normalizarDocumento(req.body.documento);
            if (!DOCUMENTO_RE.test(documento)) return res.status(400).json({ message: 'Número de documento inválido.' });
            Object.assign(cambios, { documento, lead_id: null });
        }
        if (req.body?.inventario_id !== undefined) {
            const inventarioId = Number(req.body.inventario_id);
            if (!Number.isInteger(inventarioId) || inventarioId <= 0) return res.status(400).json({ message: 'inventario_id inválido.' });
            cambios.inventario_id = inventarioId;
        }
        if (Object.keys(cambios).length) {
            if (pago.ingreso_id) {
                return res.status(409).json({ message: 'La venta ya está registrada; ya no se puede cambiar el documento ni el curso.' });
            }
            await prisma.nequi_pagos.update({ where: { referencia }, data: cambios });
        }

        const resultado = await procesarPagoNequi(referencia, { forzar: true });
        return res.status(200).json(resultado);
    } catch (error) {
        console.error(`[Nequi] Error reprocesando pago ${referencia}:`, error);
        return res.status(500).json({ message: 'Error al reprocesar', error: error.message });
    }
};
