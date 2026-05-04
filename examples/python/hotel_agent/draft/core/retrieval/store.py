"""InMemoryRetriever — a dependency-free keyword-overlap retriever.

This is the default per architecture.md §Retrieval ("can be stubbed initially").
A real vector implementation (LanceDB / DuckDB-VSS / numpy flat index) is a
follow-up; the Protocol stays the same so swap-in is trivial.

Algorithm:
1. At index time, walk a docs directory; split each markdown file into
   paragraph chunks (blank-line separated, sized to ~500 chars).
2. Tokenize chunks into lowercased word sets.
3. Compute IDF over the corpus.
4. At query time, tokenize the query the same way and score each chunk by
   the sum of IDF for tokens it shares with the query.

Good enough to demonstrate retrieval flow; surface area for upgrade is
isolated to this file.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from core.retrieval.protocol import Chunk

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_PARAGRAPH_RE = re.compile(r"\n\s*\n")
_MAX_CHUNK_CHARS = 600


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


@dataclass
class _IndexedChunk:
    text: str
    source: str
    tokens: Counter[str]


class InMemoryRetriever:
    """Keyword-overlap RAG retriever. Async by signature for Protocol parity."""

    def __init__(self, chunks: list[_IndexedChunk], idf: dict[str, float]):
        self._chunks = chunks
        self._idf = idf

    @classmethod
    def from_dir(cls, docs_dir: Path) -> "InMemoryRetriever":
        if not docs_dir.exists():
            # Empty index is valid — caller will simply get [] from search.
            return cls(chunks=[], idf={})

        raw = list(_load_markdown_chunks(docs_dir))
        indexed = [
            _IndexedChunk(text=text, source=source, tokens=Counter(_tokenize(text)))
            for text, source in raw
        ]
        idf = _build_idf(indexed)
        return cls(chunks=indexed, idf=idf)

    @classmethod
    def from_texts(cls, items: Iterable[tuple[str, str]]) -> "InMemoryRetriever":
        """Useful in tests: build directly from (text, source) pairs."""
        indexed = [
            _IndexedChunk(text=text, source=source, tokens=Counter(_tokenize(text)))
            for text, source in items
        ]
        idf = _build_idf(indexed)
        return cls(chunks=indexed, idf=idf)

    async def search(self, query: str, k: int = 5) -> list[Chunk]:
        if not self._chunks or not query.strip():
            return []
        q_tokens = set(_tokenize(query))
        if not q_tokens:
            return []

        scored: list[tuple[float, _IndexedChunk]] = []
        for chunk in self._chunks:
            score = sum(self._idf.get(tok, 0.0) for tok in q_tokens if tok in chunk.tokens)
            if score > 0:
                scored.append((score, chunk))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [Chunk(text=ch.text, source=ch.source, score=score) for score, ch in scored[:k]]


def _load_markdown_chunks(docs_dir: Path) -> Iterable[tuple[str, str]]:
    """Walk a directory, yield (chunk_text, source_path) for each paragraph."""
    for path in sorted(docs_dir.rglob("*.md")):
        rel = path.relative_to(docs_dir).as_posix()
        text = path.read_text(encoding="utf-8")
        for chunk in _split_paragraphs(text):
            yield chunk, rel


def _split_paragraphs(text: str) -> Iterable[str]:
    """Split on blank lines; bound chunk size to roughly _MAX_CHUNK_CHARS."""
    for para in _PARAGRAPH_RE.split(text):
        para = para.strip()
        if not para:
            continue
        if len(para) <= _MAX_CHUNK_CHARS:
            yield para
            continue
        # Long paragraph: split further on sentence boundaries.
        buf: list[str] = []
        size = 0
        for sentence in re.split(r"(?<=[.!?])\s+", para):
            if size + len(sentence) > _MAX_CHUNK_CHARS and buf:
                yield " ".join(buf)
                buf, size = [], 0
            buf.append(sentence)
            size += len(sentence) + 1
        if buf:
            yield " ".join(buf)


def _build_idf(chunks: list[_IndexedChunk]) -> dict[str, float]:
    n = len(chunks)
    if n == 0:
        return {}
    df: Counter[str] = Counter()
    for ch in chunks:
        df.update(ch.tokens.keys())
    return {tok: math.log((n + 1) / (count + 1)) + 1.0 for tok, count in df.items()}
