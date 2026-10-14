// src/services/gcsComprobantes.js
// Documento soporte (PDF o imagen) adjunto a un ingreso o un egreso:
// factura del proveedor, recibo, pantallazo de la transferencia, etc.
import { Storage } from "@google-cloud/storage";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const storage = new Storage(); // credenciales: GOOGLE_APPLICATION_CREDENTIALS en local, ADC en Cloud Run
const bucketName = process.env.GCS_BUCKET_NAME; // mismo bucket de las fotos de productos

if (!bucketName) {
    console.warn("[GCS] WARNING: GCS_BUCKET_NAME no está definido en .env");
}

const bucket = bucketName ? storage.bucket(bucketName) : null;

// Solo se borran objetos que este módulo creó: así reemplazar o eliminar un
// movimiento nunca toca, por ejemplo, el comprobante que llegó del formulario
// público de pago (carpeta pagos/).
const CARPETA = "comprobantes";
const PREFIJO_PROPIO = `https://storage.googleapis.com/${bucketName}/${CARPETA}/`;

export const COMPROBANTE_MAX_MB = 10;

// Tipo aceptado → extensión con la que se guarda. La extensión sale del tipo
// y no del nombre original, para que siempre coincidan.
export const TIPOS_COMPROBANTE = {
    "application/pdf": ".pdf",
    "image/jpeg":      ".jpg",
    "image/png":       ".png",
    "image/webp":      ".webp",
};

// El tipo lo declara el navegador; se confirma con los primeros bytes del
// archivo para no guardar algo que no es lo que dice ser.
export const contenidoCoincideConTipo = (buffer, mimetype) => {
    const ascii = (desde, hasta) => buffer.subarray(desde, hasta).toString("latin1");
    switch (mimetype) {
        case "application/pdf": return ascii(0, 5) === "%PDF-";
        case "image/jpeg":      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
        case "image/png":       return ascii(1, 4) === "PNG";
        case "image/webp":      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
        default:                return false;
    }
};

/**
 * 📤 Sube el documento y devuelve su URL pública.
 * Ruta: comprobantes/business-{id}/{ingresos|egresos}/{timestamp}-{aleatorio}.{ext}
 * El nombre aleatorio largo hace que la URL no se pueda adivinar; el nombre
 * original se conserva en Content-Disposition para cuando se descarga.
 */
export const uploadComprobanteToGCS = async ({ buffer, mimetype, originalname }, { businessId, tipo }) => {
    if (!bucket) throw new Error("GCS_BUCKET_NAME no está configurado");

    const ext = TIPOS_COMPROBANTE[mimetype];
    const aleatorio = crypto.randomBytes(16).toString("hex");
    const gcsPath = `${CARPETA}/business-${businessId}/${tipo}/${Date.now()}-${aleatorio}${ext}`;

    // multer entrega el nombre en latin1; se recodifica para no dañar tildes y eñes
    const nombreOriginal = Buffer.from(originalname || `documento${ext}`, "latin1").toString("utf8");

    await bucket.file(gcsPath).save(buffer, {
        contentType: mimetype,
        resumable: false,
        metadata: {
            cacheControl: "private, max-age=3600",
            contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(nombreOriginal)}`,
        },
    });

    return `https://storage.googleapis.com/${bucketName}/${gcsPath}`;
};

/**
 * 🗑️ Borra un documento subido por este módulo. Nunca lanza: si falla, el
 * movimiento ya quedó bien y solo sobra un archivo huérfano en el bucket.
 */
export const deleteComprobanteFromGCS = async (url) => {
    if (!bucket || !url || !url.startsWith(PREFIJO_PROPIO)) return;
    const gcsPath = url.slice(`https://storage.googleapis.com/${bucketName}/`.length);
    try {
        await bucket.file(gcsPath).delete({ ignoreNotFound: true });
    } catch (error) {
        console.warn("[GCS] No se pudo borrar el comprobante:", gcsPath, error.message);
    }
};
