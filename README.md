# Postgres Browser Test App

A small Node.js web app for exploring a Postgres database from the browser. It shows schemas and tables, previews table data, and runs read-only SQL queries with tabulated results.

## Features

- Browse schemas, tables, and column metadata
- Preview table data with a fixed row limit
- Run read-only SQL queries from the UI
- See query results rendered as HTML tables

## Setup

1. Install dependencies:

   ```powershell
   npm.cmd install
   ```

2. Create your environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Update `.env` with your Postgres connection details.

4. Start the app:

   ```powershell
   node server.js
   ```

5. Open [http://localhost:3000](http://localhost:3000)

## Docker

This repo now includes a [Dockerfile](C:\Users\SeanTempleton\OneDrive - McMillan Drilling Ltd\Documents\GitHub\testapp\Dockerfile) so Coolify can be configured as a Dockerfile build.

Build locally:

```powershell
docker build -t postgres-browser-test-app .
```

Run locally:

```powershell
docker run --rm -p 3000:3000 --env-file .env postgres-browser-test-app
```

For Coolify, choose the Dockerfile build option and point it at the repository root. Set your runtime environment variables in Coolify, especially `DATABASE_URL` and, if needed, `PGSSLMODE=require`.

## Environment

- `PORT`: local web server port
- `DATABASE_URL`: full Postgres connection string
- `PGSSLMODE`: set to `require` if your database needs SSL
- `QUERY_TIMEOUT_MS`: optional statement timeout for the SQL runner
- `PREVIEW_LIMIT`: optional maximum row count for table previews

## Notes

- The SQL runner only accepts statements that begin with `SELECT`, `WITH`, `SHOW`, or `EXPLAIN`.
- Queries run inside a read-only transaction so the app does not modify your database.
