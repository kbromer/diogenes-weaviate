Diogenes Weaviate UI

This folder contains a small lightweight admin UI for inspecting a local Weaviate instance.

Files
- `manage.js` — Express UI and API (serves on port 9090 by default).
- `package.json` — Node deps and start script.

How to run

- Start via PM2 (recommended):

```bash
pm2 start /home/admin/diogenes-weaviate/manage.js --name weaviateUI --update-env
pm2 save
pm2 logs weaviateUI
```

- Or run directly:

```bash
cd /home/admin/diogenes-weaviate
npm install
node manage.js
```

Notes
- The PM2 process name is `weaviateUI`.
- The UI is at http://localhost:9090. Enter your Weaviate base URL (e.g. http://127.0.0.1:8080) and API key if required.
- The UI exposes a POST `/info` endpoint returning `meta`, `classDetails`, and `total` counts for quick inspection.

If you want me to update local docs or scripts that previously referenced `/home/admin/weaviate`, tell me which files to change and I'll patch them.