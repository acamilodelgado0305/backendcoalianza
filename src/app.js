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
import egresoRoutes from './routes/egresoRouter.js';

dotenv.config();

const app = express();

// --- CONFIGURACIÓN DEL PUERTO ---
// Usa el puerto del entorno (para Vercel u otros) o el 8080 para local
const PORT = process.env.PORT || 8080;

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
app.use('/api/v1/egresos', egresoRoutes);

// Conectar a la base de datos e iniciar el servidor
connectDB()
  .then(() => {
    console.log('✅ Conexión exitosa a MongoDB Atlas');
    
    // --- INICIA EL SERVIDOR PARA DESARROLLO LOCAL ---
    // Este bloque solo se ejecutará cuando corras el archivo directamente
    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
      console.log('Endpoints disponibles:');
      console.log(`   - Clientes (Ingresos): http://localhost:${PORT}/api/v1/clients`);
      console.log(`   - Egresos: http://localhost:${PORT}/api/v1/egresos`);
    });
  })
  .catch(error => {
    console.error('❌ Error al conectar a MongoDB:', error);
    process.exit(1);
  });

// Mantén esta línea. Vercel la usará y simplemente ignorará el app.listen().
export default app;