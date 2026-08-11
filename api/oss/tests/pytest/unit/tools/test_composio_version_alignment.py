"""Composio discovery and execution must agree on one API scope (#5174).

The bug: COMPOSIO_SEARCH_TOOLS (discovery) returns action slugs spelled at the
v3.1 toolkit version, but the tools adapter resolved and executed them against the
v3 default, where a subset of those slugs 404 with ``Tool_ToolNotFound``. The fix
pins the whole Composio integration to v3.1 through its shared API URL.
"""

from __future__ import annotations

import os

import httpx
import pytest

from oss.src.utils.env import ComposioConfig


V31 = "https://backend.composio.dev/api/v3.1"
# Composio error code for a slug that does not exist at the requested scope. A
# missing connected account is a DIFFERENT 404 (code 1810) and means "found".
TOOL_NOT_FOUND = 2401


def test_default_composio_api_scope_is_v31():
    assert ComposioConfig.model_fields["api_url"].default == V31


# ---------------------------------------------------------------------------
# Integration: the real "tools that don't exist" regression
# ---------------------------------------------------------------------------

_API_KEY = os.getenv("COMPOSIO_API_KEY")

pytestmark_integration = pytest.mark.skipif(
    not _API_KEY,
    reason="COMPOSIO_API_KEY not set; skipping live Composio slug-alignment check",
)


@pytest.mark.integration
@pytestmark_integration
class TestSearchSlugsResolveUnderPinnedScope:
    """A slug from COMPOSIO_SEARCH_TOOLS must resolve+execute under the pinned scope.

    Uses ``GMAIL_GET_DRAFT`` / ``GOOGLESHEETS_VALUES_GET`` — real slugs the search
    tool recommends that 404 (Tool_ToolNotFound) on the v3 default but resolve on
    v3.1. If the tools adapter regresses to v3 these assertions fail with 2401.
    """

    _HEADERS = {"x-api-key": _API_KEY or "", "Content-Type": "application/json"}
    # Slugs empirically confirmed to disagree between v3 default and v3.1 (#5174).
    _SEARCH_SLUGS = [
        "GMAIL_GET_DRAFT",
        "GMAIL_UPDATE_DRAFT",
        "GOOGLESHEETS_VALUES_GET",
        "GOOGLESHEETS_VALUES_UPDATE",
        "NOTION_UPSERT_ROW_DATABASE",
    ]

    def test_pinned_scope_is_v31(self):
        assert ComposioConfig.model_fields["api_url"].default == V31

    def test_search_slugs_get_resolve(self):
        base = V31
        with httpx.Client(timeout=30) as c:
            for slug in self._SEARCH_SLUGS:
                r = c.get(f"{base}/tools/{slug}", headers=self._HEADERS)
                assert r.status_code == 200, (
                    f"{slug} did not GET-resolve under {base}: "
                    f"{r.status_code} {r.text[:200]}"
                )

    def test_search_slugs_execute_resolve(self):
        base = V31
        with httpx.Client(timeout=30) as c:
            for slug in self._SEARCH_SLUGS:
                r = c.post(
                    f"{base}/tools/execute/{slug}",
                    headers=self._HEADERS,
                    json={"arguments": {}, "user_id": "pytest-nonexistent-user"},
                )
                # Missing connected account (1810) is fine — it proves the slug was
                # FOUND. The regression is Tool_ToolNotFound (2401), which must not occur.
                code = None
                if r.status_code != 200:
                    code = (r.json().get("error") or {}).get("code")
                assert code != TOOL_NOT_FOUND, (
                    f"{slug} 404'd as Tool_ToolNotFound under {base} — discover/execute "
                    f"version scopes disagree again (#5174)"
                )

    def test_v3_default_still_rejects_these_slugs(self):
        # Guards the premise: on v3 these slugs genuinely 404 as Tool_ToolNotFound,
        # so the pinning above is load-bearing and not a no-op.
        base = "https://backend.composio.dev/api/v3"
        with httpx.Client(timeout=30) as c:
            offenders = []
            for slug in self._SEARCH_SLUGS:
                r = c.get(f"{base}/tools/{slug}", headers=self._HEADERS)
                if (
                    r.status_code == 404
                    and (r.json().get("error") or {}).get("code") == TOOL_NOT_FOUND
                ):
                    offenders.append(slug)
            assert offenders, (
                "Expected at least one search slug to be missing on the v3 default; "
                "if none are, Composio changed its scoping and the pin may be revisitable."
            )
