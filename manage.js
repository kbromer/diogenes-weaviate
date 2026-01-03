import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = 9090;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const defaultBaseUrl = process.argv[2] || '';

async function weaviateFetch(base, path, apiKey, options = {}) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/* ---------- Routes ---------- */

app.get("/", (_, res) => res.send(renderPage()));

app.post("/list", async (req, res) => {
  try {
    const data = await weaviateFetch(req.body.base, "/v1/graphql", req.body.apiKey, {
      method: "POST",
      body: JSON.stringify({
        query: `{
          Get {
            ${req.body.class}(
              limit: 20
              sort: [{ path: ["_creationTimeUnix"], order: desc }]
            ) {
              query
              content
              _additional { id }
            }
          }
        }`,
      }),
    });
    if (data?.errors?.length) console.error('weaviate graphql /list errors', data.errors);
    res.json(data?.data?.Get?.[req.body.class] ?? []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/add", async (req, res) => {
  try {
    await weaviateFetch(req.body.base, "/v1/objects", req.body.apiKey, {
      method: "POST",
      body: JSON.stringify({
        class: req.body.class,
        properties: {
          query: req.body.query,
          content: req.body.content,
        },
      }),
    });
    res.sendStatus(200);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/delete", async (req, res) => {
  try {
    await weaviateFetch(req.body.base, `/v1/objects/${req.body.id}`, req.body.apiKey, {
      method: "DELETE",
    });
    res.sendStatus(200);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/object', async (req, res) => {
  const { base, apiKey, id } = req.body;
  if (!base) return res.status(400).json({ error: 'Missing base URL' });
  if (!id) return res.status(400).json({ error: 'Missing object id' });

  try {
    const doFetch = async (path) => {
      const resp = await fetch(`${base}${path}`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        }
      });
      const text = await resp.text();
      if (!resp.ok) {
        const msg = text?.trim() ? text.trim() : `${resp.status} ${resp.statusText}`;
        throw new Error(msg);
      }
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(text?.trim() ? text.trim() : 'Invalid JSON response');
      }
    };

    let obj;
    try {
      obj = await doFetch(`/v1/objects/${encodeURIComponent(id)}?include=vector`);
    } catch (e) {
      obj = await doFetch(`/v1/objects/${encodeURIComponent(id)}`);
    }

    res.json(obj);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/search", async (req, res) => {
  const gql =
    req.body.type === "hybrid"
      ? `{
          Get {
            ${req.body.class}(
              hybrid: {
                query: "${req.body.query}"
                properties: ["query","content"]
                alpha: ${req.body.alpha}
              }
              limit: 5
            ) {
              query
              content
              _additional { id score }
            }
          }
        }`
      : `{
          Get {
            ${req.body.class}(
              nearText: { concepts: ["${req.body.query}"], certainty: 0.5 }
              limit: 5
            ) {
              content
              _additional { id certainty }
            }
          }
        }`;
  try {
    const data = await weaviateFetch(req.body.base, "/v1/graphql", req.body.apiKey, {
      method: "POST",
      body: JSON.stringify({ query: gql }),
    });
    if (data?.errors?.length) console.error('weaviate graphql /search errors', data.errors);
    res.json(data?.data?.Get?.[req.body.class] ?? []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/classes", async (req, res) => {
  const { base } = req.body;
  if (!base) return res.status(400).json({ error: "Missing base URL" });

  try {
    const result = await fetch(`${base}/v1/graphql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${req.body.apiKey}`,
      },
      body: JSON.stringify({
        query: `
          {
            __schema {
              types {
                name
                fields {
                  name
                }
              }
            }
          }
        `,
      }),
    });

    if (!result.ok) throw new Error(await result.text());
    const json = await result.json();

	const types = json.data.__schema.types.find((type) => type.name === "GetObjectsObj")?.fields
    res.json(types?.map((type) => type.name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/info', async (req, res) => {
  const { base, apiKey } = req.body;
  if (!base) return res.status(400).json({ error: 'Missing base URL' });

  async function aggregateCountForClass(className) {
    const gql = `{
      Aggregate {
        ${className} {
          meta { count }
        }
      }
    }`;

    const data = await weaviateFetch(base, '/v1/graphql', apiKey, {
      method: 'POST',
      body: JSON.stringify({ query: gql }),
    });

    const count = data?.data?.Aggregate?.[className]?.[0]?.meta?.count;
    return typeof count === 'number' ? count : null;
  }

  try {
    const meta = await weaviateFetch(base, '/v1/meta', apiKey);
    const schema = await weaviateFetch(base, '/v1/schema', apiKey);

    const classes = schema?.classes || [];
    const classDetails = {};
    let total = 0;

    await Promise.all(classes.map(async (c) => {
      const className = c.class || c.name || c;
      const details = {
        name: className,
        vectorizer: c.vectorizer || null,
        vectorIndexType: c.vectorIndexType || null,
        properties: Array.isArray(c.properties) ? c.properties.map((p) => p.name) : undefined,
        count: null,
      };

      try {
        details.count = await aggregateCountForClass(className);
        if (typeof details.count === 'number') total += details.count;
      } catch (e) {
        console.error('count error for', className, e.message);
      }

      classDetails[className] = details;
    }));

    res.json({ meta, classes: classes.map((c) => c.class || c.name), classDetails, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* ---------- UI ---------- */

function renderPage() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Weaviate RAG Admin</title>
<meta name="viewport" content="width=device-width, initial-scale=1">

<style>
:root {
  --bg1: #1b2040;
  --bg2: #0f1220;
  --panel: #171a2b;
  --accent: #6cf2c2;
  --muted: #9aa0c3;
}

* { box-sizing: border-box }

html {
  min-height: 100%;
}

body {
  min-height: 100%;
  margin: 0;
  font-family: system-ui;
  color: #fff;
  background: linear-gradient(180deg, var(--bg1), var(--bg2));
  background-attachment: fixed;
}

header {
  max-width: 1200px;
  margin: 0 auto;
  padding: 30px 20px 10px;
}

.app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 20px 30px;
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 20px;
}

.panel {
  background: linear-gradient(180deg, #1a1e35, var(--panel));
  border-radius: 14px;
  padding: 16px;
}

.sidebar {
  align-self: start;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.sidebar > div {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

h1 { margin: 0 }
h2 { margin: 0 }

input, textarea, button, select {
  background: #101324;
  border: 1px solid #2a2f55;
  color: #fff;
  padding: 10px;
  border-radius: 8px;
}

button {
  background: linear-gradient(135deg, var(--accent), #58d8ff);
  color: #000;
  font-weight: 600;
  cursor: pointer;
  align-self: flex-start;
}

button:disabled { opacity: .5 }

.col { display: flex; flex-direction: column; gap: 10px }
.row { display: flex; gap: 10px; align-items: center }

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.list {
  max-height: 360px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card {
  background: #0f1328;
  padding: 12px;
  border-radius: 10px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.json {
  background: #0f1328;
  border: 1px solid #2a2f55;
  border-radius: 10px;
  padding: 10px;
  margin: 0;
  max-height: 260px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.card.selected {
  outline: 1px solid var(--accent);
}

.small { font-size: 12px; color: var(--muted) }

.results > div {
  background: #0f1328;
  padding: 8px;
  border-radius: 8px;
}

.right-align {
  text-align: right;
}

.bold {
	font-weight: bold;
}
</style>
</head>

<body>

<header>
  <h1>Weaviate RAG Admin</h1>
</header>

<div class="app">

  <!-- LEFT -->
  <div class="col">

    <div class="panel col">
      <h2>Search</h2>
      <div class="row">
      	<label class="col" style="flex:1">
      		Query
        	<input id="searchInput" placeholder="Search…">
        </label>
		<label class="col">
      		Alpha
        	<input id="hybridAlpha" type="number" value="0.5">
        </label>
      </div>
      <div class="row right-align">
        <button onclick="runSearch()">Go</button>
      </div>
      <div id="searchResults" class="results col"></div>
    </div>

    <div class="panel col">
      <div class="section-header">
        <h2>Stored Content</h2>
        <button onclick="refreshList()">Refresh</button>
      </div>

      <div id="list" class="list"></div>

      <hr style="opacity:.2">

      <h3>Selected Object</h3>
      <div id="selectedMeta" class="small">Click an item to view what Weaviate is storing.</div>
      <pre id="selectedJson" class="json"></pre>

      <hr style="opacity:.2">

      <h3>Add Entry</h3>
      <input id="addQuery" placeholder="Query">
      <textarea id="addContent" rows="3" placeholder="Content"></textarea>
      <button id="addBtn" onclick="addItem()">Add</button>
    </div>

  </div>

  <!-- SIDEBAR -->
  <div class="panel sidebar">
  <div>
    <h2>Server</h2>
    <input id="baseUrl" placeholder="http://localhost:8080">
    <input id="apiKey" placeholder="API Key">
  </div>

  <div>
    <h2>Info</h2>
    <div id="stats" class="small">-</div>
    <div id="info" class="small">-</div>
  </div>

  <div>
    <h2>Object Class</h2>
    <select id="objectClass"></select>
  </div>
  </div>

</div>

<script>
const baseInput = document.getElementById('baseUrl');
const objectClasses = document.getElementById("objectClass");
const apiKeyInput = document.getElementById("apiKey");
//const searchType = document.getElementById("searchType");
const hybridAlpha = document.getElementById('hybridAlpha');
const statsDiv = document.getElementById('stats');
const selectedMeta = document.getElementById('selectedMeta');
const selectedJson = document.getElementById('selectedJson');
let selectedId = null;

baseInput.value = "${defaultBaseUrl}" || localStorage.getItem('weaviateBase') || '';
apiKeyInput.value = localStorage.getItem('weaviateApiKey') || '';

baseInput.addEventListener('change', async () => {
  localStorage.setItem('weaviateBase', baseInput.value);
  await refreshInfo();
  await refreshClasses();
});

objectClasses.addEventListener('change', async () => {
  await refreshList();
  await refreshInfo();
});

apiKeyInput.addEventListener('change', async () => {
  localStorage.setItem('weaviateApiKey', apiKeyInput.value);
  await refreshInfo();
  await refreshClasses();
});

const base = () => baseInput.value.trim();

const infoDiv = document.getElementById('info');

async function refreshList() {
  const res = await fetch('/list', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ base: base(), class: objectClasses.value, apiKey: apiKeyInput.value })
  });

  const items = await res.json();
  const list = document.getElementById('list');
  list.innerHTML = '';

  items.forEach(i => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cursor = 'pointer';
    card.onclick = () => selectObject(i._additional?.id);

    const left = document.createElement('div');

    const id = document.createElement('div');
    id.className = 'small';
    id.textContent = i._additional.id;

    const q = document.createElement('strong');
    q.textContent = i.query;

    const c = document.createElement('div');
    c.textContent = i.content;

    left.append(id, q, c);

    const del = document.createElement('button');
    del.textContent = '✕';
    del.onclick = (e) => {
      e.stopPropagation();
      delItem(i._additional.id);
    };

    card.append(left, del);
    list.appendChild(card);
  });

  highlightSelected();
}

function highlightSelected() {
  const list = document.getElementById('list');
  if (!list) return;
  const cards = list.querySelectorAll('.card');
  cards.forEach((c) => c.classList.remove('selected'));
  if (!selectedId) return;

  for (const card of cards) {
    const idEl = card.querySelector('.small');
    if (idEl && idEl.textContent === selectedId) {
      card.classList.add('selected');
      break;
    }
  }
}

async function selectObject(id) {
  if (!id) return;
  selectedId = id;
  highlightSelected();

  if (selectedMeta) selectedMeta.textContent = 'Loading ' + id + '…';
  if (selectedJson) selectedJson.textContent = '';

  try {
    const res = await fetch('/object', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base: base(), apiKey: apiKeyInput.value, id })
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => String(res.status));
      if (selectedMeta) selectedMeta.textContent = 'Error loading object: ' + txt;
      return;
    }

    const obj = await res.json();
    const cls = obj?.class || '-';
    if (selectedMeta) selectedMeta.textContent = 'id: ' + id + ' — class: ' + cls;
    if (selectedJson) selectedJson.textContent = JSON.stringify(obj, null, 2);
  } catch (e) {
    if (selectedMeta) selectedMeta.textContent = 'Error loading object: ' + (e?.message || String(e));
  }
}

async function refreshClasses() {
  const res = await fetch('/classes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base: base(), apiKey: apiKeyInput.value })
  });

  if (!res.ok) {
  	console.error(res)
  	return;
  }

  const items = await res.json();

  objectClasses.innerHTML = "";

  // populate select
  items.forEach(item => {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = item;
    objectClasses.appendChild(option);
  });

  await refreshList();
  await refreshInfo();
}

async function refreshInfo() {
  if (!base()) {
    if (statsDiv) statsDiv.innerHTML = '<span class="bold">Objects:</span> - (set Base URL)';
    infoDiv.innerHTML = '-';
    return;
  }
  const res = await fetch('/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base: base(), apiKey: apiKeyInput.value })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => String(res.status));
    infoDiv.innerHTML = '<div class="small">Error fetching info: ' + txt + '</div>';
    if (statsDiv) statsDiv.innerHTML = '<span class="bold">Objects:</span> - (error)';
    console.error('info fetch error', txt);
    return;
  }

  const data = await res.json();
  const total = data.total ?? 'unknown';
  const selectedClass = objectClasses.value;
  const selectedCount = (data.classDetails && selectedClass && data.classDetails[selectedClass])
    ? data.classDetails[selectedClass].count
    : null;

  if (statsDiv) {
    const classPart = selectedClass
      ? ' — ' + selectedClass + ': ' + (typeof selectedCount === 'number' ? selectedCount : 'unknown')
      : '';
    statsDiv.innerHTML = '<span class="bold">Objects:</span> ' + total + classPart;
  }
  let html = '<div class="small"><span class="bold">Total objects:</span> ' + total + '</div>';

  if (data.classDetails && Object.keys(data.classDetails).length) {
    html += '<div class="small" style="margin-top:8px"><span class="bold">Per-class objects:</span></div>';
    const entries = Object.entries(data.classDetails)
      .map(([k, v]) => [k, v?.count])
      .sort((a, b) => {
        const av = typeof a[1] === 'number' ? a[1] : -1;
        const bv = typeof b[1] === 'number' ? b[1] : -1;
        return bv - av;
      });

    for (const [k, countVal] of entries) {
      const count = typeof countVal === 'number' ? countVal : 'unknown';
      html += '<div class="small">' + k + ': ' + count + '</div>';
    }
  }

  // also show basic meta
  if (data.meta) {
    const ver = (data.meta.version && data.meta.version.full) ? data.meta.version.full : JSON.stringify(data.meta.version || '-');
    html += '<div class="small" style="margin-top:8px">Weaviate version: ' + ver + '</div>';
  }

  infoDiv.innerHTML = html;
}

async function addItem() {
  addBtn.disabled = true;
  await fetch('/add', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      base: base(),
      query: addQuery.value,
      content: addContent.value,
      class: objectClasses.value,
      apiKey: apiKeyInput.value
    })
  });
  addQuery.value = '';
  addContent.value = '';
  addBtn.disabled = false;
  refreshList();
}

async function delItem(id) {
  await fetch('/delete', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ base: base(), id, apiKey: apiKeyInput.value })
  });
  refreshList();
}

async function runSearch() {
  const res = await fetch('/search', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      base: base(),
//      type: searchType.value,
	  type: "hybrid",
	  alpha: hybridAlpha.value,
      query: searchInput.value,
      class: objectClasses.value,
      apiKey: apiKeyInput.value
    })
  });

  if (!res.ok) {
  	console.error(res)
  	return;
  }

  const data = await res.json();
  const out = document.getElementById('searchResults');
  out.innerHTML = '';

  data.forEach(i => {
	const result = document.createElement('div');
	result.className = 'col';
	result.style.gap = 'none';
  if (i?._additional?.id) {
    result.style.cursor = 'pointer';
    result.onclick = () => selectObject(i._additional.id);
  }

	const queryRow = document.createElement('div');
	const contentRow = document.createElement('div');
	const scoreRow = document.createElement('div');

	const score = i._additional.score ?? i._additional.certainty;

	queryRow.textContent = \`\${i.query}\`;
	contentRow.textContent = \`\${i.content}\`;
	scoreRow.textContent = \`Score: \${score}\`;

	queryRow.className = 'bold';

	for (let ele of [queryRow,  contentRow, scoreRow])
		result.appendChild(ele)

	out.appendChild(result);
  });
}

refreshClasses();
</script>

</body>
</html>`;
}

app.listen(PORT, () => {
  console.log(`UI running at http://localhost:${PORT}`);
});
