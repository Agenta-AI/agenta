"""Default-skill seeding (``create_default_skills``).

The seeder creates one URI-less, non-runnable skill workflow per default entry
(``is_skill=True, is_evaluator=False``) at a fixed canonical slug, with the SkillConfig package at
``data.parameters.skill``. It is idempotent (a re-seed swallows the creation conflict) and
best-effort (any other failure is logged and swallowed so seeding never fails project creation).
The lock mechanism was removed, so seeded skills are created UNLOCKED.
"""

from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.core.workflows import defaults as defaults_module
from oss.src.core.shared.exceptions import EntityCreationConflict


def test_build_create_makes_unlocked_skill_workflow():
    default = defaults_module._DEFAULT_SKILLS[0]

    create = defaults_module._build_create(default)

    assert create.slug == default["slug"]
    assert create.flags is not None
    assert create.flags.is_skill is True
    assert create.flags.is_evaluator is False
    # The lock mechanism was removed; no is_locked flag exists on the model.
    assert not hasattr(create.flags, "is_locked")

    skill = create.data.parameters["skill"]
    assert skill["name"] == default["name"]
    assert skill["description"] == default["description"]
    assert skill["body"] == default["body"]


@pytest.mark.asyncio
async def test_create_default_skills_creates_unlocked_skill_with_slug(monkeypatch):
    created = {}

    class DummySimpleWorkflowsService:
        async def create(self, *, project_id, user_id, simple_workflow_create):
            created["create"] = simple_workflow_create
            return SimpleNamespace(id=uuid4(), slug=simple_workflow_create.slug)

    monkeypatch.setattr(
        defaults_module,
        "_get_simple_workflows_service",
        lambda: DummySimpleWorkflowsService(),
    )

    await defaults_module.create_default_skills(
        project_id=uuid4(),
        user_id=uuid4(),
    )

    create = created["create"]
    assert create.slug == "agenta-getting-started"
    assert create.flags.is_skill is True
    assert create.flags.is_evaluator is False
    assert "skill" in create.data.parameters


@pytest.mark.asyncio
async def test_create_default_skills_is_idempotent_on_conflict(monkeypatch):
    class DummySimpleWorkflowsService:
        async def create(self, *, project_id, user_id, simple_workflow_create):
            raise EntityCreationConflict(
                entity="Workflow",
                conflict={"slug": simple_workflow_create.slug},
            )

    monkeypatch.setattr(
        defaults_module,
        "_get_simple_workflows_service",
        lambda: DummySimpleWorkflowsService(),
    )

    # A re-seed hitting the fixed slug must be a no-op, not an error.
    await defaults_module.create_default_skills(
        project_id=uuid4(),
        user_id=uuid4(),
    )


@pytest.mark.asyncio
async def test_create_default_skills_swallows_unexpected_errors(monkeypatch):
    class DummySimpleWorkflowsService:
        async def create(self, *, project_id, user_id, simple_workflow_create):
            raise RuntimeError("boom")

    monkeypatch.setattr(
        defaults_module,
        "_get_simple_workflows_service",
        lambda: DummySimpleWorkflowsService(),
    )

    # Best-effort: a seeding failure must not propagate (it would otherwise fail project creation).
    await defaults_module.create_default_skills(
        project_id=uuid4(),
        user_id=uuid4(),
    )
