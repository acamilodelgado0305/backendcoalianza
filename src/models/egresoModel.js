import mongoose from 'mongoose';

// Definir el esquema para el egreso
const egresoSchema = new mongoose.Schema(
  {
    fecha: {
      type: Date,
      required: [true, 'La fecha es obligatoria'],
      default: Date.now, // Establece la fecha actual por defecto
    },
    valor: {
      type: Number,
      required: [true, 'El valor es obligatorio'],
      min: [0, 'El valor no puede ser negativo'],
    },
    cuenta: {
      type: String,
      required: [true, 'La cuenta es obligatoria'],
      trim: true,
    },
    descripcion: {
      type: String,
      required: [true, 'La descripción es obligatoria'],
      trim: true,
      maxlength: [500, 'La descripción no puede superar 500 caracteres'],
    },
    vendedor: {
        type: String,
        required: [true, 'El vendedor es obligatorio'],
        trim: true,
        maxlength: [50, 'El nombre del vendedor no puede superar 50 caracteres'],
      }
  },
  {
    timestamps: true, // Agrega createdAt y updatedAt automáticamente
  }
);

// Crear el modelo de Mongoose para el egreso
const Egreso = mongoose.model('Egreso', egresoSchema);
export default Egreso;