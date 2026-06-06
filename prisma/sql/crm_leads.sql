-- Tabla del módulo CRM (Gestión de leads/clientes)
-- Ejecutar una vez en la base de datos PostgreSQL del backend POS.

CREATE TABLE IF NOT EXISTS crm_leads (
  id             SERIAL PRIMARY KEY,
  nombre         VARCHAR(150) NOT NULL,
  empresa        VARCHAR(150),
  email          VARCHAR(150),
  telefono       VARCHAR(30),
  origen         VARCHAR(30) DEFAULT 'OTRO',
  estado         VARCHAR(30) DEFAULT 'NUEVO',
  valor_estimado NUMERIC(12, 2) DEFAULT 0,
  notas          TEXT,
  persona_id     INTEGER,
  usuario        INTEGER,
  business_id    INTEGER,
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_leads_business ON crm_leads (business_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_estado   ON crm_leads (estado);
