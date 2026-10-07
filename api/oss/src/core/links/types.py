from typing import Optional

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


class LinkPreviewError(Exception):
    """Base for link preview failures."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class LinkPreviewRefused(LinkPreviewError):
    """The URL is not one the server will fetch: bad scheme, credentials, port, or a host
    that resolves to a non-public address."""


class LinkPreviewUnreachable(LinkPreviewError):
    """The URL is allowed but could not be read: no DNS answer, a timeout, a non-HTML body."""
