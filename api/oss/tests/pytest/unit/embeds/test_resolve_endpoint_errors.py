"""Embed resolution errors answer 4xx on every route that resolves embeds.

They used to fall through to `intercept_exceptions` and answer 500 with a traceback at
ERROR level, although each one is a bad configuration sent by the caller.
"""

from importlib import import_module
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from oss.src.apis.fastapi.embeds.exceptions import handle_embed_exceptions
from oss.src.core.embeds.exceptions import (
    CircularEmbedError,
    EmbedNotFoundError,
    MaxDepthExceededError,
    MaxEmbedsExceededError,
    MixedEntityTypesError,
    NonEmbeddableWorkflowReferenceError,
    PathExtractionError,
    UnsupportedReferenceTypeError,
)

EMBED_ERRORS = [
    (CircularEmbedError(["workflow_revision:a:1"]), 400),
    (MaxDepthExceededError(10), 400),
    (MaxEmbedsExceededError(100), 400),
    (UnsupportedReferenceTypeError("unknown_revision"), 400),
    (NonEmbeddableWorkflowReferenceError("__ag__llm"), 400),
    (MixedEntityTypesError(["workflow", "environment"]), 400),
    (PathExtractionError("parameters.prompt", {}), 400),
    (EmbedNotFoundError("workflow_revision:missing"), 404),
]


class TestHandleEmbedExceptions:
    @pytest.mark.parametrize(("error", "status_code"), EMBED_ERRORS)
    async def test_each_embed_error_maps_to_its_4xx(self, error, status_code):
        @handle_embed_exceptions()
        async def handler():
            raise error

        with pytest.raises(HTTPException) as caught:
            await handler()

        assert caught.value.status_code == status_code
        assert caught.value.detail == str(error)

    async def test_other_errors_pass_through(self):
        @handle_embed_exceptions()
        async def handler():
            raise RuntimeError("boom")

        with pytest.raises(RuntimeError):
            await handler()


class _RaisingService:
    """A service whose every coroutine raises `error`, whatever the route calls."""

    def __init__(self, error):
        self.error = error

    def __getattr__(self, name):
        return AsyncMock(side_effect=self.error)


ROUTES = [
    (
        "workflows",
        "WorkflowsRouter",
        "resolve_workflow_revision_endpoint",
        "workflow_revision_resolve_request",
    ),
    (
        "applications",
        "ApplicationsRouter",
        "resolve_application_revision",
        "application_revision_resolve_request",
    ),
    (
        "applications",
        "ApplicationsRouter",
        "retrieve_application_revision",
        "application_revision_retrieve_request",
    ),
    (
        "evaluators",
        "EvaluatorsRouter",
        "resolve_evaluator_revision",
        "evaluator_revision_resolve_request",
    ),
    (
        "evaluators",
        "EvaluatorsRouter",
        "retrieve_evaluator_revision",
        "evaluator_revision_retrieve_request",
    ),
    (
        "environments",
        "EnvironmentsRouter",
        "resolve_environment_revision_endpoint",
        "environment_revision_resolve_request",
    ),
    (
        "environments",
        "EnvironmentsRouter",
        "retrieve_environment_revision",
        "environment_revision_retrieve_request",
    ),
]


def _router(module, class_name, error):
    cls = getattr(import_module(f"oss.src.apis.fastapi.{module}.router"), class_name)
    service = _RaisingService(error)
    if module == "environments":
        return cls(environments_service=service)
    return cls(**{f"{module}_service": service, "environments_service": AsyncMock()})


@pytest.mark.parametrize(("module", "class_name", "route", "body"), ROUTES)
@pytest.mark.parametrize(
    ("error", "status_code"),
    [
        (CircularEmbedError(["workflow_revision:a:1"]), 400),
        (EmbedNotFoundError("workflow_revision:missing"), 404),
    ],
)
async def test_resolving_routes_answer_4xx(
    module, class_name, route, body, error, status_code
):
    router = _router(module, class_name, error)
    request = SimpleNamespace(
        state=SimpleNamespace(project_id=str(uuid4()), user_id=str(uuid4()))
    )

    with (
        patch(
            f"oss.src.apis.fastapi.{module}.router.check_action_access",
            AsyncMock(return_value=True),
        ),
        pytest.raises(HTTPException) as caught,
    ):
        await getattr(router, route)(request, **{body: MagicMock()})

    assert caught.value.status_code == status_code
