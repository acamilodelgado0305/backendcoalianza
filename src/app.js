import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import ingresoRoutes from './routes/ingresoRoutes.js';
import egresoRoutes from './routes/egresoRoutes.js';
import clientRoutes from './routes/clientRoutes.js';
import personRoutes from './routes/personRoutes.js';
import inventarioRoutes from './routes/inventarioRouter.js';
import pedidoRoutes from './routes/pedidoRoutes.js';
import documentoVentaRoutes from './routes/documentoVentaRoutes.js';
import cuentaPorPagarRoutes from './routes/cuentaPorPagarRoutes.js';
import crmLeadRoutes from './routes/crmLeadRoutes.js';

dotenv.config();

const PORT = process.env.PORT || 8080; // Google Cloud inyecta el puerto automáticamente aquí

const app = express();

app.use(helmet());
app.use(cors({
  credentials: true,
  origin: [
    'http://localhost:5173',
    'http://localhost:3002', // andesback puede llamar a auth-service
    'https://andesfront.onrender.com',
    'https://quickcontrola.com',
    'https://santasofia.vercel.app',
    'https://rapictrl.com',
    'https://www.certitecol.com',
    'https://www.validaciondebachillerato.com.co',
    'http://127.0.0.1:5501'
  ]
}));
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
app.use('/api/personas', personRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/pedidos', pedidoRoutes);
app.use('/api', clientRoutes);
app.use('/api/documentos-venta', documentoVentaRoutes);
app.use('/api/cuentas-por-pagar', cuentaPorPagarRoutes);
app.use('/api/crm/leads', crmLeadRoutes);

// Conectar a la base de datos


// ❌ Elimina app.listen() porque Vercel no lo usa
export default app;