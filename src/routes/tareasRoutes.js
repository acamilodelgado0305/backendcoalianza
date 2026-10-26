// src/routes/tareasRoutes.js — Tareas (tablero tipo Trello) + avisos al celular
import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { recibirComprobante } from '../middleware/uploadComprobante.js';
import {
    listarTableros, crearTablero, obtenerTablero, actualizarTablero, moverTablero, eliminarTablero,
    crearLista, actualizarLista, moverLista, eliminarLista,
    crearEtiqueta, actualizarEtiqueta, eliminarEtiqueta,
    listarTarjetas, crearTarjeta, obtenerTarjeta, actualizarTarjeta, moverTarjeta, copiarTarjeta, eliminarTarjeta,
    crearSubtareas, actualizarSubtarea, moverSubtarea, eliminarSubtarea, subtareaATarjeta,
    crearComentario, actualizarComentario, eliminarComentario,
    subirAdjunto, agregarEnlace, eliminarAdjunto,
    obtenerAvisos, actualizarAvisos, suscribirPush, desuscribirPush, probarPush, procesarAvisos,
} from '../controllers/tareasController.js';

const router = express.Router();

// Cron (Cloud Scheduler cada 5 min): recordatorios y resumen del día.
// Va ANTES del authMiddleware: se autentica con el header x-cron-secret.
router.post('/avisos/procesar', procesarAvisos);

router.use(authMiddleware);

// Proyectos (tableros)
router.get('/tableros', listarTableros);                 // ?archivados=1
router.post('/tableros', crearTablero);                  // { nombre, color, icono, plantilla }
router.get('/tableros/:id', obtenerTablero);             // listas + etiquetas + tarjetas (?archivadas=1)
router.put('/tableros/:id', actualizarTablero);
router.put('/tableros/:id/mover', moverTablero);         // { despues_de }
router.delete('/tableros/:id', eliminarTablero);         // solo archivados

// Listas (columnas)
router.post('/tableros/:id/listas', crearLista);
router.put('/listas/:id', actualizarLista);              // { nombre, es_final }
router.put('/listas/:id/mover', moverLista);             // { despues_de }
router.delete('/listas/:id', eliminarLista);             // ?mover_a=ID

// Etiquetas del proyecto
router.post('/tableros/:id/etiquetas', crearEtiqueta);
router.put('/etiquetas/:id', actualizarEtiqueta);
router.delete('/etiquetas/:id', eliminarEtiqueta);

// Tarjetas
router.get('/tarjetas', listarTarjetas);                 // todas las del negocio (?q, ?estado, ?tablero_id)
router.post('/listas/:id/tarjetas', crearTarjeta);
router.get('/tarjetas/:id', obtenerTarjeta);
router.put('/tarjetas/:id', actualizarTarjeta);
router.put('/tarjetas/:id/mover', moverTarjeta);         // { lista_id, despues_de }
router.post('/tarjetas/:id/copiar', copiarTarjeta);
router.delete('/tarjetas/:id', eliminarTarjeta);

// Subtareas
router.post('/tarjetas/:id/subtareas', crearSubtareas);  // { texto } (varias líneas = varias)
router.put('/subtareas/:id', actualizarSubtarea);
router.put('/subtareas/:id/mover', moverSubtarea);
router.post('/subtareas/:id/convertir', subtareaATarjeta);
router.delete('/subtareas/:id', eliminarSubtarea);

// Comentarios
router.post('/tarjetas/:id/comentarios', crearComentario);
router.put('/comentarios/:id', actualizarComentario);
router.delete('/comentarios/:id', eliminarComentario);

// Adjuntos (PDF/imagen a GCS) y enlaces
router.post('/tarjetas/:id/adjuntos', recibirComprobante, subirAdjunto);
router.post('/tarjetas/:id/enlaces', agregarEnlace);
router.delete('/adjuntos/:id', eliminarAdjunto);

// Avisos al celular (Web Push)
router.get('/avisos', obtenerAvisos);
router.put('/avisos', actualizarAvisos);                 // { activo, resumen_diario, hora_resumen }
router.post('/avisos/suscribir', suscribirPush);         // { suscripcion, dispositivo }
router.post('/avisos/desuscribir', desuscribirPush);     // { endpoint }
router.post('/avisos/probar', probarPush);

export default router;
