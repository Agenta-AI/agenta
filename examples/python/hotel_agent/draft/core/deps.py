"""AgentDeps — the single object every runtime adapter receives per request.

Three things are injectable: PMS, Retriever, Clock. ``current_user_id`` scopes
the request to one authenticated guest.

The PMS, retriever, and clock can be shared across requests; the user cannot.
"""

from __future__ import annotations

from dataclasses import dataclass

from core.clock import Clock
from core.integrations.pms.protocol import PMSClient
from core.retrieval.protocol import Retriever


@dataclass(frozen=True)
class AgentDeps:
    pms: PMSClient
    retriever: Retriever
    clock: Clock
    current_user_id: str
