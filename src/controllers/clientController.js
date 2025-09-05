import Client from "../models/clientModel.js";

// Crear un nuevo cliente
export const createClient = async (req, res) => {
  try {
    const { nombre, apellido, numeroDeDocumento, tipo, vendedor, valor, cuenta } = req.body;

    // Validación de campos requeridos
    if (!vendedor || !valor || !cuenta) {
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
   

    // Verificar si el número de documento ya existe
  

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
    const updateData = req.body; // Tomamos todos los datos que vienen en el body

    // 1. ÚNICA VALIDACIÓN MANUAL NECESARIA: El documento único
    // Esta lógica es correcta y debe permanecer, ya que compara con otros documentos.
    if (updateData.numeroDeDocumento) {
      const existingClient = await Client.findOne({ 
        numeroDeDocumento: updateData.numeroDeDocumento, 
        _id: { $ne: id } 
      });

      if (existingClient) {
        return res.status(400).json({ message: 'El número de documento ya está registrado en otro cliente' });
      }
    }

    // 2. ACTUALIZACIÓN ATÓMICA CON VALIDACIÓN AUTOMÁTICA
    // Mongoose se encargará de validar 'nombre', 'apellido', 'valor', 'cuenta', etc.,
    // según las reglas de tu schema.
    const updatedClient = await Client.findByIdAndUpdate(
      id,
      { $set: updateData }, // Usamos $set para actualizar solo los campos enviados
      { 
        new: true,           // Devuelve el documento ya actualizado
        runValidators: true, // ¡La clave! Ejecuta las validaciones del schema
        context: 'query'     // Necesario para que algunas validaciones funcionen en updates
      }
    );

    if (!updatedClient) {
      return res.status(404).json({ message: 'Cliente no encontrado' });
    }

    res.status(200).json({
      message: 'Cliente actualizado exitosamente',
      client: updatedClient
    });

  } catch (error) {
    console.error('Error al actualizar el cliente:', error);
    
    // Error de validación de Mongoose
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Datos inválidos', errors: error.errors });
    }

    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
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