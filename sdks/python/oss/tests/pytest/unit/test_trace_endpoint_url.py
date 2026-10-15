"""Regression tests for `strip_api_suffix` (agenta/sdk/utils/helpers.py).

Context: `AgentaSingleton.init()` (agenta/sdk/utils/init.py) derives `self.host`
from `AGENTA_API_URL` / `AGENTA_API_INTERNAL_URL` and then builds the OTLP trace
endpoint as `f"{self.host}/api/otlp/v1/traces"`. The old implementation derived
`self.host` with an unanchored `_api_url.rsplit("/api", 1)[0]`, which matched the
literal substring "/api" anywhere in the URL - including inside the host - not
just a trailing "/api" *path segment*. For an internal base URL whose host is
literally "api" (e.g. "http://api:8000"), this corrupted the host (dropping the
port) and broke the trace endpoint. See GitHub issue #6787.

`strip_api_suffix` fixes this by parsing the URL with `urlsplit`/`urlunsplit`
and only ever trimming a trailing "/api" segment from the *path* component,
leaving scheme/host/port untouched no matter what the host is named.
"""

import pytest

from agenta.sdk.utils.helpers import strip_api_suffix


class TestStripApiSuffix:
    """Direct unit tests on the URL-parsing helper."""

    @pytest.mark.parametrize(
        ("url", "expected"),
        [
            # Regression case from #6787: host is literally "api", with a
            # port and no "/api" path segment at all. The bug used to
            # collapse "http://api:8000" down to "http:/", dropping the
            # port entirely. Nothing should be stripped here.
            ("http://api:8000", "http://api:8000"),
            # Host merely *contains* "api" as a substring (subdomain), with
            # no "/api" path segment. Must be left untouched.
            ("https://api.example.com", "https://api.example.com"),
            # Same, but with an explicit "/api" path segment that should be
            # stripped - scheme/host/port must survive.
            ("https://api.example.com/api", "https://api.example.com"),
            ("http://api.example.com:8443/api", "http://api.example.com:8443"),
            # Ordinary public host with a trailing "/api" suffix (the
            # documented, intended use case).
            ("https://cloud.agenta.ai/api", "https://cloud.agenta.ai"),
            # Ordinary internal host, no "/api" suffix - unchanged.
            ("http://agenta-api:8000", "http://agenta-api:8000"),
            # Host with a port and a trailing "/api" suffix.
            ("http://localhost:8000/api", "http://localhost:8000"),
            # Nested path ending in a genuine "/api" segment.
            ("https://example.com/some/api", "https://example.com/some"),
            # "api" appearing as part of a *different* path segment (not
            # anchored on a "/") must not be stripped.
            ("https://example.com/myapi", "https://example.com/myapi"),
        ],
    )
    def test_strip_api_suffix(self, url, expected):
        assert strip_api_suffix(url) == expected


class TestTraceEndpointConstruction:
    """
    Reproduces the exact derivation `AgentaSingleton.init()` performs
    (`_host = strip_api_suffix(_api_url)` followed by building the trace
    endpoint as `f"{host}/api/otlp/v1/traces"`), for the scenarios called
    out in issue #6787.
    """

    @pytest.mark.parametrize(
        ("api_url", "expected_host", "expected_trace_endpoint"),
        [
            (
                "http://api:8000",
                "http://api:8000",
                "http://api:8000/api/otlp/v1/traces",
            ),
            (
                "https://api.example.com",
                "https://api.example.com",
                "https://api.example.com/api/otlp/v1/traces",
            ),
            (
                "http://agenta-api:8000",
                "http://agenta-api:8000",
                "http://agenta-api:8000/api/otlp/v1/traces",
            ),
            (
                "https://cloud.agenta.ai/api",
                "https://cloud.agenta.ai",
                "https://cloud.agenta.ai/api/otlp/v1/traces",
            ),
        ],
    )
    def test_trace_endpoint_built_correctly(
        self, api_url, expected_host, expected_trace_endpoint
    ):
        host = strip_api_suffix(api_url)
        trace_endpoint = f"{host}/api/otlp/v1/traces"

        assert host == expected_host
        assert trace_endpoint == expected_trace_endpoint
