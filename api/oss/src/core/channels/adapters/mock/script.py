"""Scripted inbound events and the posted-message recorder — the two pieces
of `mock` state that a test drives directly.

Both are plain, inspectable containers (a list, a dict of ordered lists), not
a mock-framework object, so a test asserts on them without learning an API.
"""

from typing import Any, Dict, List, Optional
from uuid import UUID

from oss.src.core.channels.dtos import ChannelInboundEvent


class ScriptedEvents:
    """A queue of `ChannelInboundEvent`, replayed on demand. Exhaustion
    returns None — the adapter's answer for "the platform sent something we
    ignore" as much as for "nothing left to send"."""

    def __init__(self, events: Optional[List[ChannelInboundEvent]] = None) -> None:
        self._queue: List[ChannelInboundEvent] = list(events or [])

    def pop(self) -> Optional[ChannelInboundEvent]:
        if not self._queue:
            return None
        return self._queue.pop(0)

    def push(self, event: ChannelInboundEvent) -> None:
        self._queue.append(event)

    def __len__(self) -> int:
        return len(self._queue)


class PostRecorder:
    """Every post/edit, in order, keyed by the synthetic locator `mock` hands
    out. The assertion surface: what content, in what order, with what
    idempotency key — and the redelivery guard, since a real adapter dedupes
    on `idempotency_key` and nothing else."""

    def __init__(self) -> None:
        self.posts: List[Dict[str, Any]] = []
        self._by_locator_key: Dict[str, Dict[str, Any]] = {}
        self._by_idempotency_key: Dict[UUID, Dict[str, Any]] = {}

    def record_post(
        self,
        *,
        locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
        receipt: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Append a new row unless `idempotency_key` was already accepted, in
        which case the original row's receipt is returned unchanged — the
        redelivery guard."""

        existing = self._by_idempotency_key.get(idempotency_key)
        if existing is not None:
            return existing["receipt"]

        row = {
            "kind": "post",
            "locator": locator,
            "content": content,
            "idempotency_key": idempotency_key,
            "receipt": receipt,
        }
        self.posts.append(row)
        self._by_locator_key[_locator_key(receipt)] = row
        self._by_idempotency_key[idempotency_key] = row
        return receipt

    def record_edit(
        self,
        *,
        external_locator: Dict[str, Any],
        content: List[Dict[str, Any]],
        idempotency_key: UUID,
    ) -> Dict[str, Any]:
        """Edit the row the caller says it targets. Raises KeyError for an
        unknown locator, same as a real adapter would surface a not-found."""

        existing = self._by_idempotency_key.get(idempotency_key)
        if existing is not None:
            return existing["receipt"]

        row = self._by_locator_key[_locator_key(external_locator)]
        row["content"] = content
        row["idempotency_key"] = idempotency_key
        self._by_idempotency_key[idempotency_key] = row
        return row["receipt"]

    def inspect_posted(self, locator: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Test seam mirroring the contract suite's fake: what content is
        actually stored under a receipt right now."""

        return self._by_locator_key[_locator_key(locator)]["content"]


def _locator_key(locator: Dict[str, Any]) -> str:
    return "|".join(f"{k}={v}" for k, v in sorted(locator.items()))
