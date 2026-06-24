"""Default skill creation utilities.

This module seeds the platform default skills for every new project. A skill is a non-runnable
workflow artifact (``flags.is_skill`` true, no URI) whose ``data.parameters.skill`` holds a valid
:class:`SkillConfig` package. They are referenced from the agent config via ``@ag.embed`` with the
canonical selector ``parameters.skill``.

Modeled on ``api/oss/src/core/evaluators/defaults.py::create_default_evaluators``: it builds its
own service stack inline to avoid import cycles, is idempotent via fixed canonical slugs, and
catches the creation-conflict so a re-seed is a no-op.

Seeding is best-effort: a failure is logged and swallowed so it never fails project creation. A
project without the default skill is still fully usable.
"""

from typing import Any, Optional
from uuid import UUID

from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.core.workflows.dtos import (
    SimpleWorkflowCreate,
    SimpleWorkflowData,
    SimpleWorkflowFlags,
)
from oss.src.core.workflows.service import (
    SimpleWorkflowsService,
    WorkflowsService,
)
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowRevisionDBE,
    WorkflowVariantDBE,
)
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


# ---------------------------------------------------------------------------
# Default skill definitions
# ---------------------------------------------------------------------------
#
# Each entry is one inline SkillConfig package stored at data.parameters.skill.
# The fixed canonical slug makes the skill predictable and idempotent across
# projects, and is what the default agent config @ag.embed references.

_GETTING_STARTED_BODY = (
    "# Getting started with Agenta agents\n"
    "\n"
    "This skill orients an agent running on the Agenta platform.\n"
    "\n"
    "## When to use it\n"
    "\n"
    "Use it at the start of a task to recall how Agenta agents are expected to behave: be "
    "concise, ask for missing inputs, and prefer the tools and skills the agent was given over "
    "guessing.\n"
    "\n"
    "## Conventions\n"
    "\n"
    "- Greet the user once, then get to work.\n"
    "- State assumptions briefly when a request is ambiguous.\n"
    "- When a skill or tool references a relative path, resolve it against the skill directory "
    "(the parent of SKILL.md) before running it.\n"
    "- Keep answers short unless the user asks for depth.\n"
)

_DEFAULT_SKILLS: list[dict[str, Any]] = [
    {
        "slug": "agenta-getting-started",
        "name": "agenta-getting-started",
        "description": (
            "Getting started on the Agenta platform: how an Agenta agent should behave, ask for "
            "missing inputs, and use its tools and skills. Use at the start of a task."
        ),
        "body": _GETTING_STARTED_BODY,
    },
]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _get_simple_workflows_service() -> SimpleWorkflowsService:
    workflows_dao = GitDAO(
        ArtifactDBE=WorkflowArtifactDBE,
        VariantDBE=WorkflowVariantDBE,
        RevisionDBE=WorkflowRevisionDBE,
    )
    workflows_service = WorkflowsService(workflows_dao=workflows_dao)
    return SimpleWorkflowsService(workflows_service=workflows_service)


def _build_create(default: dict) -> SimpleWorkflowCreate:
    skill = {
        "name": default["name"],
        "description": default["description"],
        "body": default["body"],
    }
    if default.get("files"):
        skill["files"] = default["files"]

    return SimpleWorkflowCreate(
        slug=default["slug"],
        name=default.get("name"),
        description=default["description"],
        flags=SimpleWorkflowFlags(is_skill=True, is_evaluator=False),
        data=SimpleWorkflowData(parameters={"skill": skill}),
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def create_default_skills(
    project_id: UUID,
    user_id: UUID,
) -> None:
    """Create the platform default skills for a new project.

    Idempotent: a re-seed hits the fixed canonical slug and the creation-conflict is swallowed.
    Best-effort: any other failure is logged and swallowed so seeding never fails project
    creation.
    """
    simple_workflows_service = _get_simple_workflows_service()

    for default in _DEFAULT_SKILLS:
        create = _build_create(default)

        try:
            result = await simple_workflows_service.create(
                project_id=project_id,
                user_id=user_id,
                simple_workflow_create=create,
            )

            if not result or not result.id:
                continue

            log.info(
                "Default skill created",
                project_id=str(project_id),
                skill_slug=result.slug,
            )

        except EntityCreationConflict:
            log.info(
                "Default skill already exists",
                project_id=str(project_id),
                slug=default.get("slug"),
            )
        except Exception:
            log.error(
                "Failed to create default skill",
                project_id=str(project_id),
                slug=default.get("slug"),
                exc_info=True,
            )


def get_default_skill_slug() -> Optional[str]:
    """The canonical slug of the first default skill (the one the default agent config embeds)."""
    return _DEFAULT_SKILLS[0]["slug"] if _DEFAULT_SKILLS else None
