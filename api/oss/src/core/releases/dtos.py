from typing import Any, Dict, List

from pydantic import BaseModel


class ReleaseFeed(BaseModel):
    """The public release feed. Entries pass through as published (camelCase)."""

    releases: List[Dict[str, Any]] = []
    notices: List[Dict[str, Any]] = []


class InstanceReleases(ReleaseFeed):
    version: str
