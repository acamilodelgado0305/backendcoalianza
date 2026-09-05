-- Migración: qué documentos se envían por correo al vender cada ítem del inventario
-- BD del BACKEND (comercial/POS). Ejecutar UNA sola vez.
--
-- Contexto: `send_mail` ya decía "al vender esto, mándale los documentos por
-- correo", pero el envío estaba clavado en la plantilla de manipulación de
-- alimentos (certificado + carnet). Con estas dos columnas cada ítem dice QUÉ
-- plantilla usar y con cuántas horas, para poder mandar también el diploma +
-- certificado de Alianza Capacitarte (Auxiliar de Bodega, Aseo Hospitalario…).

-- 'alimentos'    → certificado + carnet   (POST /api/enviar-documentos)
-- 'acreditacion' → diploma + certificado  (POST /api/enviar-acreditacion)
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS plantilla_correo   VARCHAR(30);

-- Horas que se imprimen en el documento. Antes iba fijo en '10' desde el front.
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS intensidad_horaria VARCHAR(20);

-- Los ítems que YA enviaban correo son todos de manipulación de alimentos:
-- se marcan explícitamente para que nada cambie de comportamiento.
UPDATE inventario
   SET plantilla_correo = 'alimentos'
 WHERE send_mail IS TRUE
   AND plantilla_correo IS NULL;

-- Auxiliar de Bodega: diploma + certificado de 40 horas.
-- Se activa SOLO en el negocio 3 (Alianza Capacitarte). El ítem equivalente del
-- negocio 5 ("AUXILIAR DE BODEGA", id 137) queda con la plantilla marcada pero con
-- el envío APAGADO, para encenderlo desde Inventario cuando se quiera.
UPDATE inventario
   SET send_mail          = TRUE,
       plantilla_correo   = 'acreditacion',
       intensidad_horaria = COALESCE(intensidad_horaria, '40')
 WHERE nombre ILIKE '%auxiliar%bodega%'
   AND business_id = 3;

UPDATE inventario
   SET plantilla_correo   = 'acreditacion',
       intensidad_horaria = COALESCE(intensidad_horaria, '40')
 WHERE nombre ILIKE '%auxiliar%bodega%'
   AND business_id <> 3;

-- Verificación
SELECT id, business_id, nombre, send_mail, plantilla_correo, intensidad_horaria
  FROM inventario
 WHERE send_mail IS TRUE
 ORDER BY nombre;
