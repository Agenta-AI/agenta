"""A saved query must hold a filter the tracing query can apply.

Live evaluations run their saved query every minute. A condition the tracing query
cannot apply used to be dropped, so the live evaluation scored every trace. Only
saving a query answers 400; tracing queries and analytics keep ignoring an unknown
field.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from oss.src.apis.fastapi.queries.exceptions import handle_filtering_exceptions
from oss.src.core.queries.dtos import QueryRevisionData, SimpleQueryCreate
from oss.src.core.queries.service import QueriesService, SimpleQueriesService
from oss.src.apis.fastapi.queries.router import QueriesRouter, SimpleQueriesRouter
from oss.src.apis.fastapi.tracing.router import SpansRouter, TracingRouter
from oss.src.core.tracing.dtos import (
    Condition,
    Filtering,
    FilteringException,
    TracingQuery,
)
from oss.src.core.tracing.utils.filtering import parse_query
from oss.src.dbs.postgres.tracing.utils import filter as build_filter


def _data(*conditions: dict) -> dict:
    return {
        "filtering": {
            "operator": "and",
            "conditions": [
                {"field": "trace_type", "operator": "is", "value": "invocation"},
                *conditions,
            ],
        }
    }


def test_saved_query_keeps_picker_field_names():
    # The live evaluation drawers read the saved rows back into the picker.
    data = _data(
        {"field": "attributes.ag.session.id", "operator": "is", "value": "s-1"},
        {
            "field": "custom",
            "key": "attributes.ag.tags.env",
            "operator": "is",
            "value": "prod",
        },
        {"field": "has_annotation", "operator": "not_in", "value": []},
    )

    persisted = QueriesService._sanitize_persisted_query_revision_data(data)

    assert persisted == data


def test_saved_query_rejects_a_field_the_tracing_query_cannot_apply():
    with pytest.raises(
        FilteringException,
        match="Unsupported condition field 'no_such_field'",
    ):
        QueriesService._sanitize_persisted_query_revision_data(
            _data({"field": "no_such_field", "operator": "is", "value": "x"}),
        )


@pytest.mark.asyncio
async def test_simple_query_create_rejects_before_it_writes_anything():
    queries_service = QueriesService(queries_dao=AsyncMock())
    queries_service.create_query = AsyncMock()

    with pytest.raises(FilteringException):
        await SimpleQueriesService(queries_service=queries_service).create(
            project_id=uuid4(),
            user_id=uuid4(),
            simple_query_create=SimpleQueryCreate(
                slug="live-eval",
                data=QueryRevisionData.model_validate(
                    _data({"field": "is_annotation", "operator": "in", "value": []}),
                ),
            ),
        )

    queries_service.create_query.assert_not_awaited()


@pytest.mark.asyncio
async def test_query_write_routes_answer_400_for_a_filtering_exception():
    @handle_filtering_exceptions()
    async def route():
        raise FilteringException("Unsupported condition field 'no_such_field'.")

    with pytest.raises(HTTPException) as error:
        await route()

    assert error.value.status_code == 400
    assert error.value.detail == "Unsupported condition field 'no_such_field'."


_SAVE_ROUTES = [
    (QueriesRouter, "create_query_revision"),
    (QueriesRouter, "edit_query_revision"),
    (QueriesRouter, "commit_query_revision"),
    (SimpleQueriesRouter, "create_simple_query"),
    (SimpleQueriesRouter, "edit_simple_query"),
]

_READ_ROUTES = [
    (QueriesRouter, "retrieve_query_revision"),
    (TracingRouter, "fetch_analytics"),
    (TracingRouter, "fetch_legacy_analytics"),
    (SpansRouter, "query_analytics"),
]


def _wrapped_by_filtering_handler(route) -> bool:
    handler_code = handle_filtering_exceptions()(AsyncMock()).__code__
    while route is not None:
        if getattr(route, "__code__", None) is handler_code:
            return True
        route = getattr(route, "__wrapped__", None)
    return False


@pytest.mark.parametrize("router, name", _SAVE_ROUTES)
def test_saving_a_query_answers_400_for_an_unknown_field(router, name):
    assert _wrapped_by_filtering_handler(getattr(router, name))


@pytest.mark.parametrize("router, name", _READ_ROUTES)
def test_tracing_and_analytics_routes_do_not_answer_400_for_it(router, name):
    assert not _wrapped_by_filtering_handler(getattr(router, name))


def test_tracing_query_with_an_unknown_field_does_not_fail():
    query = TracingQuery(
        filtering=Filtering(
            conditions=[Condition(field="no_such_field", operator="is", value="x")]
        )
    )

    parse_query(query)

    assert build_filter(query.filtering.conditions) == []
