// src/services/gcsProductImages.js
import { Storage } from "@google-cloud/storage";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const storage = new Storage(); // usa GOOGLE_APPLICATION_CREDENTIALS por env
const productsBucketName = process.env.GCS_BUCKET_NAME; // Reutilizamos el bucket principal

if (!productsBucketName) {
    console.warn("[GCS] WARNING: GCS_BUCKET_NAME no está definido en .env");
}

const productsBucket = storage.bucket(productsBucketName);

/**
 * 📤 Sube una imagen de producto a GCS
 * @param {Buffer} fileBuffer - Buffer del archivo
 * @param {Object} options - Opciones con filename, mimetype, userId, productId
 * @returns {Promise<{publicUrl: string, gcsPath: string}>}
 */
export const uploadProductImageToGCS = async (
    fileBuffer,
    { filename, mimetype, userId, productId }
) => {
    if (!productsBucketName) {
        throw new Error("GCS_BUCKET_NAME no está configurado");
    }

    const ext = path.extname(filename) || ".jpg";
    const safeName = path.basename(filename, ext).replace(/[^\w\d-_]/g, "_");
    const randomSlug = crypto.randomBytes(6).toString("hex");

    // Organizamos las imágenes por usuario y producto
    const gcsFileName = `products/user-${userId}/${productId || 'new'}-${Date.now()}-${safeName}-${randomSlug}${ext}`;
    const file = productsBucket.file(gcsFileName);

    // Subimos el archivo a GCS
    await file.save(fileBuffer, {
        contentType: mimetype,
        resumable: false,
        metadata: {
            cacheControl: "public, max-age=31536000",
        },
    });

    // Generamos la URL pública
    const publicUrl = `https://storage.googleapis.com/${productsBucketName}/${gcsFileName}`;

    return { publicUrl, gcsPath: gcsFileName };
};

/**
 * 🗑️ Elimina una imagen de producto de GCS
 * @param {string} fileUrlOrPath - URL pública completa o ruta dentro del bucket
 * @returns {Promise<boolean>} true si se eliminó correctamente
 */
export const deleteProductImageFromGCS = async (fileUrlOrPath) => {
    if (!productsBucketName) {
        throw new Error("GCS_BUCKET_NAME no está configurado");
    }

    try {
        // Si viene la URL completa, extraemos el path dentro del bucket
        let gcsPath = fileUrlOrPath;

        if (fileUrlOrPath.includes("storage.googleapis.com")) {
            const parts = fileUrlOrPath.split(`${productsBucketName}/`);
            gcsPath = parts.length > 1 ? parts[1] : fileUrlOrPath;
        }

        if (!gcsPath) {
            console.warn("[GCS] No se encontró ruta válida para eliminar.");
            return false;
        }

        const file = productsBucket.file(gcsPath);
        await file.delete();

        console.log(`[GCS] Imagen de producto eliminada correctamente: ${gcsPath}`);
        return true;
    } catch (error) {
        if (error.code === 404) {
            console.warn("[GCS] Imagen no encontrada, posiblemente ya eliminada.");
            return true; // se considera éxito
        }
        console.error("[GCS] Error al eliminar imagen:", error.message);
        throw error;
    }
};
