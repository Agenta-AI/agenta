"""Service layer for tags operations.

Provides business logic for tag management.
"""

from typing import List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from oss.src.dbs.postgres.tags.dao import TagsDAO
from oss.src.utils.logging import get_module_logger

logger = get_module_logger(__name__)


class TagsService:
    """Service for tags operations."""

    def __init__(self, dao: "TagsDAO" = None):
        """
        Initialize TagsService with a TagsDAO.

        Args:
            dao: TagsDAO instance (defaults to new instance if not provided)
        """
        self.dao = dao or TagsDAO()

    def list_tag_keys(
        self,
        session: Session,
        project_id: UUID,
        kind: Optional[str] = None,
    ) -> List[str]:
        """
        List all tag keys for a project, optionally filtered by kind.

        Args:
            session: Database session
            project_id: Project UUID
            kind: Optional entity kind filter

        Returns:
            List of tag keys sorted alphabetically
        """
        try:
            keys = self.dao.list_tag_keys(session, project_id, kind)
            logger.debug(
                f"Retrieved {len(keys)} tag keys for project {project_id}, kind {kind}"
            )
            return keys
        except Exception as e:
            logger.error(f"Error listing tag keys: {str(e)}")
            raise

    def list_tag_kinds(
        self,
        session: Session,
        project_id: UUID,
    ) -> List[str]:
        """
        List all entity kinds that have tags in a project.

        Args:
            session: Database session
            project_id: Project UUID

        Returns:
            List of entity kinds sorted alphabetically
        """
        try:
            kinds = self.dao.list_tag_kinds(session, project_id)
            logger.debug(f"Retrieved {len(kinds)} tag kinds for project {project_id}")
            return kinds
        except Exception as e:
            logger.error(f"Error listing tag kinds: {str(e)}")
            raise

    def get_tag_count(
        self,
        session: Session,
        project_id: UUID,
        kind: Optional[str] = None,
    ) -> int:
        """
        Get count of distinct tag keys for a project.

        Args:
            session: Database session
            project_id: Project UUID
            kind: Optional entity kind filter

        Returns:
            Count of distinct tag keys
        """
        try:
            count = self.dao.count_tags(session, project_id, kind)
            logger.debug(
                f"Retrieved tag count ({count}) for project {project_id}, kind {kind}"
            )
            return count
        except Exception as e:
            logger.error(f"Error counting tags: {str(e)}")
            raise
