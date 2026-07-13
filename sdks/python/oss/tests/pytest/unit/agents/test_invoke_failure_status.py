"""XP-3: the invoke remap must give documented errors their documented HTTP status.

``handle_invoke_failure`` reads ``status_code`` off the exception and otherwise falls through
to 500. ``qa/matrix.md`` documents ``UnsupportedDeployment`` as HTTP 422 (and calls anything
else a finding), so the exception must carry the status.
"""

from __future__ import annotations

import json

from agenta.sdk.agents.connections import UnsupportedDeploymentError
from agenta.sdk.decorators.routing import handle_invoke_failure


async def _status_and_body(exception: Exception) -> tuple[int, dict]:
    response = await handle_invoke_failure(exception)
    return response.status_code, json.loads(bytes(response.body))


async def test_unsupported_deployment_remaps_to_422():
    status, body = await _status_and_body(
        UnsupportedDeploymentError(deployment="bedrock", harness="claude")
    )
    assert status == 422
    assert "bedrock" in json.dumps(body)


async def test_unremarkable_exception_still_remaps_to_500():
    # The fallback must stay 500 — 422 is opt-in via `status_code`, not the new default.
    status, _ = await _status_and_body(RuntimeError("boom"))
    assert status == 500
