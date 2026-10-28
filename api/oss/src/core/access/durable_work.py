"""The edit rule for durable work (M7, CONTRACT sections 5 and 6).

Durable work is a trigger schedule, a trigger subscription or an evaluation run. Each
stores the principal it executes as (M2). Only that principal may change what the work
executes. Others with the edit capability may still pause, stop, archive or delete it,
and those actions never change the executing principal. A copy or a rerun is new work
that executes as the principal that starts it.

The rule exists because of personal credentials: without it, Bob could point Alice's
schedule at another agent and make it act with Alice's own accounts.
"""

import json
from enum import Enum
from typing import Any, Optional

from oss.src.core.access.dtos import PrincipalRef


class DurableWorkKind(str, Enum):
    SCHEDULE = "schedule"
    SUBSCRIPTION = "subscription"
    EVALUATION_RUN = "evaluation_run"


class DurableWorkChange(str, Enum):
    # Changes what the work executes: its target, its input, its configuration.
    EXECUTION = "execution"
    # Pause, stop, archive, delete, rename: the work keeps executing the same thing.
    LIFECYCLE = "lifecycle"


class DurableWorkOwnerOnly(Exception):
    """Someone other than the executing principal tried to change what the work
    executes. `executing` is the stored principal (None when the row has none)."""

    def __init__(
        self,
        *,
        kind: DurableWorkKind,
        executing: Optional[PrincipalRef],
    ) -> None:
        self.kind = kind
        self.executing = executing
        super().__init__(f"only the executing principal may change this {kind.value}")


def check_durable_work_change(
    *,
    kind: DurableWorkKind,
    principal: PrincipalRef,
    executing: Optional[PrincipalRef],
    change: DurableWorkChange,
) -> None:
    """Raise `DurableWorkOwnerOnly` when `principal` may not make `change`.

    The comparison is exact (kind and id), so API-key work changes only with the same
    key, and a human's work only with that human's own requests. A row with no stored
    principal has no one who may change what it executes; a copy is the way forward."""

    if change == DurableWorkChange.LIFECYCLE:
        return
    if executing is not None and executing == principal:
        return
    raise DurableWorkOwnerOnly(kind=kind, executing=executing)


def execution_changed(before: Any, after: Any) -> bool:
    """Compare the execution fields of two shapes by their canonical JSON. Nulls and
    JSON types are kept, so adding a null input or turning `true` into `1` is a change;
    a tuple and a list, or a model and its dict, compare equal."""

    return _canonical(before) != _canonical(after)


def _canonical(value: Any) -> str:
    return json.dumps(_jsonable(value), sort_keys=True, separators=(",", ":"))


def _jsonable(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)
