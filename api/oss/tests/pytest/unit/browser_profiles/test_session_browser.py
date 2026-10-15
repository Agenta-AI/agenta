import json
from typing import Any, Dict, Optional
from uuid import UUID

import httpx
import pytest

from oss.src.core.browser_profiles.dtos import BrowserProfile, BrowserProfileState
from oss.src.core.browser_profiles.runner_client import BrowserRunnerClient
from oss.src.core.browser_profiles.service import BrowserProfilesService

PROJECT = UUID("00000000-0000-0000-0000-000000000001")
OWNER = UUID("00000000-0000-0000-0000-00000000000a")
OTHER = UUID("00000000-0000-0000-0000-00000000000b")
PROFILE = UUID("00000000-0000-0000-0000-0000000000f1")


class FakeDAO:
    async def fetch_profile(
        self, *, project_id: UUID, profile_id: UUID
    ) -> Optional[BrowserProfile]:
        if profile_id != PROFILE:
            return None
        return BrowserProfile(
            id=PROFILE,
            name="Ops",
            allowed_hosts=["example.com"],
            state=BrowserProfileState.READY,
            generation=1,
            created_by_id=OWNER,
        )


def service_with_runner(monkeypatch, payload: Dict[str, Any]) -> tuple:
    """A service whose runner answers `/browser/find` with `payload`; also returns what it was sent."""
    seen: Dict[str, Any] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = request.content
        return httpx.Response(200, json=payload)

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda *a, **k: original(
            *a, **{**k, "transport": httpx.MockTransport(handler)}
        ),
    )
    runner = BrowserRunnerClient(base_url="http://runner", token="t")
    return BrowserProfilesService(
        browser_profiles_dao=FakeDAO(),  # type: ignore[arg-type]
        workflows_service=object(),  # type: ignore[arg-type]
        runner_client=runner,
        controller_client=object(),  # type: ignore[arg-type]
    ), seen


SANDBOX = {
    "sandboxId": "local-1",
    "url": "http://10.0.0.5:4000",
    "headers": {"x-agenta-browser-token": "x"},
    "profileId": f"user-{OWNER}",
}


@pytest.mark.asyncio
async def test_the_lookup_names_the_caller_as_owner(monkeypatch):
    service, seen = service_with_runner(monkeypatch, SANDBOX)

    sandbox = await service.find_session_browser(
        project_id=PROJECT, user_id=OWNER, session_id="sess-1"
    )

    assert sandbox is not None
    assert sandbox.label == f"user-{OWNER}"
    assert sandbox.headers == {"x-agenta-browser-token": "x"}
    assert json.loads(seen["body"])["profileId"] == f"user-{OWNER}"


@pytest.mark.asyncio
async def test_another_user_asks_for_their_own_browser(monkeypatch):
    service, seen = service_with_runner(monkeypatch, SANDBOX)

    await service.find_session_browser(
        project_id=PROJECT, user_id=OTHER, session_id="sess-1"
    )

    assert json.loads(seen["body"])["profileId"] == f"user-{OTHER}"
