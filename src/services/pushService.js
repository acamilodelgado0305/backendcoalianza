// src/services/pushService.js
//
// NOTIFICACIONES AL CELULAR (Web Push)
// ------------------------------------
// Cómo funciona, de punta a punta:
//  1. En la app, el usuario acepta "Permitir notificaciones". El navegador del
//     celular le pide a SU servicio de push (Apple, Google o Mozilla) una
//     dirección única para ese dispositivo: la "suscripción" (endpoint + llaves).
//  2. La app manda esa suscripción aquí y se guarda en `push_suscripciones`.
//  3. Para avisar, este servidor firma el mensaje con las llaves VAPID (prueban
//     que el aviso viene de Rapictrl) y lo entrega en esa dirección. El servicio
//     de push lo hace llegar al teléfono aunque la app esté cerrada, y el
//     service worker (andesfront/public/sw.js) lo muestra.
//
// Llaves: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (se generan una sola vez con
// `npx web-push generate-vapid-keys`) y VAPID_SUBJECT (mailto: de contacto).
// Si cambian, todas las suscripciones guardadas dejan de servir.
import webpush from 'web-push';
import prisma from '../prisma.js';

let configurado = null;

export const pushDisponible = () => {
    if (configurado !== null) return configurado;
    const publica = process.env.VAPID_PUBLIC_KEY;
    const privada = process.env.VAPID_PRIVATE_KEY;
    if (!publica || !privada) {
        console.warn('[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY no están definidas: no se envían notificaciones');
        configurado = false;
        return false;
    }
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:soporte@rapictrl.com', publica, privada);
    configurado = true;
    return true;
};

export const clavePublicaPush = () => process.env.VAPID_PUBLIC_KEY || null;

/**
 * Envía un aviso a todos los dispositivos de esos usuarios.
 * payload: { title, body, url, tag } — lo lee el service worker.
 * Las suscripciones vencidas (el usuario desinstaló o quitó el permiso) se
 * borran solas: el servicio de push responde 404/410.
 * @returns {Promise<{ enviados: number, fallidos: number }>}
 */
export const enviarPushAUsuarios = async (userIds, payload) => {
    const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
    if (!ids.length || !pushDisponible()) return { enviados: 0, fallidos: 0 };

    const suscripciones = await prisma.push_suscripciones.findMany({ where: { user_id: { in: ids } } });
    const cuerpo = JSON.stringify(payload);
    let enviados = 0;
    let fallidos = 0;

    await Promise.all(suscripciones.map(async (s) => {
        try {
            await webpush.sendNotification(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                cuerpo,
                // TTL: si el celular está apagado, el aviso espera hasta 12 h.
                { TTL: 12 * 3600, urgency: 'high', topic: payload.tag ? String(payload.tag).slice(0, 32).replace(/[^\w-]/g, '') : undefined },
            );
            enviados += 1;
            await prisma.push_suscripciones.update({ where: { id: s.id }, data: { ultimo_envio_at: new Date() } });
        } catch (error) {
            fallidos += 1;
            if (error.statusCode === 404 || error.statusCode === 410) {
                await prisma.push_suscripciones.delete({ where: { id: s.id } }).catch(() => {});
            } else {
                console.warn('[push] No se pudo enviar a', s.id, error.statusCode || '', error.body || error.message);
            }
        }
    }));

    return { enviados, fallidos };
};
