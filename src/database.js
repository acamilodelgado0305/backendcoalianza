import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

// Configuración de la URI de MongoDB desde .env
const dbURI = process.env.MONGODB_URI;

// Función de conexión a la base de datos
const connectDB = async () => {
  try {
    if (!dbURI) {
      throw new Error('MONGODB_URI no está definida en el archivo .env');
    }
    await mongoose.connect(dbURI);
    console.log('Conectado a MongoDB');
  } catch (error) {
    console.error('Error al conectar a MongoDB:', error.message);
    process.exit(1); // Detener la aplicación si la conexión falla
  }
};

export default connectDB;
