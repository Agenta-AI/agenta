"""Typed execution-domain failures and orchestration rules (contracts.md)."""

import hashlib
import json

from ..exceptions import DomainError

DEFAULT_TURN_TIMEOUT_S = 120.0


class RunnerUnavailable(DomainError):
    """The runner stream failed before producing a typed source result."""

    code = "runner_unavailable"
    retryable = True


class TurnTimeout(DomainError):
    """The turn exceeded its wall-clock budget; the row is committed failed."""

    code = "turn_timeout"
    retryable = True


class CancelledTurn(DomainError):
    """The turn was cancelled by the user; the row is committed cancelled."""

    code = "turn_cancelled"


def input_hash(text: str) -> str:
    """Stable hash over the normalized user input for idempotency checks."""
    return hashlib.sha256(
        json.dumps({"text": text}, sort_keys=True).encode("utf-8")
    ).hexdigest()
