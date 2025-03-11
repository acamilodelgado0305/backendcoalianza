import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import connectDB from './database.js'; 
import clientRoutes from './routes/clientRoutes.js'; 

dotenv.config();

const app = express();

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
app.use('/api/v1/clients', clientRoutes);

// Conectar a la base de datos
connectDB()
  .then(() => console.log('✅ Conexión exitosa a MongoDB Atlas'))
  .catch(error => {
    console.error('❌ Error al conectar a MongoDB:', error);
    process.exit(1);
  });

// ❌ Elimina app.listen() porque Vercel no lo usa
export default app;
