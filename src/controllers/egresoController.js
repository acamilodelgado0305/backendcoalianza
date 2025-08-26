import Egreso from "../models/egresoModel.js";

// Crear un nuevo egreso
export const createEgreso = async (req, res) => {
  try {
    const { fecha, valor, cuenta, descripcion, vendedor } = req.body;

    if (!fecha || !valor || !cuenta || !descripcion || !vendedor) {
      return res.status(400).json({ message: 'Todos los campos son obligatorios' });
    }

    const parsedFecha = new Date(fecha);
    if (isNaN(parsedFecha.getTime())) {
      return res.status(400).json({ message: 'La fecha no es válida' });
    }

    if (typeof valor !== 'number' || valor < 0) {
      return res.status(400).json({ message: 'El valor debe ser un número positivo' });
    }

    const validCuentas = ['Nequi', 'Daviplata', 'Bancolombia'];
    if (!validCuentas.includes(cuenta)) {
      return res.status(400).json({ message: 'La cuenta debe ser Nequi, Daviplata o Bancolombia' });
    }

    if (typeof descripcion !== 'string' || descripcion.trim() === '') {
      return res.status(400).json({ message: 'La descripción no es válida' });
    }

    if (typeof vendedor !== 'string' || vendedor.trim() === '' || vendedor.length > 50) {
      return res.status(400).json({ message: 'El nombre del vendedor no es válido' });
    }

    const newEgreso = new Egreso({
      fecha: parsedFecha,
      valor,
      cuenta,
      descripcion: descripcion.trim(),
      vendedor: vendedor.trim(),
    });

    await newEgreso.save();
    res.status(201).json(newEgreso);
  } catch (error) {
    console.error('Error al crear el egreso:', error);
    res.status(500).json({ message: 'Error al crear el egreso', error: error.message });
  }
};

// Obtener todos los egresos
export const getEgresos = async (req, res) => {
  try {
    const egresos = await Egreso.find();
    res.status(200).json(egresos);
  } catch (error) {
    console.error('Error al obtener los egresos:', error);
    res.status(500).json({ message: 'Error al obtener los egresos', error: error.message });
  }
};

// Obtener un egreso por ID
export const getEgresoById = async (req, res) => {
  try {
    const { id } = req.params;
    const egreso = await Egreso.findById(id);
    if (!egreso) {
      return res.status(404).json({ message: 'Egreso no encontrado' });
    }
    res.status(200).json(egreso);
  } catch (error) {
    console.error('Error al obtener el egreso:', error);
    res.status(500).json({ message: 'Error al obtener el egreso', error: error.message });
  }
};

// Actualizar un egreso por su ID
export const updateEgreso = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // A diferencia de 'Client', aquí no hay campos únicos que validar contra
    // otros documentos, por lo que podemos proceder directamente a la actualización.

    const updatedEgreso = await Egreso.findByIdAndUpdate(
      id,
      { $set: updateData }, // Actualiza solo los campos que vienen en el body
      { 
        new: true,           // Opción para que retorne el documento ya modificado
        runValidators: true, // ¡La clave! Ejecuta las validaciones del schema (enum, min, required, etc.)
        context: 'query'     // Necesario para que ciertas validaciones se ejecuten correctamente en updates
      }
    );

    // Si el 'updatedEgreso' es null, significa que no se encontró un documento con ese ID
    if (!updatedEgreso) {
      return res.status(404).json({ message: 'Egreso no encontrado' });
    }

    res.status(200).json({
      message: 'Egreso actualizado exitosamente',
      egreso: updatedEgreso
    });

  } catch (error) {
    console.error('Error al actualizar el egreso:', error);
    
    // Si el error es por una validación de Mongoose (ej: un 'enum' incorrecto)
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Datos inválidos', errors: error.errors });
    }

    // Para cualquier otro tipo de error
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
};


// Eliminar un egreso por su ID
export const deleteEgreso = async (req, res) => {
  try {
    const { id } = req.params;
    const egreso = await Egreso.findByIdAndDelete(id);
    if (!egreso) {
      return res.status(404).json({ message: 'Egreso no encontrado' });
    }
    res.status(200).json({ message: 'Egreso eliminado exitosamente' });
  } catch (error) {
    console.error('Error al eliminar el egreso:', error);
    res.status(500).json({ message: 'Error al eliminar el egreso', error: error.message });
  }
};
