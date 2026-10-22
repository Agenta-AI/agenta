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
