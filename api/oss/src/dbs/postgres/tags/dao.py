"""Data Access Object (DAO) for tags table.

Provides database operations for the tags registry.
"""

from typing import List, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from oss.src.utils.logging import get_module_logger

logger = get_module_logger(__name__)


class TagsDAO:
    """Data Access Object for tags table operations."""

    @staticmethod
    def list_tag_keys(
        session: Session,
        project_id: UUID,
        kind: Optional[str] = None,
    ) -> List[str]:
        """
        List all tag keys for a project, optionally filtered by kind.

        Args:
            session: Database session
            project_id: Project UUID to filter by
            kind: Optional entity kind to filter by (e.g., 'workflow', 'testset')

        Returns:
            List of tag keys, sorted alphabetically

        Raises:
            Exception: If database query fails
        """
        try:
            if kind:
                # Filter by both project_id and kind
                query = text("""
                    SELECT DISTINCT key FROM tags
                    WHERE project_id = :project_id AND kind = :kind
                    ORDER BY key
                """)
                result = session.execute(
                    query,
                    {"project_id": project_id, "kind": kind}
                )
            else:
                # Get all keys for the project (all kinds)
                query = text("""
                    SELECT DISTINCT key FROM tags
                    WHERE project_id = :project_id
                    ORDER BY key
                """)
                result = session.execute(
                    query,
                    {"project_id": project_id}
                )

            rows = result.fetchall()
            keys = [row[0] for row in rows]
            return keys

        except Exception as e:
            logger.error(
                f"Failed to list tag keys for project {project_id}, kind {kind}: {str(e)}"
            )
            raise

    @staticmethod
    def list_tag_kinds(
        session: Session,
        project_id: UUID,
    ) -> List[str]:
        """
        List all entity kinds that have tags in a project.

        Args:
            session: Database session
            project_id: Project UUID to filter by

        Returns:
            List of entity kinds, sorted alphabetically

        Raises:
            Exception: If database query fails
        """
        try:
            query = text("""
                SELECT DISTINCT kind FROM tags
                WHERE project_id = :project_id
                ORDER BY kind
            """)
            result = session.execute(query, {"project_id": project_id})
            rows = result.fetchall()
            kinds = [row[0] for row in rows]
            return kinds

        except Exception as e:
            logger.error(
                f"Failed to list tag kinds for project {project_id}: {str(e)}"
            )
            raise

    @staticmethod
    def count_tags(
        session: Session,
        project_id: UUID,
        kind: Optional[str] = None,
    ) -> int:
        """
        Count distinct tag keys for a project, optionally by kind.

        Args:
            session: Database session
            project_id: Project UUID to filter by
            kind: Optional entity kind to filter by

        Returns:
            Count of distinct tag keys

        Raises:
            Exception: If database query fails
        """
        try:
            if kind:
                query = text("""
                    SELECT COUNT(DISTINCT key) FROM tags
                    WHERE project_id = :project_id AND kind = :kind
                """)
                result = session.execute(
                    query,
                    {"project_id": project_id, "kind": kind}
                )
            else:
                query = text("""
                    SELECT COUNT(DISTINCT key) FROM tags
                    WHERE project_id = :project_id
                """)
                result = session.execute(query, {"project_id": project_id})

            count = result.scalar()
            return count or 0

        except Exception as e:
            logger.error(
                f"Failed to count tags for project {project_id}, kind {kind}: {str(e)}"
            )
            raise
