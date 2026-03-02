from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from oss.src.apis.fastapi.otlp.router import OTLPRouter


class _DummyRequest:
    def __init__(self, body: bytes):
        self._body = body
        self.state = SimpleNamespace(
            project_id="11111111-1111-1111-1111-111111111111",
            organization_id="22222222-2222-2222-2222-222222222222",
            user_id="33333333-3333-3333-3333-333333333333",
        )

    async def body(self):
        return self._body


@pytest.mark.asyncio
async def test_otlp_ingest_continues_when_one_span_parse_fails(monkeypatch):
    worker = AsyncMock()
    router = OTLPRouter(tracing_worker=worker)

    monkeypatch.setattr(
        "oss.src.apis.fastapi.otlp.router.parse_otlp_stream",
        lambda _stream: ["good", "bad"],
    )

    def _parse_from_otel_span_dto(otel_span):
        if otel_span == "bad":
            raise ValueError("malformed span")
        return {"span": otel_span}

    monkeypatch.setattr(
        "oss.src.apis.fastapi.otlp.router.parse_from_otel_span_dto",
        _parse_from_otel_span_dto,
    )
    monkeypatch.setattr(
        "oss.src.apis.fastapi.otlp.router.calculate_and_propagate_metrics",
        lambda spans: spans,
    )

    # In EE mode this symbol exists; in OSS mode it's absent.
    async def _mock_check_action_access(*args, **kwargs):
        return True

    monkeypatch.setattr(
        "oss.src.apis.fastapi.otlp.router.check_action_access",
        _mock_check_action_access,
        raising=False,
    )

    response = await router.otlp_ingest(_DummyRequest(body=b"otlp"))

    assert response.status_code == 200
    worker.publish_to_stream.assert_awaited_once()
    queued_spans = worker.publish_to_stream.await_args.kwargs["span_dtos"]
    assert queued_spans == [{"span": "good"}]
