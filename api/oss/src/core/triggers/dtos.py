from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Trigger Enums
# ---------------------------------------------------------------------------


class TriggerProviderKind(str, Enum):
    COMPOSIO = "composio"


# ---------------------------------------------------------------------------
# Trigger Catalog
#
# The catalog leaf is an **event** (Composio "trigger type"), the analogue of a
# tools **action**. An event carries a ``trigger_config`` JSON Schema, the
# analogue of an action's ``input_parameters``.
# ---------------------------------------------------------------------------


class TriggerCatalogEvent(BaseModel):
    key: str
    #
    name: str
    description: Optional[str] = None
    #
    provider: Optional[str] = None
    integration: Optional[str] = None
    #
    categories: List[str] = []
    logo: Optional[str] = None


class TriggerCatalogEventDetails(TriggerCatalogEvent):
    # FROZEN (WS-PRE): the Event DTO carries the event's trigger_config JSON Schema
    # — the inbound analogue of an action's input_parameters.
    trigger_config: Optional[Dict[str, Any]] = None
    payload: Optional[Dict[str, Any]] = None


class TriggerCatalogProvider(BaseModel):
    key: TriggerProviderKind
    #
    name: str
    description: Optional[str] = None
