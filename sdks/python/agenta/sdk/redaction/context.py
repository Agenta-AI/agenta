"""Ambient per-request/run `Redactor`, same ContextVar shape as `agenta.sdk.contexts.tracing`.

Lets sinks that don't have a request object in hand (e.g. `wire.py`'s `result_from_wire`, deep
in the streaming path) still reach the active deny-set without threading a parameter through
every call site.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Optional

from .redactor import Redactor

_redactor_context: ContextVar[Redactor] = ContextVar("ag.redaction_context")


def get_active_redactor() -> Redactor:
    """The current request/run's redactor, or an empty (no-op) one outside any request."""
    try:
        return _redactor_context.get()
    except LookupError:
        return Redactor()


def set_active_redactor(redactor: Redactor) -> Token:
    return _redactor_context.set(redactor)


def reset_active_redactor(token: Token) -> None:
    _redactor_context.reset(token)


@contextmanager
def redaction_context(redactor: Optional[Redactor] = None):
    token = set_active_redactor(redactor or Redactor())
    try:
        yield
    finally:
        reset_active_redactor(token)
