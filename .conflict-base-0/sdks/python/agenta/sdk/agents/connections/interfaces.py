"""The connection-resolver port (a ``Protocol``), mirroring ``tools/interfaces.py``.

An adapter reads ONE connection for the requested model and returns one least-privilege
:class:`ResolvedConnection`. The offline SDK adapters live in ``resolver.py``; the
connected Agenta-platform adapter lives in ``platform/connections.py`` and reads
``GET /secrets/``.
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
