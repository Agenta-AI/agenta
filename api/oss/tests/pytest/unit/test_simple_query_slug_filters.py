from oss.src.apis.fastapi.applications.models import SimpleApplicationQueryRequest
from oss.src.apis.fastapi.environments.models import SimpleEnvironmentQueryRequest
from oss.src.apis.fastapi.evaluators.models import SimpleEvaluatorQueryRequest
from oss.src.apis.fastapi.workflows.models import SimpleWorkflowQueryRequest


def test_simple_query_requests_preserve_slug_filters():
    cases = [
        (SimpleApplicationQueryRequest, "application"),
        (SimpleEnvironmentQueryRequest, "environment"),
        (SimpleEvaluatorQueryRequest, "evaluator"),
        (SimpleWorkflowQueryRequest, "workflow"),
    ]

    for request_cls, field in cases:
        request = request_cls.model_validate(
            {field: {"slug": "target", "slugs": ["target", "other"]}}
        )
        query = getattr(request, field)

        assert query.model_dump(
            mode="json",
            exclude_none=True,
            exclude_unset=True,
        ) == {
            "slug": "target",
            "slugs": ["target", "other"],
        }
