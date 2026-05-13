from datetime import timezone, datetime

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.workflows.models import WorkflowResponse
from oss.src.utils.context import support_ctx
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


@pytest.mark.asyncio
async def test_suppress_exceptions_attaches_support_to_context():
    @suppress_exceptions(default=WorkflowResponse(), verbose=False)
    async def raise_error():
        raise RuntimeError("boom")

    token = support_ctx.set(None)
    try:
        result = await raise_error()

        assert isinstance(result, WorkflowResponse)
        # Payload must be the bare default — no support fields on the model.
        assert "support_id" not in WorkflowResponse.model_fields
        assert "support_ts" not in WorkflowResponse.model_fields

        support = support_ctx.get()
        assert support is not None
        assert support.support_id is not None
        assert support.support_ts is not None
        assert support.support_ts.tzinfo == timezone.utc
    finally:
        support_ctx.reset(token)


@pytest.mark.asyncio
async def test_intercept_exceptions_includes_support_metadata():
    @intercept_exceptions(verbose=False)
    async def raise_error():
        raise RuntimeError("boom")

    token = support_ctx.set(None)
    try:
        with pytest.raises(HTTPException) as exc_info:
            await raise_error()

        detail = exc_info.value.detail
        assert detail["support_id"]
        assert isinstance(detail["support_ts"], str)
        assert datetime.fromisoformat(detail["support_ts"]).tzinfo == timezone.utc

        support = support_ctx.get()
        assert support is not None
        assert support.support_id == detail["support_id"]
    finally:
        support_ctx.reset(token)


class _SupportHeadersMiddleware:
    """Local mirror of `entrypoints.routers.SupportHeadersMiddleware`.

    Importing the production middleware pulls the full app composition root
    (DAOs, services, EE wiring), which is too heavy for a unit test.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        token = support_ctx.set(None)

        async def send_with_support(message):
            if message["type"] == "http.response.start":
                support = support_ctx.get()
                if support is not None:
                    headers = list(message.get("headers", []))
                    if support.support_id:
                        headers.append(
                            (
                                b"x-ag-support-id",
                                support.support_id.encode("latin-1"),
                            )
                        )
                    if support.support_ts:
                        headers.append(
                            (
                                b"x-ag-support-ts",
                                support.support_ts.isoformat().encode("latin-1"),
                            )
                        )
                    message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_support)
        finally:
            support_ctx.reset(token)


def _build_test_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(_SupportHeadersMiddleware)

    @app.get("/fail")
    @suppress_exceptions(default={"count": 0}, verbose=False)
    async def fail(request: Request):
        raise RuntimeError("boom")

    @app.get("/ok")
    @suppress_exceptions(default={"count": 0}, verbose=False)
    async def ok(request: Request):
        return {"count": 1}

    return app


def test_support_headers_middleware_emits_headers():
    client = TestClient(_build_test_app())

    response = client.get("/fail")

    assert response.status_code == 200
    assert "x-ag-support-id" in response.headers
    assert "x-ag-support-ts" in response.headers
    # ISO-8601 with timezone info.
    assert (
        datetime.fromisoformat(response.headers["x-ag-support-ts"]).tzinfo is not None
    )
    # Body is the bare default — no support fields.
    body = response.json()
    assert "support_id" not in body
    assert "support_ts" not in body


def test_support_headers_absent_on_success():
    client = TestClient(_build_test_app())

    response = client.get("/ok")

    assert response.status_code == 200
    assert "x-ag-support-id" not in response.headers
    assert "x-ag-support-ts" not in response.headers
