"""Vector store operations for Qdrant."""

import hashlib
import os
from dataclasses import dataclass
from typing import Dict, List

from litellm import embedding
from qdrant_client import QdrantClient
from qdrant_client.http import models

# Embedding dimensions
OPENAI_EMBEDDING_DIM = 1536  # text-embedding-ada-002
COHERE_EMBEDDING_DIM = 1024  # embed-english-v3.0


@dataclass
class Chunk:
    """A chunk with content and metadata."""

    content: str
    title: str
    url: str
    file_path: str
    chunk_index: int


def get_qdrant_client() -> QdrantClient:
    """Create a Qdrant client from environment variables."""
    return QdrantClient(
        url=os.getenv("QDRANT_URL"), api_key=os.getenv("QDRANT_API_KEY")
    )


def setup_collection(
    client: QdrantClient, collection_name: str, recreate: bool = False
):
    """
    Create the vector collection with dual embedding support.

    Args:
        client: Qdrant client
        collection_name: Name of the collection
        recreate: If True, delete existing collection first
    """
    # Check if collection exists
    collections = client.get_collections().collections
    exists = any(c.name == collection_name for c in collections)

    if exists:
        if recreate:
            print(f"Deleting existing collection: {collection_name}")
            client.delete_collection(collection_name)
        else:
            print(
                f"Collection {collection_name} already exists. Use --recreate to rebuild."
            )
            return

    print(f"Creating collection: {collection_name}")
    client.create_collection(
        collection_name=collection_name,
        vectors_config={
            "openai": models.VectorParams(
                size=OPENAI_EMBEDDING_DIM, distance=models.Distance.COSINE
            ),
            "cohere": models.VectorParams(
                size=COHERE_EMBEDDING_DIM, distance=models.Distance.COSINE
            ),
        },
    )


def get_embeddings(text: str) -> Dict[str, List[float]]:
    """
    Get embeddings using both OpenAI and Cohere models.

    Args:
        text: Text to embed

    Returns:
        Dict with 'openai' and 'cohere' embeddings
    """
    # OpenAI embedding
    openai_response = embedding(model="text-embedding-ada-002", input=[text])
    openai_embedding = openai_response["data"][0]["embedding"]

    # Cohere embedding
    cohere_response = embedding(
        model="cohere/embed-english-v3.0",
        input=[text],
        input_type="search_document",
    )
    cohere_embedding = cohere_response["data"][0]["embedding"]

    return {"openai": openai_embedding, "cohere": cohere_embedding}


def generate_chunk_id(chunk: Chunk) -> str:
    """Generate a unique ID for a chunk based on content and position."""
    content_hash = hashlib.md5(
        f"{chunk.file_path}:{chunk.chunk_index}:{chunk.content[:100]}".encode()
    ).hexdigest()
    return content_hash


def upsert_chunks(client: QdrantClient, collection_name: str, chunks: List[Chunk]):
    """
    Upsert chunks to the vector store.

    Args:
        client: Qdrant client
        collection_name: Name of the collection
        chunks: List of chunks to upsert
    """
    for chunk in chunks:
        # Get embeddings
        embeddings = get_embeddings(chunk.content)

        # Create payload
        payload = {
            "content": chunk.content,
            "title": chunk.title,
            "url": chunk.url,
            "file_path": chunk.file_path,
            "chunk_index": chunk.chunk_index,
        }

        # Generate unique ID
        point_id = generate_chunk_id(chunk)

        # Upsert to Qdrant
        client.upsert(
            collection_name=collection_name,
            points=[
                models.PointStruct(
                    id=point_id,
                    payload=payload,
                    vector=embeddings,
                )
            ],
        )
