from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Request, status, HTTPException, Depends
from sqlalchemy.orm import Session

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.core.tags.service import TagsService
from oss.src.dbs.postgres.shared.engine import get_session
from oss.src.apis.fastapi.tags.models import TagKeyResponse, TagKeysResponse

log = get_module_logger(__name__)


class TagsRouter:
    """Router for tags management."""

    def __init__(self, tags_service: TagsService):
        """
        Initialize TagsRouter.

        Args:
            tags_service: TagsService instance
        """
        self.service = tags_service
        self.router = APIRouter()

        self.router.add_api_route(
            "",
            self.list_tag_keys,
            methods=["GET"],
            operation_id="list_tag_keys",
            response_model=TagKeysResponse,
            status_code=status.HTTP_200_OK,
            summary="List tag keys for a project and kind",
            description="Get all tag keys registered for a specific entity kind within a project",
        )

    @intercept_exceptions()
    async def list_tag_keys(
        self,
        request: Request,
        project_id: UUID,
        kind: Optional[str] = None,
        session: Session = Depends(get_session),
    ) -> TagKeysResponse:
        """
        List all tag keys for a project, optionally filtered by entity kind.

        Args:
            request: FastAPI request object
            project_id: The project UUID
            kind: Optional entity kind filter (e.g., 'workflow', 'testset')
            session: Database session (injected via dependency)

        Returns:
            TagKeysResponse with list of tag keys, sorted alphabetically

        Raises:
            HTTPException: If database error occurs
        """
        try:
            keys_list = self.service.list_tag_keys(session, project_id, kind)
            keys = [TagKeyResponse(key=key) for key in keys_list]

            log.debug(
                f"Retrieved {len(keys)} tag keys for project {project_id}, kind {kind}"
            )

            return TagKeysResponse(keys=keys)

        except Exception as e:
            log.error(f"Error listing tag keys: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to retrieve tag keys: {str(e)}",
            )
