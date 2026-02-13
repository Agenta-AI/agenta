"""
Default evaluator creation utilities.

This module provides functions to create default evaluators for new projects,
specifically for onboarding purposes.
"""

from typing import Optional
from uuid import UUID

from oss.src.core.evaluators.dtos import (
    SimpleEvaluatorCreate,
    SimpleEvaluatorFlags,
    SimpleEvaluatorData,
    SimpleEvaluator,
    SimpleEvaluatorQuery,
    SimpleEvaluatorQueryFlags,
)
from oss.src.core.evaluators.service import (
    EvaluatorsService,
    SimpleEvaluatorsService,
)
from oss.src.core.workflows.service import WorkflowsService
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowVariantDBE,
    WorkflowRevisionDBE,
)
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


# Default evaluator configuration
DEFAULT_HUMAN_EVALUATOR_SLUG = "quality-rating"
DEFAULT_HUMAN_EVALUATOR_NAME = "Quality Rating"
DEFAULT_HUMAN_EVALUATOR_DESCRIPTION = (
    "Rate the quality of responses with a simple thumbs up or down."
)


def _get_default_human_evaluator_schema() -> dict:
    """
    Returns the JSON schema for the default human evaluator with binary feedback.
    """
    return {
        "type": "object",
        "$schema": "http://json-schema.org/schema#",
        "required": ["outputs"],
        "properties": {
            "outputs": {
                "type": "object",
                "properties": {"approved": {"type": "boolean"}},
                "required": ["approved"],
            }
        },
    }


def _get_simple_evaluators_service() -> SimpleEvaluatorsService:
    """
    Initialize and return the SimpleEvaluatorsService with all required dependencies.
    """
    workflows_dao = GitDAO(
        ArtifactDBE=WorkflowArtifactDBE,
        VariantDBE=WorkflowVariantDBE,
        RevisionDBE=WorkflowRevisionDBE,
    )

    workflows_service = WorkflowsService(
        workflows_dao=workflows_dao,
    )

    evaluators_service = EvaluatorsService(
        workflows_service=workflows_service,
    )

    return SimpleEvaluatorsService(
        evaluators_service=evaluators_service,
    )


async def create_default_human_evaluator(
    project_id: UUID,
    user_id: UUID,
) -> Optional[SimpleEvaluator]:
    """
    Create the default 'Quality Rating' human evaluator for a project.

    This evaluator provides a simple binary (thumbs up/down) feedback mechanism
    for human annotation, making it easy for new users to start annotating
    traces without first having to create an evaluator.

    Args:
        project_id: The ID of the project to create the evaluator in.
        user_id: The ID of the user creating the evaluator.

    Returns:
        The created SimpleEvaluator if successful, None if already exists or on error.
    """
    # Initialize services
    simple_evaluators_service = _get_simple_evaluators_service()

    # Check if evaluator with this slug already exists
    try:
        existing_evaluators = await simple_evaluators_service.query(
            project_id=project_id,
            simple_evaluator_query=SimpleEvaluatorQuery(
                flags=SimpleEvaluatorQueryFlags(
                    is_human=True,
                )
            ),
        )

        # Check if any evaluator has the default slug
        for evaluator in existing_evaluators:
            if evaluator.slug == DEFAULT_HUMAN_EVALUATOR_SLUG:
                log.debug(
                    "Default human evaluator already exists",
                    project_id=str(project_id),
                    evaluator_id=str(evaluator.id),
                )
                return None

    except Exception as e:
        log.warning(
            "Failed to check for existing evaluators",
            project_id=str(project_id),
            error=str(e),
        )
        # Continue with creation attempt - worst case we get a duplicate slug error

    # Create the evaluator
    try:
        simple_evaluator_create = SimpleEvaluatorCreate(
            slug=DEFAULT_HUMAN_EVALUATOR_SLUG,
            name=DEFAULT_HUMAN_EVALUATOR_NAME,
            description=DEFAULT_HUMAN_EVALUATOR_DESCRIPTION,
            flags=SimpleEvaluatorFlags(
                is_custom=False,
                is_human=True,
            ),
            data=SimpleEvaluatorData(
                service={
                    "agenta": "v0.1.0",
                    "format": _get_default_human_evaluator_schema(),
                },
            ),
        )

        simple_evaluator = await simple_evaluators_service.create(
            project_id=project_id,
            user_id=user_id,
            simple_evaluator_create=simple_evaluator_create,
        )

        if simple_evaluator:
            log.info(
                "Default human evaluator created",
                project_id=str(project_id),
                evaluator_id=str(simple_evaluator.id),
                evaluator_slug=simple_evaluator.slug,
            )

        return simple_evaluator

    except Exception as e:
        log.warning(
            "Failed to create default human evaluator",
            project_id=str(project_id),
            error=str(e),
        )
        return None
