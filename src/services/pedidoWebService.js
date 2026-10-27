// Registro de pedidos y leads que llegan desde la página web de un negocio (sin login).
// Las funciones reciben un cliente de transacción (`tx`) para que el controlador decida
// cuándo confirmar, y para poder probarlas dentro de una transacción que se revierte.

const texto = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const pesos = (n) => '$' + Math.round(n).toLocaleString('es-CO');

/** Celular colombiano a 10 dígitos (acepta +57, espacios y guiones). null si no es válido. */
export const normalizarCelular = (v) => {
    let d = String(v || '').replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('57')) d = d.slice(2);
    return /^3\d{9}$/.test(d) ? d : null;
};

/**
 * Menor precio posible combinando paquetes y unidades sueltas.
 * Devuelve el total y las líneas que lo explican (p. ej. "Paquete de 24", "6 sueltas").
 */
export const precioConPaquetes = (unidades, precioUnidad, paquetes = []) => {
    const opciones = [{ n: 1, p: precioUnidad }, ...paquetes.map(x => ({ n: x.unidades, p: x.precio }))];
    const costo = [0], uso = [null];
    for (let i = 1; i <= unidades; i++) {
        costo[i] = Infinity;
        for (const o of opciones) {
            if (o.n <= i && costo[i - o.n] + o.p < costo[i]) { costo[i] = costo[i - o.n] + o.p; uso[i] = o; }
        }
    }
    const partes = {};
    for (let i = unidades; i > 0; i -= uso[i].n) partes[uso[i].n] = (partes[uso[i].n] || 0) + 1;
    const lineas = Object.keys(partes).map(Number).sort((a, b) => b - a).map(n => {
        const k = partes[n];
        if (n === 1) return `${k} suelta${k === 1 ? '' : 's'}`;
        return `${k > 1 ? k + ' paquetes' : 'Paquete'} de ${n}`;
    });
    return { total: costo[unidades], lineas };
};

const fechaLegible = (iso) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
    const d = new Date(iso + 'T12:00:00Z');
    return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
};

/** Error con código HTTP, para que el controlador responda 4xx en vez de 500. */
const fallo = (status, message) => Object.assign(new Error(message), { status });

/**
 * Crea el pedido web: cliente (persona) por celular, pedido PENDIENTE, detalle y
 * descuento de inventario. Los productos se hacen por encargo, así que el stock
 * puede quedar negativo (indica cuántas faltan por producir); al ANULAR el pedido el
 * flujo normal de RapiCtrl lo devuelve.
 */
export const registrarPedidoWeb = async (tx, businessId, cfg, body) => {
    const codigo = texto(body.codigo, 30);
    const nombre = texto(body.cliente?.nombre, 100);
    const celular = normalizarCelular(body.cliente?.celular);
    if (!/^[A-Z]{2,5}-[\w-]{3,24}$/.test(codigo)) throw fallo(400, 'Código de pedido inválido');
    if (nombre.length < 2) throw fallo(400, 'El nombre es obligatorio');
    if (!celular) throw fallo(400, 'El celular no es válido');

    // Productos: solo los permitidos para la web, sin repetidos y en cantidades razonables
    const cantidades = new Map();
    for (const it of Array.isArray(body.items) ? body.items : []) {
        const id = Number(it?.inventario_id), cant = Number(it?.cantidad);
        if (!cfg.productos.includes(id)) throw fallo(400, `Producto ${it?.inventario_id} no disponible`);
        if (!Number.isInteger(cant) || cant < 1 || cant > cfg.maxUnidadesPorProducto) throw fallo(400, 'Cantidad inválida');
        cantidades.set(id, (cantidades.get(id) || 0) + cant);
    }
    if (!cantidades.size) throw fallo(400, 'El pedido debe tener al menos un producto');

    const productos = await tx.inventario.findMany({
        where: { id: { in: [...cantidades.keys()] }, business_id: businessId },
    });
    if (productos.length !== cantidades.size) throw fallo(400, 'Producto no encontrado');

    const unidades = [...cantidades.values()].reduce((a, b) => a + b, 0);
    const precios = new Set(productos.map(p => Number(p.monto)));
    const totalLista = productos.reduce((s, p) => s + Number(p.monto) * cantidades.get(p.id), 0);
    let total = totalLista, lineasPrecio = [];
    if (precios.size === 1 && cfg.paquetes?.length) {
        const r = precioConPaquetes(unidades, [...precios][0], cfg.paquetes);
        if (r.total < totalLista) { total = r.total; lineasPrecio = r.lineas; }
    }

    // Cliente: se reconoce por celular dentro del negocio
    const entrega = body.entrega || {};
    const domicilio = entrega.tipo === 'domicilio';
    const zona = texto(entrega.zona, 60);
    const barrio = texto(entrega.barrio, 60);
    const direccion = texto(entrega.direccion, 120);
    const referencia = texto(entrega.referencia, 120);
    const direccionCompleta = domicilio ? [direccion, barrio, zona].filter(Boolean).join(', ').slice(0, 255) : null;

    let persona = await tx.personas.findFirst({ where: { business_id: businessId, celular } });
    if (!persona) {
        persona = await tx.personas.create({
            data: {
                tipo_documento: 'CC',
                numero_documento: null,
                nombre,
                celular,
                direccion: direccionCompleta,
                tipo: 'CLIENTE',
                usuario: cfg.usuarioId,
                business_id: businessId,
            },
        });
    } else if (direccionCompleta && !persona.direccion) {
        await tx.personas.update({ where: { id: persona.id }, data: { direccion: direccionCompleta, updated_at: new Date() } });
    }

    // Si el cliente vuelve a tocar "Enviar", no se duplica el pedido
    const previo = await tx.pedidos.findFirst({
        where: {
            business_id: businessId,
            persona_id: persona.id,
            observaciones: { startsWith: `Pedido web ${codigo}` },
            created_at: { gte: new Date(Date.now() - 3 * 24 * 3600 * 1000) },
        },
        select: { id: true, total: true },
    });
    if (previo) return { pedido_id: previo.id, total: Number(previo.total), duplicado: true };

    const obs = [`Pedido web ${codigo}`];
    obs.push(domicilio ? `Entrega: domicilio en ${zona || 'por confirmar'}` : 'Entrega: recoge en el local');
    if (domicilio) {
        obs.push(`Dirección: ${direccion || '-'}${barrio ? ' · Barrio: ' + barrio : ''}`);
        if (referencia) obs.push(`Referencia: ${referencia}`);
    }
    const dia = fechaLegible(entrega.fecha);
    const franja = texto(entrega.franja, 40);
    if (dia || franja) obs.push(`Día: ${[dia, franja.toLowerCase()].filter(Boolean).join(', ')}`);
    obs.push(`Celular: ${celular}`);
    const pago = texto(body.pago, 40), ocasion = texto(body.ocasion, 40);
    if (pago || ocasion) obs.push([pago && `Pago: ${pago}`, ocasion && `Ocasión: ${ocasion}`].filter(Boolean).join(' · '));
    if (lineasPrecio.length) {
        obs.push(`Precio: ${lineasPrecio.join(' + ')} (lista ${pesos(totalLista)}, ahorro ${pesos(totalLista - total)})`);
    }
    if (domicilio) obs.push(cfg.notaEnvio || 'Domicilio: valor por confirmar (no incluido en el total)');
    const nota = texto(body.nota, 300);
    if (nota) obs.push(`Nota: ${nota}`);
    if (body.origen === 'anuncio') obs.push('Origen: anuncio');

    const pedido = await tx.pedidos.create({
        data: {
            persona_id: persona.id,
            cliente_nombre: null,
            user_id: cfg.usuarioId,
            business_id: businessId,
            total,
            observaciones: obs.join('\n'),
        },
    });

    for (const p of productos) {
        const cant = cantidades.get(p.id);
        await tx.detalle_pedidos.create({
            data: { pedido_id: pedido.id, inventario_id: p.id, cantidad: cant, precio_unitario: p.monto },
        });
        if (p.tipo_item !== 'servicio') {
            await tx.inventario.update({
                where: { id: p.id },
                data: { cantidad: { decrement: cant }, updated_at: new Date() },
            });
        }
    }

    return { pedido_id: pedido.id, total, duplicado: false };
};

/**
 * Lead de "Trabaja con nosotros" (personas que quieren revender). Va al CRM del negocio
 * como NUEVO / WEB. No se envía a la API de conversiones de Meta: ese dataset es de
 * otro negocio.
 */
export const registrarLeadWeb = async (tx, businessId, cfg, body) => {
    const nombre = texto(body.nombre, 150);
    const celular = normalizarCelular(body.celular);
    if (nombre.length < 2) throw fallo(400, 'El nombre es obligatorio');
    if (!celular) throw fallo(400, 'El celular no es válido');

    const previo = await tx.crm_leads.findFirst({
        where: { business_id: businessId, telefono: celular, created_at: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
        select: { id: true },
    });
    if (previo) return { lead_id: previo.id, duplicado: true };

    const notas = ['Quiere revender (Trabaja con nosotros, página web)'];
    const campos = [
        ['Cómo las vendería', texto(body.tipo, 60)],
        ['Zona', [texto(body.zona, 60), texto(body.barrio, 60)].filter(Boolean).join(', barrio ')],
        ['Cantidad aprox. por semana', texto(body.cantidad, 30)],
        ['Congelador', texto(body.congelador, 30)],
        ['Mensaje', texto(body.nota, 300)],
    ];
    for (const [k, v] of campos) if (v) notas.push(`${k}: ${v}`);
    if (body.origen === 'anuncio') notas.push('Origen: anuncio');

    const lead = await tx.crm_leads.create({
        data: {
            nombre,
            empresa: texto(body.negocio, 150) || null,
            telefono: celular,
            origen: 'WEB',
            estado: 'NUEVO',
            valor_estimado: 0,
            notas: notas.join('\n'),
            servicio: null,
            usuario: cfg.usuarioId,
            business_id: businessId,
        },
    });
    return { lead_id: lead.id, duplicado: false };
};
