const schemaListEl = document.getElementById("schema-list");
const connectionStatusEl = document.getElementById("connection-status");
const tableTitleEl = document.getElementById("table-title");
const tableViewTitleEl = document.getElementById("table-view-title");
const tableMetaEl = document.getElementById("table-meta");
const tableColumnsEl = document.getElementById("table-columns");
const tablePreviewEl = document.getElementById("table-preview");
const refreshTableButton = document.getElementById("refresh-table");
const sqlInputEl = document.getElementById("sql-input");
const runQueryButton = document.getElementById("run-query");
const queryMetaEl = document.getElementById("query-meta");
const queryResultsEl = document.getElementById("query-results");
const queryViewButton = document.getElementById("query-view-button");
const tableViewButton = document.getElementById("table-view-button");
const queryWorkspaceEl = document.getElementById("query-workspace");
const tableWorkspaceEl = document.getElementById("table-workspace");
const tableTemplate = document.getElementById("table-template");

const state = {
  schema: null,
  table: null,
  schemas: [],
  mode: "table",
  expandedSchemas: new Set(),
};

refreshTableButton.addEventListener("click", () => {
  if (state.schema && state.table) {
    loadTablePreview(state.schema, state.table);
  }
});

runQueryButton.addEventListener("click", runQuery);
queryViewButton.addEventListener("click", () => setMode("query"));
tableViewButton.addEventListener("click", () => setMode("table"));

bootstrap().catch((error) => {
  setStatus(`Connection failed: ${error.message}`, "error");
});

async function bootstrap() {
  const [health, schemaPayload] = await Promise.all([
    fetchJson("/api/health"),
    fetchJson("/api/schema"),
  ]);

  state.schemas = schemaPayload.schemas;
  state.expandedSchemas = new Set(state.schemas.map((schema) => schema.name));
  setStatus(`Connected to ${health.database} at ${new Date(health.server_time).toLocaleString()}`, "ready");
  renderSchema(state.schemas);
  setMode("table");

  const firstTable = state.schemas.flatMap((item) => item.tables.map((table) => [item.name, table.name]))[0];
  if (firstTable) {
    await loadTablePreview(firstTable[0], firstTable[1]);
  } else {
    queryResultsEl.innerHTML = '<div class="empty-state">No tables were found in this database.</div>';
    tablePreviewEl.innerHTML = '<div class="empty-state">No tables were found in this database.</div>';
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
    group.dataset.schema = schema.name;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "schema-toggle";
    toggle.dataset.schema = schema.name;
    toggle.setAttribute("aria-expanded", String(state.expandedSchemas.has(schema.name)));
    toggle.innerHTML = `
      <span class="schema-toggle__chevron">${state.expandedSchemas.has(schema.name) ? "▾" : "▸"}</span>
      <span class="schema-toggle__icon" aria-hidden="true"></span>
      <span class="schema-toggle__label">${schema.name}</span>
      <span class="schema-toggle__count">${schema.tables.length}</span>
    `;
    toggle.addEventListener("click", () => {
      toggleSchema(schema.name);
    });
    group.appendChild(toggle);

    const children = document.createElement("div");
    children.className = "schema-children";
    children.classList.toggle("is-collapsed", !state.expandedSchemas.has(schema.name));

    for (const table of schema.tables) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tree-item";
      button.dataset.schema = schema.name;
      button.dataset.table = table.name;
      button.innerHTML = `
        <span class="tree-item__icon" aria-hidden="true"></span>
        <span class="tree-item__text">
          <strong>${table.name}</strong>
          <small>${table.columns.length} columns</small>
        </span>
      `;
      button.addEventListener("click", async () => {
        await loadTablePreview(schema.name, table.name);
      });
      children.appendChild(button);
    }

    group.appendChild(children);
    schemaListEl.appendChild(group);
  }
}

async function loadTablePreview(schema, table) {
  state.schema = schema;
  state.table = table;
  markActiveTable(schema, table);

  const tableLabel = `${schema}.${table}`;
  tableTitleEl.textContent = tableLabel;
  tableViewTitleEl.textContent = tableLabel;
  tableMetaEl.textContent = "Loading table preview...";
  tablePreviewEl.innerHTML = '<div class="empty-state">Loading preview...</div>';

  const currentTable = state.schemas
    .find((item) => item.name === schema)
    ?.tables.find((item) => item.name === table);

  renderColumns(currentTable?.columns || []);

  const preview = await fetchJson(`/api/table/${encodeURIComponent(schema)}/${encodeURIComponent(table)}?limit=100`);
  tableMetaEl.textContent = `${preview.rowCount} rows returned in preview mode.`;
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
    pill.innerHTML = `<strong>${column.name}</strong><span>${column.dataType}${column.nullable ? "" : " | not null"}</span>`;
    tableColumnsEl.appendChild(pill);
  }
}

async function runQuery() {
  runQueryButton.disabled = true;
  queryMetaEl.textContent = "Running query...";

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

  target.appendChild(fragment);
}

function markActiveTable(schema, table) {
  for (const button of schemaListEl.querySelectorAll(".tree-item")) {
    const isActive = button.dataset.schema === schema && button.dataset.table === table;
    button.classList.toggle("is-active", isActive);
  }
}

function toggleSchema(schemaName) {
  if (state.expandedSchemas.has(schemaName)) {
    state.expandedSchemas.delete(schemaName);
  } else {
    state.expandedSchemas.add(schemaName);
  }

  renderSchema(state.schemas);
  if (state.schema && state.table) {
    markActiveTable(state.schema, state.table);
  }
}

function setMode(mode) {
  state.mode = mode;
  const showQuery = mode === "query";
  queryWorkspaceEl.classList.toggle("is-hidden", !showQuery);
  tableWorkspaceEl.classList.toggle("is-hidden", showQuery);
  queryViewButton.classList.toggle("is-selected", showQuery);
  tableViewButton.classList.toggle("is-selected", !showQuery);
  queryViewButton.classList.toggle("button--ghost", !showQuery);
  tableViewButton.classList.toggle("button--ghost", showQuery);
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
