import json

import pytest

from agenta.sdk.decorators.routing import handle_invoke_failure
from agenta.sdk.engines.running.errors import ErrorStatus


def _body(response):
    return json.loads(response.body.decode())


@pytest.mark.asyncio
async def test_generic_exception_response_has_no_traceback():
    try:
        raise ValueError("boom")
    except ValueError as exc:
        response = await handle_invoke_failure(exc)

    status = _body(response)["status"]
    assert status["message"] == "boom"
    assert status.get("stacktrace") is None
    assert "Traceback" not in json.dumps(_body(response))


@pytest.mark.asyncio
async def test_error_status_response_drops_its_stacktrace():
    exc = ErrorStatus(
        code=500,
        type="https://agenta.ai/docs/errors#test",
        message="clean message",
        stacktrace="Traceback (most recent call last): ...",
    )
    response = await handle_invoke_failure(exc)

    status = _body(response)["status"]
    assert status["message"] == "clean message"
    assert status.get("stacktrace") is None
