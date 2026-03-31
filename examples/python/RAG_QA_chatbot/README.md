# RAG QA Chatbot

A full-stack RAG (Retrieval-Augmented Generation) chatbot that answers questions based on documentation. This example demonstrates how to build a production-ready RAG system with Agenta observability.

## Features

- 📚 **Document Ingestion**: Load and chunk MDX documentation files
- 🔍 **Vector Search**: Semantic search using Qdrant with dual embedding support (OpenAI & Cohere)
- 💬 **Streaming Chat**: Real-time responses with source citations
- 📊 **Observability**: Full tracing with Agenta for debugging and evaluation
- 🎨 **Modern UI**: Beautiful chat interface built with Next.js and ai-elements

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Frontend     │────▶│  FastAPI Server │────▶│     Qdrant      │
│    (Next.js)    │     │    (Backend)    │     │  (Vector Store) │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  Agenta Cloud   │
                        │  (Observability)│
                        └─────────────────┘
```

## Prerequisites

- Python 3.10+
- Node.js 18+
- [uv](https://github.com/astral-sh/uv) (Python package manager)
- [pnpm](https://pnpm.io/) (Node.js package manager)
- A Qdrant instance (cloud or self-hosted)
- OpenAI API key
- (Optional) Cohere API key for dual embeddings
- (Optional) Agenta account for observability

## Quick Start

### 1. Clone and Setup

```bash
cd examples/python/RAG_QA_chatbot

# Copy environment file
cp env.example .env
```

### 2. Configure Environment Variables

Edit `.env` with your credentials:

```bash
# Required
QDRANT_URL=https://your-qdrant-instance.qdrant.io
QDRANT_API_KEY=your-qdrant-api-key
OPENAI_API_KEY=your-openai-api-key

# Optional (for dual embeddings)
COHERE_API_KEY=your-cohere-api-key

# Optional (for observability)
AGENTA_API_KEY=your-agenta-api-key
AGENTA_HOST=https://cloud.agenta.ai
```

### 3. Install Dependencies

```bash
# Backend (Python)
uv sync

# Frontend (Node.js)
cd frontend
pnpm install
cd ..
```

### 4. Ingest Documents

Before using the chatbot, you need to ingest your documentation:

```bash
uv run python -m ingest.run \
  --source /path/to/your/docs \
  --base-url https://docs.example.com \
  --recreate
```

**Options:**
- `--source`: Path to your MDX documentation directory
- `--base-url`: Base URL for generating source links
- `--collection`: Collection name (default: from env)
- `--chunk-size`: Maximum chunk size in characters (default: 1500)
- `--recreate`: Recreate the collection if it exists

### 5. Start the Application

**Terminal 1 - Backend:**
```bash
uv run python -m backend.main
```

The API will be available at `http://localhost:8000`

**Terminal 2 - Frontend:**
```bash
cd frontend
pnpm dev
```

The chat UI will be available at `http://localhost:3000`

## Project Structure

```
RAG_QA_chatbot/
├── backend/
│   ├── __init__.py
│   ├── config.py      # Environment configuration
│   ├── main.py        # FastAPI server
│   └── rag.py         # RAG pipeline (retrieve + generate)
├── frontend/
│   ├── app/
│   │   └── page.tsx   # Chat UI
│   ├── components/    # UI components
│   └── package.json
├── ingest/
│   ├── __init__.py
│   ├── chunker.py     # Text chunking logic
│   ├── loaders.py     # Document loaders (MDX)
│   ├── run.py         # CLI entrypoint
│   └── store.py       # Qdrant operations
├── .env               # Environment variables
├── pyproject.toml     # Python dependencies
└── README.md
```

## API Endpoints

### `POST /api/chat`

Stream a chat response using Server-Sent Events.

**Request:**
```json
{
  "messages": [
    {"role": "user", "content": "How do I create an application?"}
  ]
}
```

**Response:** SSE stream with text chunks and source URLs

### `GET /api/retrieve`

Retrieve relevant documents for a query.

**Query Parameters:**
- `query`: Search query
- `top_k`: Number of results (default: 5)

**Response:**
```json
{
  "query": "...",
  "documents": [
    {
      "title": "...",
      "url": "...",
      "content": "...",
      "score": 0.95
    }
  ]
}
```

### `GET /health`

Health check endpoint.

## Observability with Agenta

This example integrates with [Agenta](https://agenta.ai) for:

- **Tracing**: See the full RAG pipeline execution
- **Prompt Management**: Manage prompts in Agenta's registry
- **Evaluation**: Test and evaluate your RAG system

Each chat response includes a link to view the trace in Agenta.

### Prompt Management

The chatbot can fetch prompts from Agenta's registry. Create a prompt application named `query-prompt` in Agenta and deploy it to the `production` environment. The prompt should include:
- `{{context}}`: Retrieved document context
- `{{query}}`: User's question

## Testing

Run the test script to verify the RAG pipeline:

```bash
uv run python test_rag.py
```

## Customization

### Adding New Document Loaders

Edit `ingest/loaders.py` to support additional file formats:

```python
def load_markdown(docs_path: str, base_url: str) -> List[Document]:
    # Add your loader logic
    pass
```

### Changing Embedding Models

Set `EMBEDDING_MODEL` in `.env`:
- `openai`: Uses `text-embedding-ada-002`
- `cohere`: Uses `embed-english-v3.0`

### Customizing the Prompt

Either:
1. Edit the fallback `SYSTEM_PROMPT` and `USER_PROMPT_TEMPLATE` in `backend/rag.py`
2. Or use Agenta's prompt management to update prompts without code changes

## Troubleshooting

### "No documents found"
- Check your `--source` path points to a directory with `.mdx` files
- Verify the files are readable

### "Connection refused" on Qdrant
- Verify `QDRANT_URL` and `QDRANT_API_KEY` are correct
- Check your Qdrant instance is running

### Empty responses
- Ensure documents have been ingested
- Check the collection name matches in your `.env`

## License

MIT
