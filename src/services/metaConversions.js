// src/services/metaConversions.js
// Integración con la API de conversiones de Meta (CAPI) para eventos de CRM.
// Envía los cambios de etapa de un lead a un conjunto de datos (dataset) de Meta.
// Docs: https://developers.facebook.com/docs/marketing-api/conversions-api
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

// ─── Configuración (todo desde .env, con valores por defecto seguros) ─────────
const DATASET_ID        = process.env.META_CAPI_DATASET_ID        || "639715789143642";
const ACCESS_TOKEN      = process.env.META_CAPI_ACCESS_TOKEN      || "";
const API_VERSION       = process.env.META_CAPI_API_VERSION       || "v25.0";
const LEAD_EVENT_SOURCE = process.env.META_CAPI_LEAD_EVENT_SOURCE || "QControla CRM";
const TEST_EVENT_CODE   = process.env.META_CAPI_TEST_EVENT_CODE   || ""; // solo para "Probar eventos"
const DEFAULT_CC        = process.env.META_CAPI_DEFAULT_COUNTRY_CODE || "57"; // Colombia
const CURRENCY          = process.env.META_CAPI_CURRENCY          || "COP"; // moneda para value
// Se puede apagar por completo poniendo META_CAPI_ENABLED=false
const ENABLED = String(process.env.META_CAPI_ENABLED ?? "true").toLowerCase() !== "false";

if (ENABLED && !ACCESS_TOKEN) {
    console.warn("[MetaCAPI] WARNING: META_CAPI_ACCESS_TOKEN no está definido; los eventos NO se enviarán a Meta.");
}

// ─── Mapa: estado del CRM -> event_name en Meta ───────────────────────────────
// NUEVO usa 'Lead' para deduplicar con el Pixel del navegador (mismo event_name + event_id).
// GANADO usa 'Purchase' (evento estándar de conversión): es la venta cerrada, la que
// Meta optimiza por ROAS. Se envía con value + currency (ver custom_data en sendLeadEvent).
const ESTADO_EVENT_NAME = {
    NUEVO:      "Lead",
    CONTACTADO: "Contacted",
    CALIFICADO: "Qualified",
    PROPUESTA:  "Proposal",
    GANADO:     "Purchase",
    PERDIDO:    "Disqualified",
};

/**
 * Traduce un estado del embudo del CRM al nombre de evento que espera Meta.
 * @param {string} estado
 * @returns {string}
 */
export const estadoToEventName = (estado) =>
    ESTADO_EVENT_NAME[String(estado || "").toUpperCase()] || "Lead";

// ─── Catálogo de servicios (cursos que se pautan) ─────────────────────────────
// Todos los eventos viajan al MISMO dataset con los mismos event_name estándar
// (Lead, Purchase...). Lo que separa un curso de otro es content_ids/content_name:
// en Ads Manager se crea una CONVERSIÓN PERSONALIZADA por curso filtrando por ese
// content_ids, y cada campaña optimiza contra la suya. Así los cursos no se cruzan
// ni en optimización ni en reportes, pero el pixel sigue acumulando señal conjunta.
//
// Para añadir un curso nuevo: una entrada aquí + su conversión personalizada en Meta.
const SERVICIOS = {
    "manipulacion-alimentos": {
        nombre:    "Manipulación de Alimentos",
        categoria: "Cursos",
        valor:     Number(process.env.META_CAPI_VALOR_MANIPULACION_ALIMENTOS) || 0,
    },
    "auxiliar-bodega": {
        nombre:    "Auxiliar de Bodega",
        categoria: "Cursos",
        valor:     Number(process.env.META_CAPI_VALOR_AUXILIAR_BODEGA) || 0,
    },
};

// Slug por defecto para leads que llegan sin 'servicio' (landings viejas que aún
// no envían el campo). Ponerlo vacío en .env desactiva la suposición.
const SERVICIO_DEFAULT = process.env.META_CAPI_SERVICIO_DEFAULT ?? "manipulacion-alimentos";

// Variantes de escritura que llegan de las landings o de carga manual en el CRM.
const ALIAS_SERVICIOS = {
    "manipulacion-de-alimentos": "manipulacion-alimentos",
    "manipulacion-alimentos":    "manipulacion-alimentos",
    "auxiliar-de-bodega":        "auxiliar-bodega",
    "auxiliar-bodega":           "auxiliar-bodega",
};

/** "Auxiliar de Bodega" / "auxiliar_de_bodega" -> "auxiliar-de-bodega" */
const slugify = (texto) =>
    String(texto || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quita acentos
        .trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

/**
 * Normaliza lo que venga (slug, nombre con acentos, alias) al slug del catálogo.
 * Devuelve null si no corresponde a ningún servicio conocido: mejor no marcar el
 * evento que marcarlo con un content_ids inventado que ninguna conversión captura.
 * @param {string} servicio
 * @returns {string|null}
 */
export const normalizarServicio = (servicio) => {
    const slug = slugify(servicio);
    if (!slug) return null;
    if (SERVICIOS[slug]) return slug;
    return ALIAS_SERVICIOS[slug] || null;
};

/** Lista de slugs válidos, para validar en los controladores. */
export const SERVICIOS_VALIDOS = Object.keys(SERVICIOS);

// ─── Helpers de normalización + hash SHA-256 ──────────────────────────────────
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const hashEmail = (email) => {
    const norm = String(email || "").trim().toLowerCase();
    return norm ? sha256(norm) : null;
};

const hashPhone = (phone) => {
    let digits = String(phone || "").replace(/\D/g, "");
    if (!digits) return null;
    // Número local colombiano de 10 dígitos -> anteponer código de país
    if (digits.length === 10) digits = DEFAULT_CC + digits;
    return sha256(digits);
};

const hashText = (text) => {
    const norm = String(text || "").trim().toLowerCase();
    return norm ? sha256(norm) : null;
};

/** Separa "Nombres Apellidos" en primer nombre / último apellido. */
const splitName = (fullName) => {
    const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { fn: null, ln: null };
    if (parts.length === 1) return { fn: parts[0], ln: null };
    return { fn: parts[0], ln: parts[parts.length - 1] };
};

/**
 * 📤 Envía un evento de estado de lead a la API de conversiones de Meta.
 * Nunca lanza: si algo falla, lo registra y devuelve { ok:false }.
 *
 * @param {Object}  params
 * @param {Object}  params.lead            - Registro del lead (nombre, email, telefono, numero_documento, fbc, fbp, servicio...)
 * @param {string}  params.eventName       - Nombre del evento en Meta (ver estadoToEventName)
 * @param {string} [params.servicio]       - Slug del curso; si se omite se usa lead.servicio
 * @param {number} [params.eventTime]      - Unix timestamp en segundos (default: ahora)
 * @param {string} [params.eventId]        - ID para deduplicar con el Pixel del navegador
 * @param {string} [params.fbc]            - Identificador de clic (_fbc) — prioridad más alta
 * @param {string} [params.fbp]            - Cookie del navegador (_fbp)
 * @param {string|number} [params.leadId]  - Lead ID generado por Meta (Lead Ads), opcional
 * @param {string} [params.clientIpAddress]
 * @param {string} [params.clientUserAgent]
 * @param {string} [params.actionSource]   - default 'system_generated'
 * @returns {Promise<{ok:boolean, skipped?:boolean, reason?:string, status?:number, response?:any, error?:string}>}
 */
export const sendLeadEvent = async ({
    lead,
    eventName,
    servicio,
    eventTime = Math.floor(Date.now() / 1000),
    eventId,
    fbc,
    fbp,
    leadId,
    clientIpAddress,
    clientUserAgent,
    actionSource = "system_generated",
} = {}) => {
    try {
        if (!ENABLED)      return { ok: false, skipped: true, reason: "disabled" };
        if (!ACCESS_TOKEN) return { ok: false, skipped: true, reason: "no_token" };
        if (!lead || !eventName) return { ok: false, skipped: true, reason: "missing_args" };

        const { fn, ln } = splitName(lead.nombre);

        // Información de cliente (todo en hash, salvo fbc/fbp/ip/ua que van en claro)
        const user_data = {};
        const em = hashEmail(lead.email);                if (em)  user_data.em = [em];
        const ph = hashPhone(lead.telefono);             if (ph)  user_data.ph = [ph];
        const fnH = hashText(fn);                         if (fnH) user_data.fn = [fnH];
        const lnH = hashText(ln);                         if (lnH) user_data.ln = [lnH];
        const ext = hashText(lead.numero_documento);      if (ext) user_data.external_id = [ext];

        const effFbc = fbc || lead.fbc;
        const effFbp = fbp || lead.fbp;
        if (leadId)           user_data.lead_id = Number(leadId) || leadId;
        if (effFbc)           user_data.fbc = effFbc;
        if (effFbp)           user_data.fbp = effFbp;
        if (clientIpAddress)  user_data.client_ip_address = clientIpAddress;
        if (clientUserAgent)  user_data.client_user_agent = clientUserAgent;

        const custom_data = {
            event_source: "crm",
            lead_event_source: LEAD_EVENT_SOURCE,
        };

        // Curso/servicio: es lo que separa un embudo de otro dentro del mismo dataset.
        // Las conversiones personalizadas de Ads Manager filtran por content_ids, así
        // que este bloque es el que evita que Manipulación de Alimentos y Auxiliar de
        // Bodega se mezclen en optimización y reportes.
        const slug = normalizarServicio(servicio || lead.servicio || SERVICIO_DEFAULT);
        const info = slug ? SERVICIOS[slug] : null;
        if (info) {
            custom_data.content_ids      = [slug];
            custom_data.content_name     = info.nombre;
            custom_data.content_category = info.categoria;
            custom_data.content_type     = "product";
        }

        // Valor + moneda: imprescindible para Purchase (ROAS), útil en cualquier evento.
        // El valor_estimado del lead manda; si viene en 0 se cae al precio de lista del
        // curso (META_CAPI_VALOR_*), para que el Purchase nunca llegue sin valor.
        const estimado = Number(lead.valor_estimado);
        const valor = Number.isFinite(estimado) && estimado > 0 ? estimado : (info?.valor || 0);
        if (valor > 0) {
            custom_data.value = valor;
            custom_data.currency = CURRENCY;
            if (eventName === "Purchase") custom_data.num_items = 1;
        }

        const event = {
            event_name: eventName,
            event_time: eventTime,
            action_source: actionSource,
            custom_data,
            user_data,
        };
        if (eventId) event.event_id = eventId;

        const body = { data: [event] };
        if (TEST_EVENT_CODE) body.test_event_code = TEST_EVENT_CODE;

        const url = `https://graph.facebook.com/${API_VERSION}/${DATASET_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`;

        const resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const json = await resp.json().catch(() => ({}));

        if (!resp.ok) {
            console.error(`[MetaCAPI] Error ${resp.status} enviando '${eventName}':`, JSON.stringify(json));
            return { ok: false, status: resp.status, response: json };
        }
        return { ok: true, response: json };
    } catch (err) {
        console.error("[MetaCAPI] Excepción enviando evento:", err.message);
        return { ok: false, error: err.message };
    }
};

/**
 * Extrae IP y User-Agent del cliente a partir del request de Express.
 * Útil para pasarlos como client_ip_address / client_user_agent.
 * @param {import('express').Request} req
 */
export const getClientMeta = (req) => ({
    clientIpAddress:
        (req.headers["x-forwarded-for"]?.split(",")[0] || "").trim() ||
        req.socket?.remoteAddress ||
        undefined,
    clientUserAgent: req.headers["user-agent"] || undefined,
});
