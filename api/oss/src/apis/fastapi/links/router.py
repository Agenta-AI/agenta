from fastapi import APIRouter, Request, status

from oss.src.apis.fastapi.links.models import (
    LinkPreviewRefusedException,
    LinkPreviewRequest,
    LinkPreviewResponse,
)
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.links.service import LinksService
from oss.src.core.links.types import LinkPreviewRefused
from oss.src.utils.exceptions import intercept_exceptions


class LinksRouter:
    def __init__(
        self,
        *,
        links_service: LinksService,
    ):
        self.links_service = links_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/preview",
            self.preview_link,
            methods=["POST"],
            operation_id="preview_link",
            status_code=status.HTTP_200_OK,
            response_model=LinkPreviewResponse,
            response_model_exclude_none=True,
        )

    @intercept_exceptions()
    async def preview_link(
        self,
        *,
        request: Request,
        #
        link_preview_request: LinkPreviewRequest,
    ) -> LinkPreviewResponse:
        """
        Preview a web link shown in a conversation.

        Fetches the page server-side and returns its title, description, image and site name.
        Only public http(s) addresses on ports 80 and 443 are fetched; any other link returns
        `400`. A page that cannot be read returns its URL and domain only.
        """
        if not await check_action_access(  # type: ignore
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_SESSIONS,  # type: ignore
        ):
            raise FORBIDDEN_EXCEPTION  # type: ignore

        try:
            preview = await self.links_service.preview(url=link_preview_request.url)
        except LinkPreviewRefused as e:
            raise LinkPreviewRefusedException(message=e.message) from e

        return LinkPreviewResponse(count=1, preview=preview)
