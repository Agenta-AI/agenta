"""A saved query must hold a filter the tracing query can apply.

Live evaluations run their saved query every minute. A condition the tracing query
cannot apply used to be dropped, so the live evaluation scored every trace.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from oss.src.apis.fastapi.tracing.utils import handle_filtering_exceptions
from oss.src.core.queries.dtos import QueryRevisionData, SimpleQueryCreate
from oss.src.core.queries.service import QueriesService, SimpleQueriesService
from oss.src.core.tracing.dtos import FilteringException


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
