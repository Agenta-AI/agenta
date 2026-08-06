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

import time

import pytest
from uuid import uuid4

import agenta as ag


def _poll_fetch_trace(
    fetch_fn, trace_id, max_retries=15, initial_delay=0.5, max_delay=8.0
):
    """Poll fetch_trace until traces is not None or retries exhausted."""
    delay = initial_delay
    for attempt in range(max_retries):
        fetched = fetch_fn(trace_id)
        if fetched.traces is not None:
            return fetched
        if attempt < max_retries - 1:
            time.sleep(delay)
            delay = min(delay * 2, max_delay)
    return fetched


async def _async_poll_fetch_trace(
    fetch_fn, trace_id, max_retries=15, initial_delay=0.5, max_delay=8.0
):
    """Async poll fetch_trace until traces is not None or retries exhausted."""
    delay = initial_delay
    for attempt in range(max_retries):
        fetched = await fetch_fn(trace_id)
        if fetched.traces is not None:
            return fetched
        if attempt < max_retries - 1:
            time.sleep(delay)
            delay = min(delay * 2, max_delay)
    return fetched


pytestmark = [pytest.mark.acceptance]


@pytest.mark.acceptance
@pytest.mark.skip(
    reason=(
        "Targets deprecated /tracing/* SDK methods (create_trace_tracing, "
        "fetch_trace_tracing, edit_trace_tracing, delete_trace_tracing) which "
        "were dropped from client regen. Rewrite against the canonical "
        "ag.api.traces.{create_trace,fetch_trace,edit_trace,delete_trace} which "
        "take a single Trace (tree) instead of a list of spans."
    )
)
def test_observability_trace_lifecycle(agenta_init, otlp_flat_span_factory):
    # Provide client-side IDs, but treat server-returned IDs as canonical.
    # Some deployments may normalize or rewrite trace/span identifiers.
    client_trace_id = uuid4().hex
    client_span_id = uuid4().hex[:16]

    span = otlp_flat_span_factory(
        trace_id=client_trace_id,
        span_id=client_span_id,
        span_name="sdk-it-span",
        # Avoid dotted keys; some backends normalize them into nested objects.
        attributes={"sdk_it": "true", "sdk_it_phase": "create"},
    )

    try:
        created = ag.api.traces.create_trace_tracing(spans=[span])
        assert created.links is not None and len(created.links) >= 1

        # Use the first returned link as the canonical trace/span identifiers.
        link = created.links[0]
        trace_id = link.trace_id
        span_id = link.span_id

        # Normalize IDs: some backends may return UUID-like strings for span_id.
        trace_id = trace_id.replace("-", "")
        span_id = span_id.replace("-", "")
        if len(span_id) > 16:
            span_id = span_id[:16]
        assert isinstance(trace_id, str) and trace_id
        assert isinstance(span_id, str) and span_id

        fetched = _poll_fetch_trace(ag.api.traces.fetch_trace_tracing, trace_id)
        assert fetched.traces is not None
        tree = (fetched.traces or {}).get(trace_id)
        if tree is None and fetched.traces:
            # Some backends may normalize the trace_id key in the response.
            tree = next(iter(fetched.traces.values()))
        assert tree is not None
        assert tree.spans is not None
        spans_map = tree.spans or {}
        span_out = spans_map.get("sdk-it-span") or next(
            (s for s in spans_map.values() if getattr(s, "span_id", None) == span_id),
            None,
        )
        assert span_out is not None
        assert span_out.span_id == span_id

        updated_span = otlp_flat_span_factory(
            trace_id=trace_id,
            span_id=span_id,
            span_name="sdk-it-span",
            attributes={"sdk_it": "true", "sdk_it_phase": "edit"},
        )

        edited = ag.api.traces.edit_trace_tracing(trace_id, spans=[updated_span])
        assert edited.links is not None and len(edited.links) >= 1

        def _get_updated_span(fetch_fn, tid, sid):
            """Poll until the edited span shows sdk_it_phase=edit."""
            delay = 0.5
            for attempt in range(15):
                fetched = fetch_fn(tid)
                if fetched.traces:
                    tree = (fetched.traces or {}).get(tid) or (
                        next(iter(fetched.traces.values())) if fetched.traces else None
                    )
                    if tree and tree.spans:
                        spans_map = tree.spans or {}
                        s = spans_map.get("sdk-it-span") or next(
                            (
                                v
                                for v in spans_map.values()
                                if getattr(v, "span_id", None) == sid
                            ),
                            None,
                        )
                        if (
                            s
                            and s.attributes
                            and s.attributes.get("sdk_it_phase") == "edit"
                        ):
                            return fetched
                if attempt < 14:
                    time.sleep(delay)
                    delay = min(delay * 2, 8.0)
            return fetched

        refetched = _get_updated_span(
            ag.api.traces.fetch_trace_tracing, trace_id, span_id
        )
        assert refetched.traces is not None
        tree2 = (refetched.traces or {}).get(trace_id)
        if tree2 is None and refetched.traces:
            tree2 = next(iter(refetched.traces.values()))
        assert tree2 is not None
        assert tree2.spans is not None
        spans_map2 = tree2.spans or {}
        target = spans_map2.get("sdk-it-span") or next(
            (s for s in spans_map2.values() if getattr(s, "span_id", None) == span_id),
            None,
        )
        assert target is not None
        assert target.attributes is not None
        assert target.attributes.get("sdk_it_phase") == "edit"

    finally:
        try:
            # Use canonical trace_id if create_trace succeeded.
            trace_id = locals().get("trace_id")
            if trace_id:
                ag.api.traces.delete_trace_tracing(trace_id)
        except Exception:
            pass


@pytest.mark.acceptance
@pytest.mark.asyncio
class TestObservabilityAsync:
    """Test async observability API."""

    @pytest.mark.skip(
        reason=(
            "Targets deprecated /tracing/* async SDK methods "
            "(create_trace_tracing, fetch_trace_tracing, delete_trace_tracing) "
            "which were dropped from client regen. Rewrite against the canonical "
            "ag.async_api.traces.{create_trace,fetch_trace,delete_trace}."
        )
    )
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
            created = await ag.async_api.traces.create_trace_tracing(spans=[span])
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
            fetched = await _async_poll_fetch_trace(
                ag.async_api.traces.fetch_trace_tracing, trace_id
            )
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
                    await ag.async_api.traces.delete_trace_tracing(trace_id)
                except Exception:
                    pass
