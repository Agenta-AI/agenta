"""Retriever Protocol.

The agent decides what to query and how to weave results into responses.
Wrapping retrieval in semantic methods (``get_cancellation_policy()``) would
push agent logic into infrastructure and obscure how RAG actually works.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict


class Chunk(BaseModel):
    """One retrievable piece of text plus where it came from."""

    model_config = ConfigDict(frozen=True)

    text: str
    source: str
    score: float


@runtime_checkable
class Retriever(Protocol):
    async def search(self, query: str, k: int = 5) -> list[Chunk]: ...
