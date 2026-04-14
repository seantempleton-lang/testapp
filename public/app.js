const schemaListEl = document.getElementById("schema-list");
const connectionStatusEl = document.getElementById("connection-status");
const tableTitleEl = document.getElementById("table-title");
const tableColumnsEl = document.getElementById("table-columns");
const tablePreviewEl = document.getElementById("table-preview");
const refreshTableButton = document.getElementById("refresh-table");
const sqlInputEl = document.getElementById("sql-input");
const runQueryButton = document.getElementById("run-query");
const queryMetaEl = document.getElementById("query-meta");
const queryResultsEl = document.getElementById("query-results");
const tableTemplate = document.getElementById("table-template");

const state = {
  schema: null,
  table: null,
  schemas: [],
};

refreshTableButton.addEventListener("click", () => {
  if (state.schema && state.table) {
    loadTablePreview(state.schema, state.table);
  }
});

runQueryButton.addEventListener("click", runQuery);

bootstrap().catch((error) => {
  setStatus(`Connection failed: ${error.message}`, "error");
});

async function bootstrap() {
  const [health, schemaPayload] = await Promise.all([
    fetchJson("/api/health"),
    fetchJson("/api/schema"),
  ]);

  state.schemas = schemaPayload.schemas;
  setStatus(`Connected to ${health.database} at ${new Date(health.server_time).toLocaleString()}`, "ready");
  renderSchema(state.schemas);

  const firstTable = state.schemas.flatMap((item) => item.tables.map((table) => [item.name, table.name]))[0];
  if (firstTable) {
    await loadTablePreview(firstTable[0], firstTable[1]);
  }
}

function renderSchema(schemas) {
  schemaListEl.innerHTML = "";

  if (!schemas.length) {
    schemaListEl.innerHTML = '<div class="muted">No user tables were found in this database.</div>';
    return;
  }

  for (const schema of schemas) {
    const group = document.createElement("section");
    group.className = "schema-group";

    const title = document.createElement("h4");
    title.textContent = schema.name;
    group.appendChild(title);

    for (const table of schema.tables) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.schema = schema.name;
      button.dataset.table = table.name;
      button.innerHTML = `<strong>${table.name}</strong><small>${table.columns.length} columns</small>`;
      button.addEventListener("click", () => loadTablePreview(schema.name, table.name));
      group.appendChild(button);
    }

    schemaListEl.appendChild(group);
  }
}

async function loadTablePreview(schema, table) {
  state.schema = schema;
  state.table = table;
  markActiveTable(schema, table);

  tableTitleEl.textContent = `${schema}.${table}`;
  tablePreviewEl.innerHTML = '<div class="empty-state">Loading preview…</div>';

  const currentTable = state.schemas
    .find((item) => item.name === schema)
    ?.tables.find((item) => item.name === table);

  renderColumns(currentTable?.columns || []);

  const preview = await fetchJson(`/api/table/${encodeURIComponent(schema)}/${encodeURIComponent(table)}?limit=100`);
  renderTable(tablePreviewEl, preview.columns, preview.rows, `${preview.rowCount} rows returned`);

  sqlInputEl.value = `select *\nfrom "${schema}"."${table}"\nlimit 100;`;
}

function renderColumns(columns) {
  tableColumnsEl.innerHTML = "";

  if (!columns.length) {
    tableColumnsEl.textContent = "No column metadata available.";
    return;
  }

  for (const column of columns) {
    const pill = document.createElement("div");
    pill.className = "column-pill";
    pill.innerHTML = `<strong>${column.name}</strong><span>${column.dataType}${column.nullable ? "" : " • not null"}</span>`;
    tableColumnsEl.appendChild(pill);
  }
}

async function runQuery() {
  runQueryButton.disabled = true;
  queryMetaEl.textContent = "Running query…";

  try {
    const payload = await fetchJson("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: sqlInputEl.value }),
    });

    queryMetaEl.textContent = `${payload.command} completed with ${payload.rowCount ?? 0} rows.`;
    renderTable(queryResultsEl, payload.columns, payload.rows);
  } catch (error) {
    queryMetaEl.textContent = error.message;
    queryResultsEl.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  } finally {
    runQueryButton.disabled = false;
  }
}

function renderTable(target, columns, rows, captionText = "") {
  target.innerHTML = "";

  if (!columns.length) {
    target.innerHTML = '<div class="empty-state">This result set did not return any columns.</div>';
    return;
  }

  const fragment = tableTemplate.content.cloneNode(true);
  const table = fragment.querySelector("table");
  const thead = fragment.querySelector("thead");
  const tbody = fragment.querySelector("tbody");

  const headRow = document.createElement("tr");
  for (const column of columns) {
    const th = document.createElement("th");
    th.textContent = column;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = columns.length;
    cell.textContent = captionText || "No rows returned.";
    row.appendChild(cell);
    tbody.appendChild(row);
  } else {
    for (const item of rows) {
      const row = document.createElement("tr");
      for (const column of columns) {
        const cell = document.createElement("td");
        cell.textContent = formatCellValue(item[column]);
        row.appendChild(cell);
      }
      tbody.appendChild(row);
    }
  }

  target.appendChild(table);
}

function markActiveTable(schema, table) {
  for (const button of schemaListEl.querySelectorAll("button")) {
    const isActive = button.dataset.schema === schema && button.dataset.table === table;
    button.classList.toggle("is-active", isActive);
  }
}

function setStatus(message, stateName) {
  connectionStatusEl.textContent = message;
  connectionStatusEl.classList.remove("is-ready", "is-error");
  if (stateName === "ready") {
    connectionStatusEl.classList.add("is-ready");
  }
  if (stateName === "error") {
    connectionStatusEl.classList.add("is-error");
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function formatCellValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
