"""CLI entrypoint for document ingestion."""

import argparse
import os

from dotenv import load_dotenv
from tqdm import tqdm

from .chunker import chunk_text
from .loaders import load_mdx
from .store import Chunk, get_qdrant_client, setup_collection, upsert_chunks


def main():
    parser = argparse.ArgumentParser(description="Ingest documents into vector store")
    parser.add_argument("--source", required=True, help="Path to docs directory")
    parser.add_argument("--base-url", required=True, help="Base URL for doc links")
    parser.add_argument(
        "--collection", default=None, help="Collection name (default: from env)"
    )
    parser.add_argument(
        "--recreate", action="store_true", help="Recreate collection if exists"
    )
    parser.add_argument(
        "--chunk-size", type=int, default=1500, help="Max chunk size in chars"
    )

    args = parser.parse_args()

    # Load environment variables
    load_dotenv()

    # Get collection name from args or env
    collection_name = args.collection or os.getenv("COLLECTION_NAME", "docs_collection")

    print(f"Loading documents from: {args.source}")
    print(f"Base URL: {args.base_url}")
    print(f"Collection: {collection_name}")
    print(f"Chunk size: {args.chunk_size}")
    print()

    # Load documents
    documents = load_mdx(args.source, args.base_url)
    print(f"Loaded {len(documents)} documents")

    if not documents:
        print("No documents found. Check your --source path.")
        return

    # Setup Qdrant
    client = get_qdrant_client()
    setup_collection(client, collection_name, recreate=args.recreate)

    # Process each document
    total_chunks = 0
    for doc in tqdm(documents, desc="Processing documents"):
        # Chunk the content
        text_chunks = chunk_text(doc.content, max_chunk_size=args.chunk_size)

        # Create Chunk objects
        chunks = [
            Chunk(
                content=text,
                title=doc.title,
                url=doc.url,
                file_path=doc.file_path,
                chunk_index=i,
            )
            for i, text in enumerate(text_chunks)
        ]

        # Upsert to store
        upsert_chunks(client, collection_name, chunks)
        total_chunks += len(chunks)

    print(f"\nDone! Ingested {total_chunks} chunks from {len(documents)} documents.")


if __name__ == "__main__":
    main()
