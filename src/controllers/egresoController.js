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
    const { fecha, valor, cuenta, descripcion, vendedor } = req.body;

    const egreso = await Egreso.findById(id);
    if (!egreso) {
      return res.status(404).json({ message: 'Egreso no encontrado' });
    }

    if (fecha) {
      const parsedFecha = new Date(fecha);
      if (isNaN(parsedFecha.getTime())) {
        return res.status(400).json({ message: 'La fecha no es válida' });
      }
      egreso.fecha = parsedFecha;
    }

    if (valor !== undefined) {
      if (typeof valor !== 'number' || valor < 0) {
        return res.status(400).json({ message: 'El valor debe ser un número positivo' });
      }
      egreso.valor = valor;
    }

    if (cuenta) {
      const validCuentas = ['Nequi', 'Daviplata', 'Bancolombia'];
      if (!validCuentas.includes(cuenta)) {
        return res.status(400).json({ message: 'La cuenta debe ser Nequi, Daviplata o Bancolombia' });
      }
      egreso.cuenta = cuenta;
    }

    if (descripcion) {
      if (typeof descripcion !== 'string' || descripcion.trim() === '') {
        return res.status(400).json({ message: 'La descripción no es válida' });
      }
      egreso.descripcion = descripcion.trim();
    }

    if (vendedor) {
      if (typeof vendedor !== 'string' || vendedor.trim() === '' || vendedor.length > 50) {
        return res.status(400).json({ message: 'El nombre del vendedor no es válido' });
      }
      egreso.vendedor = vendedor.trim();
    }

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
