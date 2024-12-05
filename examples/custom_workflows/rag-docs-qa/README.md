# RAG Q&A Documentation System

This project implements a RAG system for documentation Q&A. The documentation is expected to be in mdx format (we use for our tutorial our documentation using Docusaurus).

The stack used:

- Qdrant for vector database
- Cohere for embedding
- OpenAI for LLM and embedding

## Requirements

- Qdrant database set up
- Cohere API key
- OpenAI API key

## Setup

1. Set up virtual environment and install dependencies:

```bash
uv venv
source .venv/bin/activate  # On Unix/macOS
# or
.venv\scripts\activate  # On Windows

uv pip compile requirements.in --output-file requirements.txt

uv pip sync requirements.txt
```

2. Copy `.env.example` to `.env` and fill in your configuration:

```bash
cp .env.example .env

DOCS_PATH= The path to your documentation folder containing the mdx files
DOCS_BASE_URL= This is the base url of your documentation site. This will be used to generate the links in the citations.
OPENAI_API_KEY= Your OpenAI API key
COHERE_API_KEY= Your Cohere API key
COLLECTION_NAME= The name of the collection in Qdrant to store the embeddings
QDRANT_URL= The url of your Qdrant server
QDRANT_API_KEY= The API key of your Qdrant server
AGENTA_API_KEY= Your Agenta API key
```

3. Run the ingestion script:

```bash
python ingest.py
```

4. Serve the application to Agenta:

```bash
agenta init
agenta variant serve query.py
```

## Notes:

- `generate_test_set.py` is used to generate a test set of questions based on the documentation for evaluation.
