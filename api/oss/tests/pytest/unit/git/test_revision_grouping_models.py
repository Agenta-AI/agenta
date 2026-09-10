from uuid import uuid4

import pytest
from pydantic import ValidationError

from oss.src.apis.fastapi.applications.models import ApplicationRevisionQueryRequest
from oss.src.apis.fastapi.environments.models import EnvironmentRevisionQueryRequest
from oss.src.apis.fastapi.evaluators.models import EvaluatorRevisionQueryRequest
from oss.src.apis.fastapi.queries.models import QueryRevisionQueryRequest
from oss.src.apis.fastapi.testsets import models as testset_models
from oss.src.apis.fastapi.workflows.models import WorkflowRevisionQueryRequest


REQUEST_MODELS = [
    (ApplicationRevisionQueryRequest, "application"),
    (EnvironmentRevisionQueryRequest, "environment"),
    (EvaluatorRevisionQueryRequest, "evaluator"),
    (QueryRevisionQueryRequest, "query"),
    (testset_models.TestsetRevisionQueryRequest, "testset"),
    (WorkflowRevisionQueryRequest, "workflow"),
]


@pytest.mark.parametrize(("request_model", "prefix"), REQUEST_MODELS)
def test_explicit_latest_per_artifact_is_supported(request_model, prefix):
    request = request_model.model_validate(
        {
            f"{prefix}_refs": [{"id": str(uuid4())}],
            "grouping": {"by": "artifact", "get": "latest"},
        }
    )

    assert request.grouping.by == "artifact"
    assert request.grouping.get == "latest"


@pytest.mark.parametrize(("request_model", "prefix"), REQUEST_MODELS)
def test_grouping_requires_a_selection_rule(request_model, prefix):
    with pytest.raises(ValidationError):
        request_model.model_validate(
            {
                f"{prefix}_refs": [{"id": str(uuid4())}],
                "grouping": {"by": "artifact"},
            }
        )


@pytest.mark.parametrize(("request_model", "prefix"), REQUEST_MODELS)
def test_grouping_rejects_windowing(request_model, prefix):
    with pytest.raises(ValidationError, match="grouping cannot be combined with windowing"):
        request_model.model_validate(
            {
                f"{prefix}_refs": [{"id": str(uuid4())}],
                "grouping": {"by": "artifact", "get": "latest"},
                "windowing": {"limit": 1},
            }
        )


@pytest.mark.parametrize(("request_model", "prefix"), REQUEST_MODELS)
def test_grouping_rejects_explicit_revision_references(request_model, prefix):
    with pytest.raises(
        ValidationError,
        match="grouping cannot be combined with revision references",
    ):
        request_model.model_validate(
            {
                f"{prefix}_refs": [{"id": str(uuid4())}],
                f"{prefix}_revision_refs": [{"id": str(uuid4())}],
                "grouping": {"by": "artifact", "get": "latest"},
            }
        )
