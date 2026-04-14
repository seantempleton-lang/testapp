const path = require("path");
const express = require("express");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 3000);
const queryTimeoutMs = Number(process.env.QUERY_TIMEOUT_MS || 15000);
const previewLimit = Number(process.env.PREVIEW_LIMIT || 100);

const pool = new Pool(buildPgConfig());

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", async (_req, res) => {
  try {
    const result = await pool.query("select current_database() as database, now() as server_time");
    res.json({ ok: true, ...result.rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
});

app.get("/api/schema", async (_req, res) => {
  try {
    const [tablesResult, columnsResult] = await Promise.all([
      pool.query(`
        select
          t.table_schema,
          t.table_name,
          pg_total_relation_size(format('%I.%I', t.table_schema, t.table_name)::regclass) as total_bytes
        from information_schema.tables t
        where t.table_type = 'BASE TABLE'
          and t.table_schema not in ('pg_catalog', 'information_schema')
        order by t.table_schema, t.table_name
      `),
      pool.query(`
        select
          c.table_schema,
          c.table_name,
          c.column_name,
          c.data_type,
          c.is_nullable,
          c.ordinal_position
        from information_schema.columns c
        where c.table_schema not in ('pg_catalog', 'information_schema')
        order by c.table_schema, c.table_name, c.ordinal_position
      `),
    ]);

    const columnsByTable = new Map();

    for (const column of columnsResult.rows) {
      const key = `${column.table_schema}.${column.table_name}`;
      const list = columnsByTable.get(key) || [];
      list.push({
        name: column.column_name,
        dataType: column.data_type,
        nullable: column.is_nullable === "YES",
        position: column.ordinal_position,
      });
      columnsByTable.set(key, list);
    }

    const schemas = [];
    const schemaMap = new Map();

    for (const table of tablesResult.rows) {
      let schema = schemaMap.get(table.table_schema);

      if (!schema) {
        schema = { name: table.table_schema, tables: [] };
        schemaMap.set(table.table_schema, schema);
        schemas.push(schema);
      }

      const key = `${table.table_schema}.${table.table_name}`;
      schema.tables.push({
        name: table.table_name,
        sizeBytes: Number(table.total_bytes || 0),
        columns: columnsByTable.get(key) || [],
      });
    }

    res.json({ schemas });
  } catch (error) {
    res.status(500).json({ error: formatError(error) });
  }
});

app.get("/api/table/:schema/:table", async (req, res) => {
  const schema = req.params.schema;
  const table = req.params.table;
  const limit = clampInt(req.query.limit, 1, previewLimit, previewLimit);

  if (!isSafeIdentifier(schema) || !isSafeIdentifier(table)) {
    return res.status(400).json({ error: "Invalid schema or table name." });
  }

  try {
    const sql = `select * from ${quoteIdentifier(schema)}.${quoteIdentifier(table)} limit $1`;
    const result = await pool.query(sql, [limit]);
    res.json({
      columns: result.fields.map((field) => field.name),
      rows: result.rows,
      rowCount: result.rowCount,
      limit,
    });
  } catch (error) {
    res.status(500).json({ error: formatError(error) });
  }
});

app.post("/api/query", async (req, res) => {
  const sql = String(req.body?.sql || "").trim();

  if (!sql) {
    return res.status(400).json({ error: "Query text is required." });
  }

  if (!isReadOnlyStatement(sql)) {
    return res.status(400).json({
      error: "Only read-only statements are allowed. Try SELECT, WITH, SHOW, or EXPLAIN.",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("begin read only");
    await client.query(`set local statement_timeout = '${queryTimeoutMs}'`);
    const result = await client.query(sql);
    await client.query("rollback");

    res.json({
      command: result.command,
      rowCount: result.rowCount,
      columns: result.fields.map((field) => field.name),
      rows: result.rows,
    });
  } catch (error) {
    try {
      await client.query("rollback");
    } catch (_rollbackError) {
    }

    res.status(500).json({ error: formatError(error) });
  } finally {
    client.release();
  }
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`Postgres browser running at http://localhost:${port}`);
});

function buildPgConfig() {
  const databaseUrl = process.env.DATABASE_URL;
  const sslMode = (process.env.PGSSLMODE || "").toLowerCase();
  const wantsSsl = sslMode === "require";

  if (databaseUrl) {
    return {
      connectionString: databaseUrl,
      ssl: wantsSsl ? { rejectUnauthorized: false } : false,
    };
  }

  return {
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "postgres",
    database: process.env.PGDATABASE || "postgres",
    ssl: wantsSsl ? { rejectUnauthorized: false } : false,
  };
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

function isSafeIdentifier(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function isReadOnlyStatement(sql) {
  const normalized = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .trim()
    .toLowerCase();

  return /^(select|with|show|explain)\b/.test(normalized);
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
