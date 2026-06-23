"""The connection-resolver port (a ``Protocol``), mirroring ``tools/interfaces.py``.

An adapter reads ONE connection for the requested model and returns one least-privilege
:class:`ResolvedConnection`. Slice 1 ships the offline adapters in ``resolver.py``; the
service-backed ``VaultConnectionResolver`` lands in a later slice.
"""

from __future__ import annotations

from typing import Protocol

from .models import ModelRef, ResolvedConnection, RuntimeAuthContext


class ConnectionResolver(Protocol):
    async def resolve(
        self,
        *,
        model: ModelRef,
        context: RuntimeAuthContext,
    ) -> ResolvedConnection:
        """Resolve one model + its connection into a least-privilege resolved connection."""
