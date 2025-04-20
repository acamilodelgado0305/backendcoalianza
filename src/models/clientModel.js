import mongoose from 'mongoose';

// Definir el esquema para el cliente
const clientSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: [true, 'El nombre es obligatorio'],
      trim: true,
      maxlength: [100, 'El nombre no puede superar 100 caracteres'],
    },
    apellido: {
      type: String,
      required: [true, 'El apellido es obligatorio'],
      trim: true,
      maxlength: [100, 'El apellido no puede superar 100 caracteres'],
    },
    numeroDeDocumento: {
      type: String, // Cambiado a String para mayor flexibilidad (puede incluir letras o guiones)
      required: [true, 'El número de documento es obligatorio'],
      unique: true,
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
      default: [],
      enum: {
        values: ['Manipulación de alimentos', 'Aseo Hospitalario'],
        message: 'El tipo de certificado no es válido',
      },
    },
    vendedor: {
      type: String,
      required: [true, 'El vendedor es obligatorio'],
      trim: true,
      maxlength: [50, 'El nombre del vendedor no puede superar 50 caracteres'],
    },
    valor: {
      type: Number,
      required: [true, 'El valor es obligatorio'],
      min: [0, 'El valor no puede ser negativo'],
    },
    cuenta: {
      type: String,
      required: [true, 'La cuenta es obligatoria'],
      enum: {
        values: ['Nequi', 'Daviplata', 'Bancolombia'],
        message: 'La cuenta debe ser Nequi, Daviplata o Bancolombia',
      },
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