from typing import List, Optional

from pydantic import BaseModel

from oss.src.core.triggers.dtos import (
    TriggerCatalogEvent,
    TriggerCatalogEventDetails,
    TriggerCatalogProvider,
)


# ---------------------------------------------------------------------------
# Trigger Catalog
# ---------------------------------------------------------------------------


class TriggerCatalogProviderResponse(BaseModel):
    count: int = 0
    provider: Optional[TriggerCatalogProvider] = None


class TriggerCatalogProvidersResponse(BaseModel):
    count: int = 0
    providers: List[TriggerCatalogProvider] = []


class TriggerCatalogEventResponse(BaseModel):
    count: int = 0
    event: Optional[TriggerCatalogEventDetails] = None


class TriggerCatalogEventsResponse(BaseModel):
    count: int = 0
    total: int = 0
    cursor: Optional[str] = None
    events: List[TriggerCatalogEvent] = []
