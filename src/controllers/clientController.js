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
                i."_id",
                COALESCE(NULLIF(per.nombre, ''),  NULLIF(i."nombre", 'Cliente'), i."nombre")   AS nombre,
                COALESCE(NULLIF(per.apellido, ''), NULLIF(i."apellido", 'General'), i."apellido") AS apellido,
                COALESCE(per.numero_documento, i."numeroDeDocumento") AS "numeroDeDocumento",
                COALESCE(per.tipo_documento,   i."tipoDocumento")     AS "tipoDocumento",
                i."producto",
                i."fechaVencimiento",
                i."createdAt",
                COALESCE(per.email, i."customer_email") AS customer_email
            FROM "public"."ingresos" i
            LEFT JOIN "public"."personas" per ON per.id = i.persona_id
            WHERE
                REPLACE(REPLACE(
                    COALESCE(per.numero_documento, i."numeroDeDocumento", ''),
                '.', ''), ' ', '') = $1
                AND i."numeroDeDocumento" NOT IN ('0', '', 'null')
                AND i."nombre" NOT IN ('Cliente', '')
            ORDER BY i."createdAt" DESC
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
                ? data.producto.split(',').map(s => s.trim()).filter(Boolean)
                : [data.producto.trim()];
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
            tipoDeDocumento: data.tipoDocumento || 'C.C',
        };

        return res.status(200).json(responseData);

    } catch (error) {
        console.error("Error consultando cliente:", error);
        return res.status(500).json({ message: 'Error interno del servidor.' });
    }
};
