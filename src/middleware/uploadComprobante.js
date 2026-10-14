// Recibe el documento soporte de un ingreso/egreso (campo del formulario: name="archivo").
import multer from 'multer';
import {
    COMPROBANTE_MAX_MB,
    TIPOS_COMPROBANTE,
    contenidoCoincideConTipo,
} from '../services/gcsComprobantes.js';

const MENSAJE_TIPO = 'Solo se aceptan archivos PDF o imágenes (JPG, PNG o WEBP)';

const multerComprobante = multer({
    storage: multer.memoryStorage(), // va directo a GCS sin tocar el disco
    limits: { fileSize: COMPROBANTE_MAX_MB * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        if (TIPOS_COMPROBANTE[file.mimetype]) return cb(null, true);
        cb(Object.assign(new Error(MENSAJE_TIPO), { status: 400 }));
    },
}).single('archivo');

// Envuelve multer para responder 400 con un mensaje claro en vez de un 500.
export const recibirComprobante = (req, res, next) => multerComprobante(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: `El archivo pasa de ${COMPROBANTE_MAX_MB} MB` });
    }
    if (err) return res.status(err.status || 400).json({ message: err.message || 'No se pudo leer el archivo' });
    if (!req.file) return res.status(400).json({ message: 'Adjunta un PDF o una imagen' });
    if (!contenidoCoincideConTipo(req.file.buffer, req.file.mimetype)) {
        return res.status(400).json({ message: `El archivo está dañado o no es lo que dice ser. ${MENSAJE_TIPO}` });
    }
    next();
});
