"""Composio discovery and execution must agree on one toolkit version (#5174).

The REST API scope stays on v3.1. Independently, each gateway run resolves the mutable
``latest`` toolkit alias to a concrete version and uses it for catalog and execution.
"""

from __future__ import annotations

import os

import httpx
import pytest

from oss.src.core.tools.exceptions import AdapterError
from oss.src.core.tools.providers.composio.catalog import (
    COMPOSIO_TOOLKIT_VERSION,
)
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


# ---------------------------------------------------------------------------
# Toolkit version: a SECOND version axis, independent of the API scope above
# ---------------------------------------------------------------------------


class _Recorder:
    """Stands in for the adapter's httpx client and records the outbound call."""

    def __init__(self, payload=None):
        self.calls = []
        self._payload = payload or {}

    async def get(self, url, **kwargs):
        self.calls.append({"method": "GET", "url": url, **kwargs})
        return httpx.Response(
            200, json=self._payload, request=httpx.Request("GET", url)
        )

    async def post(self, url, **kwargs):
        self.calls.append({"method": "POST", "url": url, **kwargs})
        return httpx.Response(
            200, json=self._payload, request=httpx.Request("POST", url)
        )


def _adapter(recorder):
    from oss.src.core.tools.providers.composio.adapter import ComposioToolsAdapter

    adapter = ComposioToolsAdapter(api_key="k", api_url="https://x/api/v3.1")
    adapter._client = recorder
    return adapter


class TestEveryComposioCallPinsTheToolkitVersion:
    """Listing, detail, and execute must resolve the SAME toolkit version.

    The API scope pinned above (v3.1) is a different axis and does not settle this
    one. ``COMPOSIO_SEARCH_TOOLS`` always searches the LATEST toolkit version, while
    an unversioned listing returns the account's pinned snapshot, so every search hit
    died against a policy compiled from the old catalog. Measured 2026-08-27:
    ``browser_tool`` lists 18 screenshot-era tools unversioned, and the 5 task tools
    search actually returns at latest.

    Each endpoint spells the parameter differently, which is why these assert the
    exact outbound shape rather than "a version was sent somewhere".
    """

    async def test_listing_sends_toolkit_versions(self):
        recorder = _Recorder({"items": [], "next_cursor": None})
        await _adapter(recorder).list_actions(integration_key="browser_tool")

        params = recorder.calls[0]["params"]
        # Plural: a singular ``version`` here is accepted and silently IGNORED.
        assert params["toolkit_versions"] == COMPOSIO_TOOLKIT_VERSION

    async def test_latest_resolves_from_documented_toolkit_metadata(self):
        recorder = _Recorder({"slug": "github", "meta": {"version": "20250827_00"}})

        resolved = await _adapter(recorder).resolve_toolkit_version(
            integration_key="github"
        )

        assert resolved == "20250827_00"
        assert recorder.calls[0]["url"].endswith("/toolkits/github")
        assert recorder.calls[0]["params"] == {"version": "latest"}

    @pytest.mark.parametrize(
        "payload",
        [
            {},
            {"meta": {}},
            {"meta": {"version": "latest"}},
        ],
    )
    async def test_version_resolution_rejects_missing_or_mutable_metadata(
        self, payload
    ):
        with pytest.raises(AdapterError, match="no concrete toolkit version"):
            await _adapter(_Recorder(payload)).resolve_toolkit_version(
                integration_key="github"
            )

    async def test_concrete_version_is_used_for_listing_and_detail(self):
        recorder = _Recorder({"items": [], "next_cursor": None})
        adapter = _adapter(recorder)

        await adapter.list_actions(
            integration_key="github", toolkit_version="20250827_00"
        )
        recorder._payload = {"name": "Get issue"}
        await adapter.get_action(
            action_key="GET_ISSUE",
            provider_action_id="GITHUB_GET_ISSUE",
            toolkit_version="20250827_00",
        )

        assert recorder.calls[0]["params"]["toolkit_versions"] == "20250827_00"
        assert recorder.calls[1]["params"]["version"] == "20250827_00"

    async def test_listing_reads_the_input_schema_from_the_pinned_catalog(self):
        recorder = _Recorder(
            {
                "items": [
                    {
                        "slug": "GITHUB_GET_ISSUE",
                        "name": "Get issue",
                        "input_parameters": {
                            "type": "object",
                            "properties": {"number": {"type": "integer"}},
                        },
                    }
                ],
                "next_cursor": None,
            }
        )

        page = await _adapter(recorder).list_actions(
            integration_key="github", toolkit_version="20250827_00"
        )

        assert page.actions[0].input_schema == {
            "type": "object",
            "properties": {"number": {"type": "integer"}},
        }

    async def test_detail_sends_version(self):
        recorder = _Recorder({"name": "Run Browser Task"})
        await _adapter(recorder).get_action(
            action_key="CREATE_TASK",
            provider_action_id="BROWSER_TOOL_CREATE_TASK",
        )

        params = recorder.calls[0]["params"]
        # Singular here, and load-bearing: without it a latest-only slug 404s.
        assert params["version"] == COMPOSIO_TOOLKIT_VERSION

    async def test_execute_sends_version_in_the_body(self):
        from oss.src.core.tools.dtos import ToolExecutionRequest

        recorder = _Recorder({"successful": True, "data": {}})
        await _adapter(recorder).execute(
            request=ToolExecutionRequest(
                integration_key="browser_tool",
                action_key="CREATE_TASK",
                provider_action_id="BROWSER_TOOL_CREATE_TASK",
                toolkit_version="20250827_00",
                arguments={"task": "x"},
                provider_connection_id="ca_1",
                user_id="u1",
            )
        )

        call = recorder.calls[0]
        # In the BODY. The query form is accepted and ignored, so the slug still 404s.
        assert call["json"]["version"] == "20250827_00"
        assert "version" not in (call.get("params") or {})
