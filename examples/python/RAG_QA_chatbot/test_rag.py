"""Simple test script for RAG logic."""

import asyncio

from backend.rag import rag_query, retrieve


def test_retrieve():
    """Test retrieval only."""
    print("=" * 50)
    print("Testing RETRIEVE")
    print("=" * 50)

    query = "How do I create an application in Agenta?"
    docs = retrieve(query, top_k=3)

    print(f"Query: {query}")
    print(f"Found {len(docs)} documents:\n")

    for i, doc in enumerate(docs, 1):
        print(f"[{i}] {doc.title} (score: {doc.score:.3f})")
        print(f"    URL: {doc.url}")
        print(f"    Content: {doc.content[:200]}...")
        print()


async def test_generate():
    """Test full RAG pipeline with streaming."""
    print("=" * 50)
    print("Testing RAG (retrieve + generate)")
    print("=" * 50)

    query = "How do I create an application in Agenta?"
    print(f"Query: {query}\n")
    print("Response:")

    async for chunk in rag_query(query):
        print(chunk, end="", flush=True)

    print("\n")


if __name__ == "__main__":
    # Test retrieve first
    test_retrieve()

    # Then test full RAG
    asyncio.run(test_generate())
