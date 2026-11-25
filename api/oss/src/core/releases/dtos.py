from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class ReleaseFeed(BaseModel):
    """The public release feed. Entries pass through as published (camelCase)."""

    releases: List[Dict[str, Any]] = []
    notices: List[Dict[str, Any]] = []


class InstanceReleases(ReleaseFeed):
    version: str
    # compose, helm, railway, kubernetes or docker (AGENTA_DEPLOYMENT_METHOD); None when unknown.
    deployment_method: Optional[str] = None
