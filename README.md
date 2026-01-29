# Diogenes Weaviate Admin UI

A lightweight, modern web-based admin interface for managing and inspecting [Weaviate](https://weaviate.io/) vector database instances. This tool provides CRUD operations, hybrid search capabilities, and real-time server inspection through an intuitive UI.

## Features

- 🔍 **Hybrid Search** - Combine vector and keyword search with configurable alpha blending
- 📝 **CRUD Operations** - Add, list, view, and delete objects with full JSON inspection
- 🎯 **Semantic Search** - nearText queries with customizable certainty thresholds
- 📊 **Server Monitoring** - Real-time metadata, version info, and object counts per class
- 🔐 **API Key Support** - Secure authentication for protected Weaviate instances
- 💾 **Persistent Settings** - Base URL and API key stored in browser localStorage
- 🎨 **Modern Dark UI** - Clean, responsive interface with gradient design

## Prerequisites

- **Node.js** 20 or higher
- **Weaviate** instance (local or remote) - tested with version 1.34.0
- **Docker & Docker Compose** (optional, for containerized deployment)

## Installation

### Option 1: Docker Compose (Recommended)

The included `docker-compose.yml` sets up both Weaviate and the admin UI:

```bash
# Start Weaviate and transformers module
docker-compose up -d weaviate text2vec-transformers

# Optional: Build and run the admin UI in Docker
docker-compose up -d
```

This configuration includes:
- **Weaviate 1.34.0** on port 8080
- **text2vec-transformers** module with multilingual support
- Persistent data storage
- API key authentication enabled (key: `homeassistant`) with anonymous access also allowed

### Option 2: Standalone with PM2 (Recommended for production)

```bash
# Install dependencies
npm install

# Start with PM2
pm2 start manage.js --name weaviateUI --update-env
pm2 save
pm2 logs weaviateUI
```

### Option 3: Direct Node.js

```bash
# Install dependencies
npm install

# Run the server (optionally pass default Weaviate URL)
node manage.js
# or with default URL
node manage.js http://localhost:8080
```

The UI will be available at **http://localhost:9090**

## Configuration

### Environment Variables

The application uses minimal configuration. The Weaviate base URL can be passed as a command-line argument:

```bash
node manage.js http://your-weaviate-instance:8080
```

### Application Defaults

Default settings can be found in `manage.js`:

| Setting | Default Value | Description |
|---------|---------------|-------------|
| `PORT` | 9090 | Server port for the admin UI |
| `DEFAULT_LIST_LIMIT` | 20 | Number of objects to list per request |
| `DEFAULT_SEARCH_LIMIT` | 5 | Number of search results to return |
| `DEFAULT_NEARTEXT_CERTAINTY` | 0.5 | Certainty threshold for semantic search |
| `DEFAULT_SEARCH_PROPERTIES` | `["query", "content"]` | Fields to search in |

### Weaviate Configuration

If using the included `docker-compose.yml`, the Weaviate instance is configured with:

- **Port**: 8080
- **Authentication**: API key enabled (key: `homeassistant`)
- **Modules**: text2vec-transformers
- **Memory**: 2GB max, 1.5GB reserved
- **Vectorizer**: sentence-transformers-paraphrase-multilingual-MiniLM-L12-v2

## Usage

### Getting Started

1. Open http://localhost:9090 in your browser
2. Enter your Weaviate base URL (e.g., `http://localhost:8080`)
3. Enter your API key if authentication is enabled
4. Select an object class from the dropdown

### UI Features

#### Server Panel
- **Base URL**: Weaviate instance endpoint
- **API Key**: Authentication token (stored in localStorage)
- **Object Class**: Select which Weaviate class to work with
- **Info**: Displays total objects, per-class counts, and Weaviate version

#### Search Panel
- **Query**: Enter search terms
- **Alpha**: Adjust hybrid search balance (0 = keyword-only, 1 = vector-only)
- Search results show query, content, and relevance scores
- Click results to view full object details

#### Stored Content Panel
- **List View**: Shows recent objects (sorted by creation time)
- **Selected Object**: Click any item to view full JSON including vectors
- **Add Entry**: Create new objects with query and content fields
- **Delete**: Remove objects with the ✕ button

## API Endpoints

The server exposes the following REST API endpoints:

| Endpoint | Method | Purpose | Required Fields |
|----------|--------|---------|-----------------|
| `/` | GET | Serves the admin UI | None |
| `/list` | POST | List objects by class | `base`, `class`, `apiKey` (optional) |
| `/search` | POST | Hybrid or nearText search | `base`, `class`, `query`, `type`, `alpha`, `apiKey` (optional) |
| `/add` | POST | Create new object | `base`, `class`, `query`, `content`, `apiKey` (optional) |
| `/delete` | POST | Delete object by ID | `base`, `id`, `apiKey` (optional) |
| `/object` | POST | Get full object details | `base`, `id`, `apiKey` (optional) |
| `/classes` | POST | List all schema classes | `base`, `apiKey` (optional) |
| `/info` | POST | Get server metadata | `base`, `apiKey` (optional) |

### Example API Usage

```bash
# Get server info
curl -X POST http://localhost:9090/info \
  -H "Content-Type: application/json" \
  -d '{"base":"http://localhost:8080","apiKey":"homeassistant"}'

# Search for content
curl -X POST http://localhost:9090/search \
  -H "Content-Type: application/json" \
  -d '{
    "base":"http://localhost:8080",
    "class":"YourClassName",
    "query":"search term",
    "type":"hybrid",
    "alpha":0.5,
    "apiKey":"homeassistant"
  }'
```

## Search Capabilities

### Hybrid Search (Default)
Combines keyword (BM25) and vector similarity search:
- **Alpha = 0**: Pure keyword search
- **Alpha = 0.5**: Balanced hybrid (default)
- **Alpha = 1**: Pure vector search
- Search properties: `["query", "content"]` by default
- Returns relevance scores

### nearText Search
Semantic similarity using vector embeddings:
- Certainty threshold: 0.5 by default (range: 0-1)
- Higher certainty = stricter matching
- Returns `content` field and certainty scores (note: `query` field not included in results)

## Technology Stack

- **Backend**: Node.js with Express.js
- **HTTP Client**: node-fetch for Weaviate API calls
- **Frontend**: Vanilla JavaScript with embedded CSS
- **UI Framework**: Custom responsive design with CSS Grid
- **API**: GraphQL and REST endpoints to Weaviate
- **Containerization**: Docker with Alpine-based Node.js 20 image

## File Structure

```
.
├── manage.js           # Main Express server and UI
├── package.json        # Node.js dependencies
├── Dockerfile          # Container image definition
├── docker-compose.yml  # Full stack deployment
└── README.md          # This file
```

## Troubleshooting

### UI shows "Error fetching info"
- Verify Weaviate is running and accessible at the base URL
- Check that the API key is correct (if authentication is enabled)
- Ensure no CORS issues (Weaviate should allow requests from the UI)

### No classes appear in dropdown
- Ensure your Weaviate instance has at least one schema class defined
- Verify the base URL includes the protocol (http:// or https://)
- Check browser console for GraphQL errors

### Search returns no results
- Verify objects exist in the selected class
- For nearText search, ensure text2vec-transformers module is enabled
- Try adjusting alpha (hybrid) or certainty (nearText) parameters

### PM2 process keeps restarting
- Check logs with `pm2 logs weaviateUI`
- Verify port 9090 is not already in use
- Ensure Node.js version is 20 or higher

### Docker container won't start
- Check if port 9090 is available: `lsof -i :9090`
- Verify Weaviate container is running: `docker ps`
- Check container logs: `docker logs <container-name>`

## Development

To modify the UI, edit the `renderPage()` function in `manage.js`. The UI is served as an inline HTML string with embedded JavaScript and CSS.

### Code Structure

- **Helper Functions**: `weaviateFetch()`, `asyncHandler()`, `escapeGraphQL()`
- **Query Builders**: `buildListQuery()`, `buildSearchQuery()`, `buildAggregateQuery()`
- **API Routes**: Express endpoints for CRUD and search operations
- **UI Rendering**: `renderPage()` returns complete HTML/CSS/JS

## Contributing

This is a lightweight admin tool designed for local Weaviate inspection. Contributions are welcome!

## License

ISC

## Notes

- The PM2 process name is `weaviateUI`
- Settings (base URL and API key) persist in browser localStorage
- Object list is sorted by creation time (newest first)
- Vector data is included when viewing individual objects
- GraphQL errors are logged to server console for debugging

## Credits

Built for managing Weaviate vector databases with a focus on simplicity and developer experience.