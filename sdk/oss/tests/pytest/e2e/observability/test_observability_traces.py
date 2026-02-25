"""
Integration tests for the Observability API.

Tests cover:
- Trace create/fetch/edit/delete lifecycle (sync)
- Trace create/fetch/delete lifecycle (async)
- Span attributes and identifiers

Run with:
    pytest sdk/tests/integration/tracing/ -v -m integration

Environment variables:
    AGENTA_API_KEY: Required for authentication
    AGENTA_HOST: Optional, defaults to https://cloud.agenta.ai
"""

import pytest
from uuid import uuid4

import agenta as ag


pytestmark = [pytest.mark.e2e]


@pytest.mark.e2e
@pytest.mark.asyncio
class TestObservabilityAsync:
    """Test async observability API."""

    async def test_async_trace_lifecycle(self, agenta_init, otlp_flat_span_factory):
        """Test async trace create/fetch/delete."""
        # Generate client-side IDs
        client_trace_id = uuid4().hex
        client_span_id = uuid4().hex[:16]

        span = otlp_flat_span_factory(
            trace_id=client_trace_id,
            span_id=client_span_id,
            span_name="sdk-it-async-span",
            attributes={"sdk_it": "true", "sdk_it_mode": "async"},
        )

        trace_id = None
        try:
            # Create trace using async API
            created = await ag.async_api.observability.create_trace(
                sync=True, spans=[span]
            )
            assert created.links is not None and len(created.links) >= 1

            # Use the first returned link as the canonical trace identifier
            link = created.links[0]
            trace_id = link.trace_id.replace("-", "")
            span_id = link.span_id.replace("-", "")
            if len(span_id) > 16:
                span_id = span_id[:16]

            assert isinstance(trace_id, str) and trace_id
            assert isinstance(span_id, str) and span_id

            # Fetch trace using async API
            fetched = await ag.async_api.observability.fetch_trace(trace_id)
            assert fetched.traces is not None

            tree = (fetched.traces or {}).get(trace_id)
            if tree is None and fetched.traces:
                # Some backends may normalize the trace_id key in the response
                tree = next(iter(fetched.traces.values()))

            assert tree is not None
            assert tree.spans is not None

            spans_map = tree.spans or {}
            span_out = spans_map.get("sdk-it-async-span") or next(
                (
                    s
                    for s in spans_map.values()
                    if getattr(s, "span_id", None) == span_id
                ),
                None,
            )
            assert span_out is not None
            assert span_out.span_id == span_id

        finally:
            # Cleanup: delete the trace
            if trace_id:
                try:
                    await ag.async_api.observability.delete_trace(trace_id)
                except Exception:
                    pass
