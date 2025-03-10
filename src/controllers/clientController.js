import Client from "../models/clientModel.js";

// Crear un nuevo cliente
export const createClient = async (req, res) => {
  try {
    const { nombre, apellido, numeroDeDocumento, tipo, vendedor } = req.body;

    // Validación para asegurarse de que numeroDeDocumento no esté vacío ni nulo
    if (
      !numeroDeDocumento ||
      (typeof numeroDeDocumento === 'string' && numeroDeDocumento.trim() === '') ||
      (typeof numeroDeDocumento === 'number' && numeroDeDocumento.toString().trim() === '')
    ) {
      return res.status(400).json({ message: 'El número de documento es obligatorio' });
    }

    // Verificar si el número de documento ya existe
    const existingClient = await Client.findOne({ numeroDeDocumento });
    if (existingClient) {
      return res.status(400).json({ message: 'El número de documento ya está registrado.' });
    }

    // Crear el nuevo cliente
    const newClient = new Client({
      nombre,
      apellido,
      numeroDeDocumento,
      vendedor,
      tipo: Array.isArray(tipo) ? tipo : [], // Asegura que tipo sea un array
    });

    // Guardar el cliente en la base de datos
    await newClient.save();

    // Responder con el cliente creado
    res.status(201).json(newClient);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al crear el cliente', error: error.message });
  }
};

// Obtener todos los clientes
export const getClients = async (req, res) => {
  try {
    const clients = await Client.find(); // Obtener todos los clientes de la base de datos
    res.status(200).json(clients);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al obtener los clientes', error: error.message });
  }
};

export const getClientByNumeroDeDocumento = async (req, res) => {
  try {
    const { numeroDeDocumento } = req.params;

    console.log('Número de Documento recibido:', numeroDeDocumento);

    // Convertir a número
    const numeroDeDocumentoNumerico = parseInt(numeroDeDocumento, 10);

    // Validar conversión
    if (isNaN(numeroDeDocumentoNumerico)) {
      return res.status(400).json({ message: 'El número de documento no es válido' });
    }

    // Buscar cliente por número convertido
    const client = await Client.findOne({ numeroDeDocumento: numeroDeDocumentoNumerico });

    console.log('Resultado de la consulta:', client);

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
    const { nombre, apellido, numeroDeDocumento, tipo } = req.body;

    // Buscar el cliente por ID
    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({ message: 'Cliente no encontrado' });
    }

    // Actualizar los datos del cliente
    client.nombre = nombre || client.nombre;
    client.apellido = apellido || client.apellido;
    client.numeroDeDocumento = numeroDeDocumento || client.numeroDeDocumento;
    client.tipo = Array.isArray(tipo) ? tipo : client.tipo; // Actualiza tipo solo si es un array

    // Guardar los cambios en la base de datos
    await client.save();
    res.status(200).json(client);
  } catch (error) {
    console.error(error);
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
    console.error(error);
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
    console.error(error);
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
    console.error(error);
    res.status(500).json({ message: 'Error al eliminar el tipo', error: error.message });
  }
};