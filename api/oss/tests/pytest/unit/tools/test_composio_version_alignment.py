"""Composio discover/resolve/execute must agree on ONE toolkit-version scope (#5174).

The bug: COMPOSIO_SEARCH_TOOLS (discovery) returns action slugs spelled at the
v3.1 toolkit version, but the tools adapter resolved and executed them against the
v3 default, where a subset of those slugs 404 with ``Tool_ToolNotFound`` — discovery
surfacing "tools that don't exist". The fix pins the tools adapter to v3.1 so list,
search, get_action, and execute all resolve the same slug set.

Two layers here:

* ``TestToolsApiUrlDerivation`` — pure unit, always runs. Pins the v3.1 derivation
  and the override/host-preservation behavior that the fix rests on.
* ``TestSearchSlugsResolveUnderPinnedScope`` — integration, requires COMPOSIO_API_KEY.
  The regression itself: a slug returned by COMPOSIO_SEARCH_TOOLS must GET-resolve and
  execute-resolve (never ``Tool_ToolNotFound``) under the pinned tools scope.
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


class TestToolsApiUrlDerivation:
    """tools_api_url forces the version segment to v3.1 while preserving the host."""

    def test_default_v3_is_pinned_to_v31(self):
        cfg = ComposioConfig(api_url="https://backend.composio.dev/api/v3")
        assert cfg.tools_api_url == V31

    def test_already_v31_stays_v31(self):
        cfg = ComposioConfig(api_url="https://backend.composio.dev/api/v3.1")
        assert cfg.tools_api_url == V31

    def test_trailing_slash_is_normalized(self):
        cfg = ComposioConfig(api_url="https://backend.composio.dev/api/v3/")
        assert cfg.tools_api_url == V31

    def test_self_hosted_host_is_preserved(self):
        cfg = ComposioConfig(api_url="https://composio.internal.example.com/api/v3")
        assert cfg.tools_api_url == "https://composio.internal.example.com/api/v3.1"

    def test_explicit_override_wins(self):
        cfg = ComposioConfig(
            api_url="https://backend.composio.dev/api/v3",
            tools_api_url_override="https://composio.internal/api/v3.1/",
        )
        assert cfg.tools_api_url == "https://composio.internal/api/v3.1"


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

    def _tools_url(self) -> str:
        # Exercise the same derivation the app uses, from the default v3 base.
        return ComposioConfig(
            api_url="https://backend.composio.dev/api/v3"
        ).tools_api_url

    def test_pinned_scope_is_v31(self):
        assert self._tools_url() == V31

    def test_search_slugs_get_resolve(self):
        base = self._tools_url()
        with httpx.Client(timeout=30) as c:
            for slug in self._SEARCH_SLUGS:
                r = c.get(f"{base}/tools/{slug}", headers=self._HEADERS)
                assert r.status_code == 200, (
                    f"{slug} did not GET-resolve under {base}: "
                    f"{r.status_code} {r.text[:200]}"
                )

    def test_search_slugs_execute_resolve(self):
        base = self._tools_url()
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
