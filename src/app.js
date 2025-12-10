import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import connectDB from './database.js';
import ingresoRoutes from './routes/ingresoRoutes.js';
import egresoRoutes from './routes/egresoRoutes.js';

dotenv.config();

const PORT = process.env.PORT || 3001;
const app = express();

// Middlewares de seguridad y utilidades
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));
app.use(express.json());

// Ruta de prueba
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date(),
    environment: process.env.NODE_ENV
  });
});

// Rutas principales
app.use('/api/ingresos', ingresoRoutes);
app.use('/api/egresos', egresoRoutes);

// Conectar a la base de datos


// ❌ Elimina app.listen() porque Vercel no lo usa
export default app;