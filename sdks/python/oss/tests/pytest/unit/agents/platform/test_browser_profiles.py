"""`read_browser_profiles` asks the API which logins the run may use, and reads any failure as none."""

from __future__ import annotations

import json
from typing import Any, List, Optional

import httpx
import pytest

from agenta.sdk.agents.platform import PlatformConnection, read_browser_profiles
from agenta.sdk.agents.platform import browser_profiles as module


def _serve(monkeypatch, response: httpx.Response) -> List[Any]:
    seen: List[Any] = []

    def _handle(request: httpx.Request) -> httpx.Response:
        seen.append((str(request.url), json.loads(request.content)))
        return response

    real = httpx.AsyncClient
    monkeypatch.setattr(
        module.httpx,
        "AsyncClient",
        lambda **kwargs: real(transport=httpx.MockTransport(_handle), **kwargs),
    )
    return seen


async def _read(**kwargs) -> Optional[List[str]]:
    return await read_browser_profiles(
        connection=PlatformConnection(base_url="http://api.test/api"), **kwargs
    )


async def test_it_posts_the_binding_and_returns_the_ids(monkeypatch):
    seen = _serve(
        monkeypatch,
        httpx.Response(200, json={"count": 3, "profile_ids": ["p1", "", 7, "p2"]}),
    )

    ids = await _read(revision_id="rev-1", is_draft=False)

    assert ids == ["p1", "p2"]
    assert seen == [
        (
            "http://api.test/api/browser-profiles/available",
            {"revision_id": "rev-1", "is_draft": False},
        )
    ]


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(404, json={"detail": "Not Found"}),
        httpx.Response(200, content=b"not json"),
        httpx.Response(200, json=["p1"]),
        httpx.Response(200, json={"profile_ids": "p1"}),
    ],
)
async def test_a_failure_or_bad_body_is_no_browser(monkeypatch, response):
    _serve(monkeypatch, response)

    assert await _read(revision_id=None, is_draft=True) is None


async def test_an_eligible_run_with_no_logins_is_empty_not_none(monkeypatch):
    _serve(
        monkeypatch,
        httpx.Response(200, json={"count": 0, "profile_ids": [], "eligible": True}),
    )

    assert await _read(revision_id=None, is_draft=True) == []


async def test_an_ineligible_run_is_none(monkeypatch):
    _serve(
        monkeypatch,
        httpx.Response(200, json={"count": 0, "profile_ids": [], "eligible": False}),
    )

    assert await _read(revision_id="rev-1", is_draft=False) is None
