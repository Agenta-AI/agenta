"""Retrieval primitive — RAG over markdown docs.

Protocol + simple in-memory implementation. The agent decides what to query
and how to use the results; this module just retrieves chunks.
"""

from core.retrieval.protocol import Chunk, Retriever
from core.retrieval.store import InMemoryRetriever

__all__ = ["Chunk", "Retriever", "InMemoryRetriever"]
