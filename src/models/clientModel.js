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
      unique: true,
    },
    fechaVencimiento: {
      type: Date,
      default: function () {
        const currentDate = new Date();
        currentDate.setFullYear(currentDate.getFullYear() + 1);
        return currentDate;
      },
    },
    tipo: {
      type: [String],
      default: [],
    },
    // Nuevo campo agregado
    vendedor: {
      type: String,
      required: [true, 'El vendedor es obligatorio'],
      trim: true, // Elimina espacios al inicio y final
      maxlength: [50, 'El nombre del vendedor no puede superar 50 caracteres']
    },
  },
  {
    timestamps: true,
  }
);

// Crear el modelo de Mongoose para el cliente
const Client = mongoose.model('Client', clientSchema);
export default Client;