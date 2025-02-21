import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import connectDB from './database.js'; // Asegúrate de que este archivo está configurado correctamente
import clientRoutes from './routes/clientRoutes.js'; 

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));
app.use(express.json());


app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'UP',
    timestamp: new Date(),
    environment: process.env.NODE_ENV
  });
});

const startServer = async () => {
  try {
    await connectDB();
    console.log('✅ Conexión exitosa a MongoDB Atlas');

    app.listen(PORT, () => {
      console.log(`✅ Servidor corriendo en puerto ${PORT}`);
    });

  } catch (error) {
    console.error('❌ Error al iniciar el servidor:', error);
    process.exit(1);
  }
};


app.use('/api/v1/clients', clientRoutes);

startServer();

export default app;