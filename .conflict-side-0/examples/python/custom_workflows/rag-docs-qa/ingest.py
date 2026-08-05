import os
import glob
from typing import List, Dict
import hashlib
from datetime import datetime
import frontmatter
from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.http import models
from litellm import embedding
import tqdm

# Load environment variables
load_dotenv()

# Constants
OPENAI_EMBEDDING_DIM = 1536  # For text-embedding-ada-002
COHERE_EMBEDDING_DIM = 1024  # For embed-english-v3.0
COLLECTION_NAME = "docs_collection"

# Initialize Qdrant client
qdrant_client = QdrantClient(
    url=os.getenv("QDRANT_URL"), api_key=os.getenv("QDRANT_API_KEY")
)


def get_all_docs(docs_path: str) -> List[str]:
    """Get all MDX files in the docs directory."""
    return glob.glob(os.path.join(docs_path, "**/*.mdx"), recursive=True)


def calculate_doc_hash(content: str) -> str:
    """Calculate a hash for the document content."""
    return hashlib.md5(content.encode()).hexdigest()


def get_doc_url(file_path: str, docs_path: str, docs_base_url: str) -> str:
    """Convert file path to documentation URL."""
    relative_path = os.path.relpath(file_path, docs_path)
    # Remove .mdx extension and convert to URL path
    url_path = os.path.splitext(relative_path)[0]
    return f"{docs_base_url}/{url_path}"


def chunk_text(text: str, max_chunk_size: int = 1500) -> List[str]:
    """
    Split text into chunks based on paragraphs and size.
    Tries to maintain context by keeping paragraphs together when possible.
    """
    # Split by double newlines to preserve paragraph structure
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    chunks = []
    current_chunk = []
    current_size = 0

    for paragraph in paragraphs:
        paragraph_size = len(paragraph)

        # If a single paragraph is too large, split it by sentences
        if paragraph_size > max_chunk_size:
            sentences = [s.strip() + "." for s in paragraph.split(".") if s.strip()]
            for sentence in sentences:
                if len(sentence) > max_chunk_size:
                    # If even a sentence is too long, split it by chunks
                    for i in range(0, len(sentence), max_chunk_size):
                        chunks.append(sentence[i : i + max_chunk_size])
                elif current_size + len(sentence) > max_chunk_size:
                    # Start new chunk
                    chunks.append(" ".join(current_chunk))
                    current_chunk = [sentence]
                    current_size = len(sentence)
                else:
                    current_chunk.append(sentence)
                    current_size += len(sentence)
        # If adding this paragraph would exceed the limit, start a new chunk
        elif current_size + paragraph_size > max_chunk_size:
            chunks.append(" ".join(current_chunk))
            current_chunk = [paragraph]
            current_size = paragraph_size
        else:
            current_chunk.append(paragraph)
            current_size += paragraph_size

    # Add the last chunk if it exists
    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return chunks


def process_doc(file_path: str, docs_path: str, docs_base_url: str) -> List[Dict]:
    """Process a single document into chunks with metadata."""
    with open(file_path, "r", encoding="utf-8") as f:
        # Parse frontmatter and content
        post = frontmatter.load(f)
        content = post.content

        # Calculate document hash
        doc_hash = calculate_doc_hash(content)

        # Get document URL
        doc_url = get_doc_url(file_path, docs_path, docs_base_url)

        # Create base metadata
        metadata = {
            "title": post.get("title", ""),
            "url": doc_url,
            "file_path": file_path,
            "last_updated": datetime.utcnow().isoformat(),
            "doc_hash": doc_hash,
        }

        # Chunk the content
        chunks = chunk_text(content)

        return [
            {"content": chunk, "metadata": metadata, "doc_hash": doc_hash}
            for chunk in chunks
        ]


def get_embeddings(text: str) -> Dict[str, List[float]]:
    """Get embeddings using both OpenAI and Cohere models via LiteLLM."""
    # Get OpenAI embedding
    openai_response = embedding(model="text-embedding-ada-002", input=[text])
    openai_embedding = openai_response["data"][0]["embedding"]

    # Get Cohere embedding
    cohere_response = embedding(
        model="cohere/embed-english-v3.0",
        input=[text],
        input_type="search_document",  # Specific to Cohere v3 models
    )
    cohere_embedding = cohere_response["data"][0]["embedding"]

    return {"openai": openai_embedding, "cohere": cohere_embedding}


def setup_qdrant_collection():
    """Create or recreate the vector collection."""
    # Delete if exists
    try:
        qdrant_client.delete_collection(COLLECTION_NAME)
    except Exception:
        pass

    # Create collection with two vector types
    qdrant_client.create_collection(
        collection_name=COLLECTION_NAME,
        vectors_config={
            "openai": models.VectorParams(
                size=OPENAI_EMBEDDING_DIM, distance=models.Distance.COSINE
            ),
            "cohere": models.VectorParams(
                size=COHERE_EMBEDDING_DIM, distance=models.Distance.COSINE
            ),
        },
    )


def upsert_chunks(chunks: List[Dict]):
    """Upsert document chunks to the vector store."""
    for i, chunk in enumerate(chunks):
        # Get both embeddings using LiteLLM
        embeddings = get_embeddings(chunk["content"])

        # Create payload
        payload = {**chunk["metadata"], "content": chunk["content"], "chunk_index": i}

        # Upsert to Qdrant
        qdrant_client.upsert(
            collection_name=COLLECTION_NAME,
            points=[
                models.PointStruct(
                    id=f"{chunk['doc_hash']}",
                    payload=payload,
                    vector=embeddings,  # Contains both 'openai' and 'cohere' embeddings
                )
            ],
        )


def main():
    # Get environment variables
    docs_path = os.getenv("DOCS_PATH")
    docs_base_url = os.getenv("DOCS_BASE_URL")

    if not docs_path or not docs_base_url:
        raise ValueError("DOCS_PATH and DOCS_BASE_URL must be set in .env file")

    # Create fresh collection
    setup_qdrant_collection()

    # Process all documents
    all_docs = get_all_docs(docs_path)
    for doc_path in tqdm.tqdm(all_docs):
        print(f"Processing {doc_path}")
        chunks = process_doc(doc_path, docs_path, docs_base_url)
        upsert_chunks(chunks)


if __name__ == "__main__":
    main()
