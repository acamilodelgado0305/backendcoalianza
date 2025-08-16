import Client from "../models/clientModel.js";

// Crear un nuevo cliente
export const createClient = async (req, res) => {
  try {
    const { nombre, apellido, numeroDeDocumento, tipo, vendedor, valor, cuenta } = req.body;

    // Validación de campos requeridos
    if (!nombre || !apellido || !numeroDeDocumento || !vendedor || !valor || !cuenta) {
      return res.status(400).json({ message: 'Todos los campos son obligatorios' });
    }

    // Validar que numeroDeDocumento sea una cadena no vacía
    if (typeof numeroDeDocumento !== 'string' || numeroDeDocumento.trim() === '') {
      return res.status(400).json({ message: 'El número de documento no es válido' });
    }

    // Validar que valor sea un número positivo
    if (typeof valor !== 'number' || valor < 0) {
      return res.status(400).json({ message: 'El valor debe ser un número positivo' });
    }

    // Validar que tipo sea un array y contenga valores válidos
    if (!Array.isArray(tipo) || tipo.length === 0 || !tipo.every(t => typeof t === 'string' && t.trim() !== '')) {
      return res.status(400).json({ message: 'El campo "tipo" debe ser un arreglo con al menos un concepto o servicio válido.' });
    }

    // Validar que cuenta sea un valor válido
    const validCuentas = ['Nequi', 'Daviplata', 'Bancolombia'];
    if (!validCuentas.includes(cuenta)) {
      return res.status(400).json({ message: 'La cuenta debe ser Nequi, Daviplata o Bancolombia' });
    }

    // Verificar si el número de documento ya existe
    const existingClient = await Client.findOne({ numeroDeDocumento });
    if (existingClient) {
      return res.status(400).json({ message: 'El número de documento ya está registrado' });
    }

    // Crear el nuevo cliente
    const newClient = new Client({
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      numeroDeDocumento: numeroDeDocumento.trim(),
      tipo,
      vendedor: vendedor.trim(),
      valor,
      cuenta,
    });

    // Guardar el cliente en la base de datos
    await newClient.save();

    // Responder con el cliente creado
    res.status(201).json(newClient);
  } catch (error) {
    console.error('Error al crear el cliente:', error);
    res.status(500).json({ message: 'Error al crear el cliente', error: error.message });
  }
};

// Obtener todos los clientes
export const getClients = async (req, res) => {
  try {
    const clients = await Client.find(); // Obtener todos los clientes de la base de datos
    res.status(200).json(clients);
  } catch (error) {
    console.error('Error al obtener los clientes:', error);
    res.status(500).json({ message: 'Error al obtener los clientes', error: error.message });
  }
};

// Obtener un cliente por número de documento
export const getClientByNumeroDeDocumento = async (req, res) => {
  try {
    const { numeroDeDocumento } = req.params;

    // Validar que numeroDeDocumento no esté vacío
    if (!numeroDeDocumento || numeroDeDocumento.trim() === '') {
      return res.status(400).json({ message: 'El número de documento no es válido' });
    }

    // Normalizar el número de documento
    const normalizedNumero = numeroDeDocumento.trim().toLowerCase();

    // Buscar cliente por número de documento (insensible a mayúsculas)
    const client = await Client.findOne({
      numeroDeDocumento: normalizedNumero
    }).collation({ locale: 'en', strength: 2 });

    // Depuración: Mostrar el resultado de la consulta
    console.log('Cliente encontrado:', client);

    if (!client) {
      return res.status(404).json({ message: 'Cliente no encontrado' });
    }

    res.status(200).json(client);
  } catch (error) {
    console.error('Error al obtener el cliente:', error);
    res.status(500).json({ message: 'Error al obtener el cliente', error: error.message });
  }
};

// Actualizar un cliente por su ID
export const updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, apellido, numeroDeDocumento, tipo, vendedor, valor, cuenta } = req.body;

    // Buscar el cliente por ID
    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({ message: 'Cliente no encontrado' });
    }

    // Validar numeroDeDocumento si se proporciona
    if (numeroDeDocumento && numeroDeDocumento.trim() !== '') {
      const existingClient = await Client.findOne({ numeroDeDocumento, _id: { $ne: id } });
      if (existingClient) {
        return res.status(400).json({ message: 'El número de documento ya está registrado' });
      }
      client.numeroDeDocumento = numeroDeDocumento.trim();
    }

    // Validar tipo si se proporciona
    if (tipo) {
      if (!Array.isArray(tipo) || tipo.length === 0) {
        return res.status(400).json({ message: 'Debe proporcionar al menos un tipo de certificado válido' });
      }
      const validTipos = ['Manipulación de alimentos', 'Aseo Hospitalario'];
      if (!tipo.every((t) => validTipos.includes(t))) {
        return res.status(400).json({ message: 'Uno o más tipos de certificado no son válidos' });
      }
      client.tipo = tipo;
    }

    // Validar valor si se proporciona
    if (valor !== undefined) {
      if (typeof valor !== 'number' || valor < 0) {
        return res.status(400).json({ message: 'El valor debe ser un número positivo' });
      }
      client.valor = valor;
    }

    // Validar cuenta si se proporciona
    if (cuenta) {
      const validCuentas = ['Nequi', 'Daviplata', 'Bancolombia'];
      if (!validCuentas.includes(cuenta)) {
        return res.status(400).json({ message: 'La cuenta debe ser Nequi, Daviplata o Bancolombia' });
      }
      client.cuenta = cuenta;
    }

    // Actualizar los datos del cliente
    client.nombre = nombre ? nombre.trim() : client.nombre;
    client.apellido = apellido ? apellido.trim() : client.apellido;
    client.vendedor = vendedor ? vendedor.trim() : client.vendedor;

    // Guardar los cambios en la base de datos
    await client.save();
    res.status(200).json(client);
  } catch (error) {
    console.error('Error al actualizar el cliente:', error);
    res.status(500).json({ message: 'Error al actualizar el cliente', error: error.message });
  }
};

// Eliminar un cliente por su ID
export const deleteClient = async (req, res) => {
  try {
    const { id } = req.params;

    // Buscar y eliminar el cliente por ID
    const client = await Client.findByIdAndDelete(id);
    if (!client) {
      return res.status(404).json({ message: 'Cliente no encontrado' });
    }
    res.status(200).json({ message: 'Cliente eliminado exitosamente' });
  } catch (error) {
    console.error('Error al eliminar el cliente:', error);
    res.status(500).json({ message: 'Error al eliminar el cliente', error: error.message });
  }
};

// Agregar un elemento al array `tipo`
export const addTipoToClient = async (req, res) => {
  try {
    const { id } = req.params;
    const { tipo } = req.body;

    // Validar que se proporcione un tipo
    if (!tipo || tipo.trim() === '') {
      return res.status(400).json({ message: 'El tipo es obligatorio' });
    }

    // Validar que el tipo sea válido
    const validTipos = ['Manipulación de alimentos', 'Aseo Hospitalario'];
    if (!validTipos.includes(tipo)) {
      return res.status(400).json({ message: 'El tipo de certificado no es válido' });
    }

    // Buscar el cliente por ID
    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({ message: 'Cliente no encontrado' });
    }

    // Agregar el tipo al array si no existe
    if (!client.tipo.includes(tipo)) {
      client.tipo.push(tipo);
    }

    // Guardar los cambios
    await client.save();
    res.status(200).json(client);
  } catch (error) {
    console.error('Error al agregar el tipo:', error);
    res.status(500).json({ message: 'Error al agregar el tipo', error: error.message });
  }
};

// Eliminar un elemento del array `tipo`
export const removeTipoFromClient = async (req, res) => {
  try {
    const { id } = req.params;
    const { tipo } = req.body;

    // Validar que se proporcione un tipo
    if (!tipo || tipo.trim() === '') {
      return res.status(400).json({ message: 'El tipo es obligatorio' });
    }

    // Validar que el tipo sea válido
    const validTipos = ['Manipulación de alimentos', 'Aseo Hospitalario'];
    if (!validTipos.includes(tipo)) {
      return res.status(400).json({ message: 'El tipo de certificado no es válido' });
    }

    // Buscar el cliente por ID
    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({ message: 'Cliente no encontrado' });
    }

    // Eliminar el tipo del array si existe
    client.tipo = client.tipo.filter((item) => item !== tipo);

    // Guardar los cambios
    await client.save();
    res.status(200).json(client);
  } catch (error) {
    console.error('Error al eliminar el tipo:', error);
    res.status(500).json({ message: 'Error al eliminar el tipo', error: error.message });
  }
};