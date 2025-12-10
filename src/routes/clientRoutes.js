// src/routes/egresoRoutes.js

import express from 'express';
import {
  getClientByCedula
} from '../controllers/clientController.js';

const router = express.Router();


router.get('/clients/:cedula', getClientByCedula);


export default router;