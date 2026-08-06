from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.core.evaluators import defaults as defaults_module
from oss.src.core.workflows.dtos import JsonSchemas, WorkflowRevisionData
from oss.src.core.shared.exceptions import EntityCreationConflict


@pytest.mark.asyncio
async def test_create_default_evaluators_ignores_duplicate_conflicts(monkeypatch):
    class DummySimpleEvaluatorsService:
        async def create(self, **kwargs):
            raise EntityCreationConflict(
                entity="Evaluator",
                conflict={"slug": kwargs["simple_evaluator_create"].slug},
            )

    monkeypatch.setattr(
        defaults_module,
        "_get_simple_evaluators_service",
        lambda: DummySimpleEvaluatorsService(),
    )
    monkeypatch.setattr(
        defaults_module,
        "_DEFAULT_EVALUATORS",
        [{"template_key": "auto_exact_match", "slug": "exact-match"}],
    )
    monkeypatch.setattr(
        defaults_module,
        "_build_from_template",
        lambda default: SimpleNamespace(slug=default["slug"]),
    )

    await defaults_module.create_default_evaluators(
        project_id=uuid4(),
        user_id=uuid4(),
    )


def test_build_from_template_persists_schema_parameter_defaults(monkeypatch):
    template = SimpleNamespace(
        name="Exact Match",
        description="Exact match",
        data=WorkflowRevisionData(
            uri="agenta:builtin:auto_exact_match:v0",
            schemas=JsonSchemas(
                parameters={
                    "type": "object",
                    "properties": {
                        "correct_answer_key": {
                            "type": "string",
                            "default": "correct_answer",
                        }
                    },
                }
            ),
        ),
    )

    monkeypatch.setattr(
        defaults_module,
        "get_workflow_catalog_template",
        lambda **_: template,
    )

    evaluator = defaults_module._build_from_template(
        {"template_key": "auto_exact_match", "slug": "exact-match"}
    )

    assert evaluator.data.parameters == {"correct_answer_key": "correct_answer"}


@pytest.mark.asyncio
async def test_create_default_evaluators_reraises_unexpected_errors(monkeypatch):
    class DummySimpleEvaluatorsService:
        async def create(self, **kwargs):
            raise RuntimeError("boom")

    monkeypatch.setattr(
        defaults_module,
        "_get_simple_evaluators_service",
        lambda: DummySimpleEvaluatorsService(),
    )
    monkeypatch.setattr(
        defaults_module,
        "_DEFAULT_EVALUATORS",
        [{"template_key": "auto_exact_match", "slug": "exact-match"}],
    )
    monkeypatch.setattr(
        defaults_module,
        "_build_from_template",
        lambda default: SimpleNamespace(slug=default["slug"]),
    )

    with pytest.raises(RuntimeError, match="boom"):
        await defaults_module.create_default_evaluators(
            project_id=uuid4(),
            user_id=uuid4(),
        )
