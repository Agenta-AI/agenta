from pydantic import BaseModel, Field


class ProviderCredential(BaseModel):
    """Secret plus non-secret endpoint configuration for one provider."""

    api_key: str = Field(repr=False)
    base_url: str | None = None


class ProviderState(BaseModel):
    """Redacted, browser-safe provider state. Never carries the raw key."""

    provider: str
    configured: bool
    key_suffix: str
