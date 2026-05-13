from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.core.evaluators import defaults as defaults_module
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
