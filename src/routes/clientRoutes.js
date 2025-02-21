// src/routes/clientRoutes.js

import express from 'express';
import {
  createClient,
  getClients,
  getClientByNumeroDeDocumento,
  updateClient,
  deleteClient
} from '../controllers/clientController.js';

const router = express.Router();

// Rutas para manejar clientes
router.post('/', createClient); // Crear un nuevo cliente
router.get('/', getClients); // Obtener todos los clientes
router.get('/:numeroDeDocumento', getClientByNumeroDeDocumento);
router.put('/:id', updateClient); // Actualizar un cliente por ID
router.delete('/:id', deleteClient); // Eliminar un cliente por ID

export default router;