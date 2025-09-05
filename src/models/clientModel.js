import mongoose from 'mongoose';

// Definir el esquema para el cliente
const clientSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
     
      trim: true,
      maxlength: [100, 'El nombre no puede superar 100 caracteres'],
    },
    apellido: {
      type: String,
      
      trim: true,
      maxlength: [100, 'El apellido no puede superar 100 caracteres'],
    },
    numeroDeDocumento: {
      type: String, // Cambiado a String para mayor flexibilidad (puede incluir letras o guiones)
      trim: true,
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
      required: [true, 'Debe proporcionar al menos un concepto o servicio.'], // Es buena idea mantenerlo requerido
      default: [],
    },

    vendedor: {
      type: String,
      required: [true, 'El vendedor es obligatorio'],
      trim: true,
      maxlength: [50, 'El nombre del vendedor no puede superar 50 caracteres'],
    },
    valor: {
      type: Number,
      min: [0, 'El valor no puede ser negativo'],
    },
    cuenta: {
      type: String,
      
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Crear el modelo de Mongoose para el cliente
const Client = mongoose.model('Client', clientSchema);
export default Client;