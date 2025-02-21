import mongoose from 'mongoose';

// Definir el esquema para el cliente
const clientSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: true,
    },
    apellido: {
      type: String,
      required: true,
    },
    numeroDeDocumento: {
      type: Number,
      required: [true, 'El número de documento es obligatorio'],
      unique: true, // Asegura que no haya duplicados
    },
    fechaVencimiento: {
      type: Date,
      default: function () {
        const currentDate = new Date();
        currentDate.setFullYear(currentDate.getFullYear() + 1); // Sumar 1 año
        return currentDate;
      },
    },
    tipo: {
      type: [String], // Campo tipo como un array de strings
      default: [],    // Valor predeterminado: array vacío
    },
  },
  {
    timestamps: true, // Agrega createdAt y updatedAt automáticamente
  }
);

// Crear el modelo de Mongoose para el cliente
const Client = mongoose.model('Client', clientSchema);
export default Client;