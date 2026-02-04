// src/controllers/ingresoController.js
import pool from "../database.js";

export const getClientByCedula = async (req, res) => {
    // 1. DEPURACIÓN: Muestra qué está llegando en la consola
    console.log("Params recibidos:", req.params);
    
    const { cedula } = req.params;

    // 2. VALIDACIÓN DE SEGURIDAD (Esto evita el crash)
    if (!cedula) {
        return res.status(400).json({ 
            message: 'Por favor proporcione un número de documento en la URL.' 
        });
    }

    try {
        // Ahora sí es seguro usar replace porque sabemos que cedula existe
        const documentoLimpio = cedula.replace(/\D/g, ''); 

        console.log(`🔍 Buscando cliente con documento limpio: ${documentoLimpio}`);

        // ... resto de tu lógica SQL
        const query = `
            SELECT 
                "_id", 
                "nombre", 
                "apellido", 
                "numeroDeDocumento", 
                "tipoDocumento",
                "producto", 
                "fechaVencimiento", 
                "createdAt", 
                "customer_email"
            FROM "public"."ingresos" 
            WHERE 
                REPLACE(REPLACE("numeroDeDocumento", '.', ''), ' ', '') = $1
            ORDER BY "createdAt" DESC 
            LIMIT 1
        `;

        const result = await pool.query(query, [documentoLimpio]);

        if (result.rows.length === 0) {
            return res.status(404).json({ 
                message: 'No se encontraron certificados vigentes para este documento.' 
            });
        }

        const data = result.rows[0];
        
        let cursos = [];
        if (data.producto) {
            cursos = data.producto.includes(',') 
                ? data.producto.split(',').map(s => s.trim()) 
                : [data.producto];
        } else {
            cursos = ["Curso Registrado"]; 
        }

        const responseData = {
            id: data._id,
            nombre: data.nombre,
            apellido: data.apellido,
            numeroDeDocumento: data.numeroDeDocumento, 
            tipo: cursos, 
            createdAt: data.createdAt, 
            fechaVencimiento: data.fechaVencimiento, 
            email: data.customer_email || null,
            tipoDeDocumento: data.tipoDocumento || 'C.C' 
        };

        return res.status(200).json(responseData);

    } catch (error) {
        console.error("Error consultando cliente:", error);
        return res.status(500).json({ message: 'Error interno del servidor.' });
    }
};
