// Negocios que reciben pedidos y leads desde su propia página web, SIN login.
// Solo los negocios listados aquí aceptan esas solicitudes públicas; para cualquier
// otro business_id el endpoint responde 404. Así nadie puede crear pedidos (y mover
// el inventario) de un negocio que no lo pidió.
export const NEGOCIOS_WEB = {
    // Oblé · obleas congeladas (página: https://oble-pedidos.vercel.app)
    70: {
        nombre: 'Oblé',
        // Usuario de RapiCtrl a cuyo nombre quedan los pedidos web (pedidos.user_id es obligatorio)
        usuarioId: 1,
        // Únicos productos del inventario que se pueden pedir desde la página
        productos: [208, 209],
        // Precio de paquete. Se aplica solo si todos los productos tienen el mismo precio unitario.
        paquetes: [
            { unidades: 12, precio: 45000 },
            { unidades: 24, precio: 86000 },
            { unidades: 50, precio: 170000 },
        ],
        maxUnidadesPorProducto: 300,
    },
    // El Pino Polen · polen de abejas en cápsulas (página: https://elpinofinca.com/polen/)
    // Envíos a toda Colombia, pago contraentrega.
    69: {
        nombre: 'El Pino Polen',
        usuarioId: 1,
        productos: [212], // Polen de abejas · 60 cápsulas (precio unitario = monto del inventario)
        // Deben coincidir con public/assets/js/catalogo.js del sitio
        paquetes: [
            { unidades: 2, precio: 109900 },
            { unidades: 3, precio: 149900 },
        ],
        maxUnidadesPorProducto: 12,
        notaEnvio: 'Envío nacional incluido (gratis). Pago contraentrega: se cobra el total al entregar.',
    },
};
