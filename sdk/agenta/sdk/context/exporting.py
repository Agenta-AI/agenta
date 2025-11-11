from typing import Optional

from contextlib import contextmanager
from contextvars import ContextVar

from pydantic import BaseModel


class ExportingContext(BaseModel):
    credentials: Optional[str] = None


exporting_context = ContextVar("exporting_context", default=ExportingContext())


@contextmanager
def exporting_context_manager(
    *,
    context: Optional[ExportingContext] = None,
):
    token = exporting_context.set(context)
    try:
        yield
    finally:
        exporting_context.reset(token)
