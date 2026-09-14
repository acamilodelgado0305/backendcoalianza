import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { crearControladorCuentas } from '../controllers/cuentasController.js';

// Mismas rutas para las dos clases de cuenta; ver controllers/cuentasController.js
const crearRutasCuentas = (controlador) => {
  const router = express.Router();

  router.use(authMiddleware);

  router.get('/stats',       controlador.estadisticas);
  router.get('/',            controlador.listar);
  router.get('/:id',         controlador.obtener);
  router.post('/',           controlador.crear);
  router.put('/:id',         controlador.actualizar);
  router.delete('/:id',      controlador.eliminar);
  router.post('/:id/abonar',   controlador.registrarAbono);
  router.post('/:id/aumentar', controlador.aumentarDeuda);
  router.put('/:id/movimientos/:movId', controlador.editarMontoMovimiento);

  return router;
};

// Lo que el negocio debe a sus proveedores.
export const cuentasPorPagarRouter = crearRutasCuentas(crearControladorCuentas({
  tabla:     'cuentas_por_pagar',
  nombreCol: 'proveedor_nombre',
  etiqueta:  'Cuenta por pagar',
}));

// Lo que los contactos le deben al negocio (préstamos).
export const cuentasPorCobrarRouter = crearRutasCuentas(crearControladorCuentas({
  tabla:     'cuentas_por_cobrar',
  nombreCol: 'deudor_nombre',
  etiqueta:  'Cuenta por cobrar',
  generaEgresos: true, // prestar deja egresos en Movimientos
}));
