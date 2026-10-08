from typing import Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field

from oss.src.core.links.types import LinkPreview


class LinkPreviewRequest(BaseModel):
    url: str = Field(..., max_length=2048, description="The http(s) link to preview.")


class LinkPreviewResponse(BaseModel):
    count: int = Field(default=0, description="`1` when a preview is returned.")
    preview: Optional[LinkPreview] = Field(
        default=None,
        description="Title, description, image and site of the page. A page that cannot be read still carries its URL and domain.",
    )


class LinkPreviewRefusedException(HTTPException):
    def __init__(self, message: str, *, reason: str):
        super().__init__(
            status_code=400,
            detail={
                "code": "link_preview_refused",
                "message": message,
                "retryable": False,
                "next_step": "Use a public http or https link on port 80 or 443.",
                "details": {"reason": reason},
            },
        )
