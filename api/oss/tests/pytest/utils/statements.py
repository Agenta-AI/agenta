"""Count the SQL statements a block of code sends through an async engine."""

from contextlib import contextmanager
from typing import Iterator, List

from sqlalchemy import event


def _sync_engine(engine):
    # `TransactionsEngine` wraps the SQLAlchemy `AsyncEngine` it builds.
    inner = getattr(engine, "_engine", engine)
    return inner.sync_engine


@contextmanager
def count_statements(engine) -> Iterator[List[str]]:
    """Yield the list of statements sent while the block runs.

    Counts what reaches the cursor (`before_cursor_execute`), so `BEGIN`, `COMMIT` and
    the pool pre-ping are not counted.
    """

    statements: List[str] = []
    sync_engine = _sync_engine(engine)

    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(sync_engine, "before_cursor_execute", _record)
    try:
        yield statements
    finally:
        event.remove(sync_engine, "before_cursor_execute", _record)


# -- statements by phase (M2) ---------------------------------------------------------
#
# A statement is counted in the phase that is current in the task that sends it. The
# phase is a ContextVar, so statements of concurrent tasks are not mixed. Product code
# has no phase logic: `patch_access_phase` wraps `AccessService._decide` and
# `AccessService.check_eligibility`, so every statement sent while a decision runs is an
# access-decision statement, and every other statement is an endpoint statement.

from contextvars import ContextVar  # noqa: E402
from typing import Dict  # noqa: E402

statement_phase: ContextVar[str] = ContextVar("statement_phase", default="endpoint")


@contextmanager
def phase(name: str):
    token = statement_phase.set(name)
    try:
        yield
    finally:
        statement_phase.reset(token)


@contextmanager
def count_statements_by_phase(engine) -> Iterator[Dict[str, List[str]]]:
    """Yield `{"access": [...], "endpoint": [...]}`, the statements sent while the
    block runs, by phase."""

    statements: Dict[str, List[str]] = {"access": [], "endpoint": []}
    sync_engine = _sync_engine(engine)

    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.setdefault(statement_phase.get(), []).append(statement)

    event.listen(sync_engine, "before_cursor_execute", _record)
    try:
        yield statements
    finally:
        event.remove(sync_engine, "before_cursor_execute", _record)


def patch_access_phase(monkeypatch) -> None:
    """Run every access decision in the "access" phase."""

    from oss.src.core.access.service import AccessService  # noqa: PLC0415

    original_decide = AccessService._decide
    original_eligibility = AccessService.check_eligibility

    async def _decide(self, **kwargs):
        with phase("access"):
            return await original_decide(self, **kwargs)

    async def _eligibility(self, **kwargs):
        with phase("access"):
            return await original_eligibility(self, **kwargs)

    monkeypatch.setattr(AccessService, "_decide", _decide)
    monkeypatch.setattr(AccessService, "check_eligibility", _eligibility)
