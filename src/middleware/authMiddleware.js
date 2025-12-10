// src/middleware/authMiddleware.js
import jwt from "jsonwebtoken";

export const authMiddleware = (req, res, next) => {
    try {
        const authHeader = req.headers["authorization"] || req.headers["Authorization"];

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ message: "Token no proporcionado o malformado" });
        }

        const token = authHeader.split(" ")[1];

        if (!token) {
            return res.status(401).json({ message: "Token no proporcionado" });
        }

        const secret = process.env.JWT_SECRET;
        if (!secret) {
            console.error("JWT_SECRET no está definido en las variables de entorno");
            return res.status(500).json({ message: "Error de configuración del servidor" });
        }

        const decoded = jwt.verify(token, secret);

        // Para tu caso específico, el id viene en 'sub'
        const userId = decoded.sub;

        if (!userId) {
            return res.status(401).json({ message: "El token no contiene un id de usuario válido" });
        }

        // Dejo info útil del usuario en la request
        req.user = {
            id: userId,
            name: decoded.name,
            role: decoded.role,
            scope: decoded.scope,
            raw: decoded,
        };

        next();
    } catch (error) {
        console.error("Error en authMiddleware:", error);
        return res.status(401).json({ message: "Token inválido o expirado" });
    }
};
