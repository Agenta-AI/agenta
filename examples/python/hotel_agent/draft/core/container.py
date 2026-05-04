"""Composition root.

The single place where concrete implementations are wired. Tests should NOT
call these helpers — they construct fakes directly to control the engine,
clock, and seed lifecycle.
"""

from __future__ import annotations

from pathlib import Path

from core.clock import Clock, SystemClock
from core.db.seed import seed_database
from core.db.session import create_schema, make_engine, make_session_factory
from core.deps import AgentDeps
from core.integrations.pms.fake import FakePMS
from core.retrieval.store import InMemoryRetriever


_DEFAULT_DOCS_DIR = Path(__file__).parent / "retrieval" / "docs"


async def build_default_deps(
    *,
    db_url: str = "sqlite+aiosqlite:///:memory:",
    docs_dir: Path = _DEFAULT_DOCS_DIR,
    current_user_id: str,
    seed: bool = True,
    clock: Clock | None = None,
) -> AgentDeps:
    """Build a production-shaped AgentDeps.

    The default db_url is in-memory; for a persistent demo, pass
    ``"sqlite+aiosqlite:///./hotel.db"``.
    """
    engine = make_engine(db_url)
    await create_schema(engine)
    session_factory = make_session_factory(engine)
    if seed:
        await seed_database(session_factory)

    clock = clock or SystemClock()
    pms = FakePMS(session_factory, clock)
    retriever = InMemoryRetriever.from_dir(docs_dir)

    return AgentDeps(
        pms=pms,
        retriever=retriever,
        clock=clock,
        current_user_id=current_user_id,
    )
