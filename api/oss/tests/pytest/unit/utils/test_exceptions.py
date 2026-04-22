from datetime import timezone

import pytest
from fastapi import HTTPException

from oss.src.apis.fastapi.workflows.models import WorkflowResponse
from oss.src.utils.exceptions import (
    build_support,
    intercept_exceptions,
    suppress_exceptions,
)


def test_support_helper_uses_utc_timestamp():
    support = build_support()

    assert support.support_id is not None
    assert support.support_ts is not None
    assert support.support_ts.tzinfo == timezone.utc


def test_support_fields_exist_on_api_response_model():
    assert "support_id" in WorkflowResponse.model_fields
    assert "support_ts" in WorkflowResponse.model_fields


@pytest.mark.asyncio
async def test_suppress_exceptions_attaches_support_to_response():
    @suppress_exceptions(default=WorkflowResponse(), verbose=False)
    async def raise_error():
        raise RuntimeError("boom")

    result = await raise_error()

    assert isinstance(result, WorkflowResponse)
    assert result.support_id is not None
    assert result.support_ts is not None
    assert result.support_ts.tzinfo == timezone.utc


@pytest.mark.asyncio
async def test_intercept_exceptions_includes_support_metadata():
    @intercept_exceptions(verbose=False)
    async def raise_error():
        raise RuntimeError("boom")

    with pytest.raises(HTTPException) as exc_info:
        await raise_error()

    detail = exc_info.value.detail
    assert detail["support_id"]
    assert detail["support_ts"].tzinfo == timezone.utc
