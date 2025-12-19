// src/services/gcsPaymentReceipts.js
import { Storage } from "@google-cloud/storage";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

// 💡 REUTILIZAMOS TU BUCKET ACTUAL PARA NO COMPLICAR LA CONFIGURACIÓN
// Si en el futuro quieres otro bucket, cambias esta variable.
const storage = new Storage(); // Toma credenciales de GOOGLE_APPLICATION_CREDENTIALS
const bucketName = process.env.GCS_STUDENTS_BUCKET_NAME || process.env.GCS_BUCKET_NAME;

if (!bucketName) {
  console.warn("[GCS] WARNING: Nombre del Bucket no definido en .env");
}

const receiptBucket = storage.bucket(bucketName);

/**
 * 📤 Sube un comprobante de pago a GCS
 * Carpeta destino: /pagos/{numeroDocumento}/...
 */
export const uploadReceiptToGCS = async (
  fileBuffer,
  { filename, mimetype, numeroDocumento }
) => {
  if (!bucketName) {
    throw new Error("GCS BUCKET NAME no está configurado");
  }

  // 1. Limpieza de nombre
  const ext = path.extname(filename) || ".jpg";
  const safeName = path.basename(filename, ext).replace(/[^\w\d-_]/g, "_");
  const randomSlug = crypto.randomBytes(4).toString("hex");

  // 2. Definir ruta: Carpeta 'pagos' -> Carpeta del Usuario -> Archivo
  const gcsFileName = `pagos/${numeroDocumento}/${Date.now()}-${safeName}-${randomSlug}${ext}`;
  const file = receiptBucket.file(gcsFileName);

  // 3. Subir el archivo
  await file.save(fileBuffer, {
    contentType: mimetype,
    resumable: false,
    metadata: {
      // Cache de 1 año (opcional, pero bueno para imágenes estáticas)
      cacheControl: "public, max-age=31536000",
    },
  });

  // 4. Generar URL Pública
  // (Asumiendo que tu bucket permite lectura pública o usas URLs firmadas. 
  // Si es UBLA público, esto funciona directo).
  const publicUrl = `https://storage.googleapis.com/${bucketName}/${gcsFileName}`;

  console.log(`[GCS] Comprobante subido: ${publicUrl}`);
  return publicUrl; 
};