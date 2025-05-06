import Egreso from "../models/egresoModel.js";

// Crear un nuevo egreso
export const createEgreso = async (req, res) => {
  try {
    const { fecha, valor, cuenta, descripcion } = req.body;

    // Validación de campos requeridos
    if (!fecha || !valor || !cuenta || !descripcion) {
      return res.status(400).json({ message: 'Todos los campos son obligatorios' });
    }

    // Validar que fecha sea una fecha válida
    const parsedFecha = new Date(fecha);
    if (isNaN(parsedFecha.getTime())) {
      return res.status(400).json({ message: 'La fecha no es válida' });
    }

    // Validar que valor sea un número positivo
    if (typeof valor !== 'number' || valor < 0) {
      return res.status(400).json({ message: 'El valor debe ser un número positivo' });
    }

    // Validar que cuenta sea un valor válido
    const validCuentas = ['Nequi', 'Daviplata', 'Bancolombia'];
    if (!validCuentas.includes(cuenta)) {
      return res.status(400).json({ message: 'La cuenta debe ser Nequi, Daviplata o Bancolombia' });
    }

    // Validar que descripcion sea una cadena no vacía
    if (typeof descripcion !== 'string' || descripcion.trim() === '') {
      return res.status(400).json({ message: 'La descripción no es válida' });
    }

    // Crear el nuevo egreso
    const newEgreso = new Egreso({
      fecha: parsedFecha,
      valor,
      cuenta,
      descripcion: descripcion.trim(),
    });

    // Guardar el egreso en la base de datos
    await newEgreso.save();

    // Responder con el egreso creado
    res.status(201).json(newEgreso);
  } catch (error) {
    console.error('Error al crear el egreso:', error);
    res.status(500).json({ message: 'Error al crear el egreso', error: error.message });
  }
};

// Obtener todos los egresos
export const getEgresos = async (req, res) => {
  try {
    const egresos = await Egreso.find(); // Obtener todos los egresos de la base de datos
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

    // Buscar egreso por ID
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
    const { fecha, valor, cuenta, descripcion } = req.body;

    // Buscar el egreso por ID
    const egreso = await Egreso.findById(id);
    if (!egreso) {
      return res.status(404).json({ message: 'Egreso no encontrado' });
    }

    // Validar y actualizar fecha si se proporciona
    if (fecha) {
      const parsedFecha = new Date(fecha);
      if (isNaN(parsedFecha.getTime())) {
        return res.status(400).json({ message: 'La fecha no es válida' });
      }
      egreso.fecha = parsedFecha;
    }

    // Validar y actualizar valor si se proporciona
    if (valor !== undefined) {
      if (typeof valor !== 'number' || valor < 0) {
        return res.status(400).json({ message: 'El valor debe ser un número positivo' });
      }
      egreso.valor = valor;
    }

    // Validar y actualizar cuenta si se proporciona
    if (cuenta) {
      const validCuentas = ['Nequi', 'Daviplata', 'Bancolombia'];
      if (!validCuentas.includes(cuenta)) {
        return res.status(400).json({ message: 'La cuenta debe ser Nequi, Daviplata o Bancolombia' });
      }
      egreso.cuenta = cuenta;
    }

    // Validar y actualizar descripcion si se proporciona
    if (descripcion) {
      if (typeof descripcion !== 'string' || descripcion.trim() === '') {
        return res.status(400).json({ message: 'La descripción no es válida' });
      }
      egreso.descripcion = descripcion.trim();
    }

    // Guardar los cambios en la base de datos
    await egreso.save();
    res.status(200).json(egreso);
  } catch (error) {
    console.error('Error al actualizar el egreso:', error);
    res.status(500).json({ message: 'Error al actualizar el egreso', error: error.message });
  }
};

// Eliminar un egreso por su ID
export const deleteEgreso = async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar y eliminar el egreso por ID
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