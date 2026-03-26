"""
Default evaluator creation utilities.

This module creates the default evaluators for every new project using the
workflow catalog as the single source of truth.

Three defaults are created for every project:

  - Exact Match    (auto_exact_match  — builtin auto evaluator, from template)
  - Contains JSON  (auto_contains_json — builtin auto evaluator, from template)
  - Quality Rating (trace/quality-rating — human evaluator, from preset)
"""

from typing import Any, Optional
from uuid import UUID

from oss.src.core.evaluators.dtos import (
    SimpleEvaluatorCreate,
    SimpleEvaluatorData,
    SimpleEvaluatorFlags,
)
from oss.src.core.evaluators.service import EvaluatorsService, SimpleEvaluatorsService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowRevisionDBE,
    WorkflowVariantDBE,
)
from oss.src.resources.workflows.catalog import (
    get_workflow_catalog_preset,
    get_workflow_catalog_template,
)
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


# ---------------------------------------------------------------------------
# Default evaluator definitions
# ---------------------------------------------------------------------------
#
# Each entry is one of two shapes:
#
#  Template-driven (auto evaluators):
#    template_key  – key in the workflow catalog
#    slug          – fixed slug for the created evaluator
#    name          – display name override (falls back to catalog name)
#
#  Preset-driven (human evaluator):
#    template_key  – parent template key in the workflow catalog
#    preset_key    – preset key within that template
#    slug          – fixed slug for the created evaluator
#    name          – display name override (falls back to preset name)
#    (is_human is inferred from the URI at workflow creation time)
#
# Using a fixed slug for every default makes the evaluators predictable and
# idempotent across projects.

_DEFAULT_EVALUATORS: list[dict[str, Any]] = [
    # -- auto evaluators (URIs and parameter defaults come from the catalog) --
    {
        "template_key": "auto_exact_match",
        "slug": "exact-match",
        "name": "Exact Match",
    },
    {
        "template_key": "auto_contains_json",
        "slug": "contains-json",
        "name": "Contains JSON",
    },
    # -- human evaluator (preset from agenta:custom:trace:v0 catalog) --------
    {
        "template_key": "trace",
        "preset_key": "quality-rating",
        "slug": "quality-rating",
        "name": "Quality Rating",
    },
]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _get_simple_evaluators_service() -> SimpleEvaluatorsService:
    workflows_dao = GitDAO(
        ArtifactDBE=WorkflowArtifactDBE,
        VariantDBE=WorkflowVariantDBE,
        RevisionDBE=WorkflowRevisionDBE,
    )
    workflows_service = WorkflowsService(workflows_dao=workflows_dao)
    evaluators_service = EvaluatorsService(workflows_service=workflows_service)
    return SimpleEvaluatorsService(evaluators_service=evaluators_service)


def _build_from_template(default: dict) -> Optional[SimpleEvaluatorCreate]:
    """Build a SimpleEvaluatorCreate from the catalog template for an auto evaluator."""
    template_key: str = default["template_key"]

    template = get_workflow_catalog_template(
        template_key=template_key,
        is_evaluator=True,
    )
    if not template:
        log.warning(
            "Catalog template not found for default evaluator",
            template_key=template_key,
        )
        return None

    # Extract default parameter values from the settings-template schema.
    # The catalog stores settings_template under schemas.parameters; each
    # field may carry a "default" key that becomes the runtime parameter value.
    # This mirrors the pattern used in the .http test files:
    #   "data": { "uri": "agenta:builtin:auto_exact_match:v0",
    #             "parameters": { "correct_answer_key": "correct_answer" } }
    parameters: Optional[dict] = None
    if template.data and template.data.schemas and template.data.schemas.parameters:
        extracted = {
            key: val["default"]
            for key, val in template.data.schemas.parameters.items()
            if isinstance(val, dict) and "default" in val
        }
        parameters = extracted or None

    return SimpleEvaluatorCreate(
        slug=default["slug"],
        name=default.get("name") or template.name or template_key,
        description=template.description,
        flags=SimpleEvaluatorFlags(),
        data=SimpleEvaluatorData(
            uri=template.data.uri if template.data else None,
            parameters=parameters,
        ),
    )


def _build_from_preset(default: dict) -> Optional[SimpleEvaluatorCreate]:
    """Build a SimpleEvaluatorCreate from a workflow catalog preset."""
    template_key: str = default["template_key"]
    preset_key: str = default["preset_key"]

    preset = get_workflow_catalog_preset(
        template_key=template_key,
        preset_key=preset_key,
        is_evaluator=True,
    )
    if not preset:
        log.warning(
            "Catalog preset not found for default evaluator",
            template_key=template_key,
            preset_key=preset_key,
        )
        return None

    return SimpleEvaluatorCreate(
        slug=default["slug"],
        name=default.get("name") or preset.name or preset_key,
        description=preset.description,
        flags=SimpleEvaluatorFlags(),
        data=SimpleEvaluatorData(**preset.data.model_dump(exclude_none=True))
        if preset.data
        else SimpleEvaluatorData(),
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def create_default_evaluators(
    project_id: UUID,
    user_id: UUID,
) -> None:
    """Create the default evaluators for a new project.

    Creates 2 auto evaluators (Exact Match, Contains JSON) from catalog
    template defaults and 1 human evaluator (Quality Rating) from the
    quality-rating preset on the agenta:custom:trace:v0 catalog entry.
    """
    simple_evaluators_service = _get_simple_evaluators_service()

    for default in _DEFAULT_EVALUATORS:
        template_key: Optional[str] = default.get("template_key")
        preset_key: Optional[str] = default.get("preset_key")

        try:
            if preset_key:
                create = _build_from_preset(default)
            elif template_key:
                create = _build_from_template(default)
            else:
                continue
            if not create:
                continue

            result = await simple_evaluators_service.create(
                project_id=project_id,
                user_id=user_id,
                simple_evaluator_create=create,
            )

            if result:
                log.info(
                    "Default evaluator created",
                    project_id=str(project_id),
                    evaluator_slug=result.slug,
                )

        except Exception as e:
            log.warning(
                "Failed to create default evaluator",
                project_id=str(project_id),
                slug=default.get("slug"),
                error=str(e),
            )
