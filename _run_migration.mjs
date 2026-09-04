// Temporal: ejecuta un archivo .sql contra la BD del BACKEND. Borrar tras usarlo.
// Uso: node _run_migration.mjs <ruta.sql>
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const sqlPath = process.argv[2];
const sql = fs.readFileSync(sqlPath, "utf8");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const q = async (label, text) => {
  const r = await client.query(text);
  console.log(`\n### ${label}`);
  console.table(r.rows);
};

console.log("BD:", process.env.PGDATABASE, "@", process.env.PGHOST);

await q("ANTES · columnas CAPI en crm_leads", `
  SELECT column_name, data_type, character_maximum_length
    FROM information_schema.columns
   WHERE table_name = 'crm_leads' AND column_name IN ('fbc','fbp','servicio')`);

await q("ANTES · leads por negocio", `
  SELECT business_id, COUNT(*)::int AS leads
    FROM crm_leads GROUP BY business_id ORDER BY leads DESC`);

console.log("\n>>> Ejecutando", path.basename(sqlPath), "...");
await client.query(sql);
console.log(">>> OK");

await q("DESPUÉS · columna servicio", `
  SELECT column_name, data_type, character_maximum_length, is_nullable
    FROM information_schema.columns
   WHERE table_name = 'crm_leads' AND column_name = 'servicio'`);

await q("DESPUÉS · índices de crm_leads", `
  SELECT indexname FROM pg_indexes WHERE tablename = 'crm_leads' ORDER BY indexname`);

await q("DESPUÉS · reparto de servicio", `
  SELECT business_id, COALESCE(servicio,'(null)') AS servicio, COUNT(*)::int AS leads
    FROM crm_leads GROUP BY business_id, servicio ORDER BY business_id`);

await client.end();
