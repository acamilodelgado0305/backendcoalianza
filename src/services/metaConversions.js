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
// Se puede apagar por completo poniendo META_CAPI_ENABLED=false
const ENABLED = String(process.env.META_CAPI_ENABLED ?? "true").toLowerCase() !== "false";

if (ENABLED && !ACCESS_TOKEN) {
    console.warn("[MetaCAPI] WARNING: META_CAPI_ACCESS_TOKEN no está definido; los eventos NO se enviarán a Meta.");
}

// ─── Mapa: estado del CRM -> event_name en Meta ───────────────────────────────
// NUEVO usa 'Lead' para deduplicar con el Pixel del navegador (mismo event_name + event_id).
const ESTADO_EVENT_NAME = {
    NUEVO:      "Lead",
    CONTACTADO: "Contacted",
    CALIFICADO: "Qualified",
    PROPUESTA:  "Proposal",
    GANADO:     "Converted",
    PERDIDO:    "Disqualified",
};

/**
 * Traduce un estado del embudo del CRM al nombre de evento que espera Meta.
 * @param {string} estado
 * @returns {string}
 */
export const estadoToEventName = (estado) =>
    ESTADO_EVENT_NAME[String(estado || "").toUpperCase()] || "Lead";

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
 * @param {Object}  params.lead            - Registro del lead (nombre, email, telefono, numero_documento, fbc, fbp...)
 * @param {string}  params.eventName       - Nombre del evento en Meta (ver estadoToEventName)
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

        const event = {
            event_name: eventName,
            event_time: eventTime,
            action_source: actionSource,
            custom_data: {
                event_source: "crm",
                lead_event_source: LEAD_EVENT_SOURCE,
            },
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
