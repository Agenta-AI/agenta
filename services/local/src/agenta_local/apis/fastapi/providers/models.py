"""Provider credential route models. `credentials` is write-only by contract."""

from typing import Any

from pydantic import BaseModel


class ProviderUpsert(BaseModel):
    """Path carries the provider; the body never repeats it (contracts.md)."""

    credentials: dict[str, Any] = {}
    connection: dict[str, Any] = {}
