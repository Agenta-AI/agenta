from typing import Literal, Optional

from pydantic import BaseModel, Field


class LinkPreview(BaseModel):
    url: str = Field(
        ..., description="The page the preview describes, after redirects."
    )
    title: Optional[str] = Field(
        default=None, description="og:title, twitter:title or <title>."
    )
    description: Optional[str] = Field(
        default=None,
        description="og:description, twitter:description or the meta description.",
    )
    image: Optional[str] = Field(
        default=None,
        description="og:image or twitter:image, absolute, http(s) only.",
    )
    site_name: Optional[str] = Field(default=None, description="og:site_name.")
    domain: Optional[str] = Field(
        default=None, description="The page's host, without `www.`."
    )


LinkRefusalReason = Literal[
    "unsupported_scheme",
    "credentials",
    "missing_host",
    "invalid_port",
    "unsupported_port",
    "non_public_address",
]


class LinkPreviewError(Exception):
    """Base for link preview failures."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class LinkPreviewRefused(LinkPreviewError):
    """The server will not fetch this URL."""

    def __init__(self, message: str, *, reason: LinkRefusalReason):
        self.reason = reason
        super().__init__(message)


class LinkPreviewUnreachable(LinkPreviewError):
    """The URL is allowed but its page could not be read."""
