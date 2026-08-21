"""Live Composio checks for the toolkit run/search tools (needs COMPOSIO_API_KEY).

These drive the same adapter methods the ``gateway_toolkit`` search and run tools use:
``search_capabilities`` (COMPOSIO_SEARCH_TOOLS) and ``execute_action_slug`` (per-slug
execute). They discover a live ACTIVE connected account rather than hardcoding ids, so no
real id is committed. Skipped when no key is present.

The policy rejection ("run rejects a disallowed slug") happens server-side before any
Composio call, so it needs no live connection; it is covered deterministically in
``test_toolkit_tool_call.py``.
"""

from __future__ import annotations

import os

import httpx
import pytest

from oss.src.core.tools.providers.composio.adapter import ComposioToolsAdapter

_API_KEY = os.getenv("COMPOSIO_API_KEY")
_V31 = "https://backend.composio.dev/api/v3.1"

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not _API_KEY,
        reason="COMPOSIO_API_KEY not set; skipping live Composio toolkit checks",
    ),
]

# A safe, read-only, no-argument action per toolkit. The live test only runs one of these,
# for whichever toolkit has an ACTIVE connection.
_READ_ACTIONS = {
    "gmail": ("GMAIL_GET_PROFILE", "read my gmail profile"),
    "github": (
        "GITHUB_GET_THE_AUTHENTICATED_USER",
        "get the authenticated github user",
    ),
}


def _discover_active_account():
    """Return (toolkit, connected_account_id, user_id) for a supported ACTIVE account."""
    headers = {"x-api-key": _API_KEY, "Content-Type": "application/json"}
    with httpx.Client(timeout=30) as client:
        resp = client.get(f"{_V31}/connected_accounts", headers=headers)
        resp.raise_for_status()
        body = resp.json()
    items = body.get("items") or body.get("data") or []
    for item in items:
        toolkit = item.get("toolkit") or {}
        slug = (toolkit.get("slug") if isinstance(toolkit, dict) else toolkit) or ""
        if item.get("status") == "ACTIVE" and slug.lower() in _READ_ACTIONS:
            return slug.lower(), item.get("id"), item.get("user_id")
    return None, None, None


@pytest.fixture
def active_account():
    toolkit, account_id, user_id = _discover_active_account()
    if not account_id:
        pytest.skip(
            "no ACTIVE connected account for a supported toolkit "
            f"({', '.join(_READ_ACTIONS)}); skipping live toolkit checks"
        )
    return toolkit, account_id, user_id


@pytest.fixture
async def adapter():
    adapter = ComposioToolsAdapter(api_key=_API_KEY)
    try:
        yield adapter
    finally:
        await adapter.close()


async def test_search_returns_matches_for_the_toolkit(adapter, active_account):
    toolkit, _account_id, user_id = active_account
    _slug, use_case = _READ_ACTIONS[toolkit]

    result = await adapter.search_capabilities(use_cases=[use_case], user_id=user_id)

    matches = [
        slug
        for slug, schema in result.tool_schemas.items()
        if (schema.toolkit or "").lower() == toolkit
    ]
    assert matches, f"search returned no {toolkit} actions for {use_case!r}"


async def test_run_executes_an_allowed_action(adapter, active_account):
    toolkit, account_id, user_id = active_account
    slug, _use_case = _READ_ACTIONS[toolkit]

    response = await adapter.execute_action_slug(
        tool_slug=slug,
        provider_connection_id=account_id,
        user_id=user_id,
        arguments={},
    )

    assert response.successful, f"{slug} did not run: {response.error}"
    assert response.data is not None
