"""
Unit tests for the ResolverMiddleware and related helpers.

Tests cover:
- _has_embed_markers() detection of @ag.embed in various config structures
- ResolverMiddleware skipping resolve_embeds() when no markers present
- ResolverMiddleware mirroring resolved parameters onto TracingContext
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from agenta.sdk.contexts.tracing import TracingContext, tracing_context_manager
from agenta.sdk.middlewares.running.resolver import _has_embed_markers


class TestHasEmbedMarkers:
    """Tests for the _has_embed_markers() helper function."""

    def test_empty_dict_returns_false(self):
        assert _has_embed_markers({}) is False

    def test_empty_list_returns_false(self):
        assert _has_embed_markers([]) is False

    def test_plain_string_returns_false(self):
        assert _has_embed_markers("hello world") is False

    def test_none_returns_false(self):
        assert _has_embed_markers(None) is False

    def test_integer_returns_false(self):
        assert _has_embed_markers(42) is False

    # -------------------------------------------------------------------------
    # Object embed (dict key)
    # -------------------------------------------------------------------------

    def test_direct_object_embed_key(self):
        config = {"@ag.embed": {"@ag.references": {"workflow_revision": {}}}}
        assert _has_embed_markers(config) is True

    def test_nested_object_embed_key(self):
        config = {
            "parameters": {
                "prompt": {
                    "@ag.embed": {
                        "@ag.references": {"workflow_revision": {"slug": "my-wf"}},
                    }
                }
            }
        }
        assert _has_embed_markers(config) is True

    def test_deeply_nested_object_embed(self):
        config = {"a": {"b": {"c": {"d": {"@ag.embed": {}}}}}}
        assert _has_embed_markers(config) is True

    def test_embed_in_list_item_dict(self):
        config = {
            "messages": [
                {"role": "system", "content": "hello"},
                {
                    "role": "user",
                    "content": {"@ag.embed": {"@ag.references": {}}},
                },
            ]
        }
        assert _has_embed_markers(config) is True

    # -------------------------------------------------------------------------
    # String embed (substring token)
    # -------------------------------------------------------------------------

    def test_string_embed_token_in_value(self):
        config = {
            "text": "Use this: @ag.embed[@ag.references[workflow_revision.version=v1]]"
        }
        assert _has_embed_markers(config) is True

    def test_string_embed_token_in_list(self):
        config = {
            "items": [
                "normal",
                "@ag.embed[@ag.references[workflow_revision.version=v1]]",
            ]
        }
        assert _has_embed_markers(config) is True

    def test_string_embed_token_at_root(self):
        assert (
            _has_embed_markers(
                "@ag.embed[@ag.references[workflow_revision.version=v1]]"
            )
            is True
        )

    # -------------------------------------------------------------------------
    # Configs without embeds
    # -------------------------------------------------------------------------

    def test_similar_but_not_embed_key(self):
        config = {"@ag.other": "value", "parameters": {"model": "gpt-4"}}
        assert _has_embed_markers(config) is False

    def test_plain_config_no_embeds(self):
        config = {
            "parameters": {
                "prompt": {
                    "messages": [{"role": "system", "content": "You are helpful."}],
                    "llm_config": {"temperature": 0.7, "model": "gpt-4"},
                }
            }
        }
        assert _has_embed_markers(config) is False

    def test_nested_plain_config(self):
        config = {
            "a": {"b": {"c": "value"}},
            "list": [1, 2, {"x": "y"}],
        }
        assert _has_embed_markers(config) is False

    # -------------------------------------------------------------------------
    # Depth guard
    # -------------------------------------------------------------------------

    def test_depth_limit_does_not_crash(self):
        """Deeply nested config must not cause stack overflow."""
        # Build a 30-level deep dict
        config = {}
        current = config
        for _ in range(30):
            current["child"] = {}
            current = current["child"]
        current["@ag.embed"] = {}
        # Depth guard caps at 20, so the embed at level 30 is NOT detected.
        # The function must return without crashing.
        result = _has_embed_markers(config)
        assert isinstance(result, bool)


class TestResolverMiddlewareEmbedGate:
    """Tests that ResolverMiddleware only calls resolve_embeds when markers exist."""

    @pytest.mark.asyncio
    async def test_skips_resolve_when_no_markers(self):
        """
        When configuration has no @ag.embed markers, resolve_embeds must NOT
        be called (even when resolve flag is True).
        """
        from agenta.sdk.middlewares.running.resolver import ResolverMiddleware
        from agenta.sdk.models.workflows import (
            WorkflowInvokeRequest,
            WorkflowRequestData,
        )

        request = WorkflowInvokeRequest(
            credentials="test-creds",
            flags={"resolve": True},
            data=WorkflowRequestData(
                revision={
                    "data": {
                        "uri": "test://uri",
                        "parameters": {"model": "gpt-4", "temperature": 0.7},
                    }
                }
            ),
        )

        with (
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_handler",
                new_callable=AsyncMock,
                return_value=MagicMock(),
            ),
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_embeds",
                new_callable=AsyncMock,
            ) as mock_resolve_embeds,
        ):
            mw = ResolverMiddleware()
            call_next = AsyncMock(return_value="result")
            with tracing_context_manager(TracingContext()):
                await mw(request, call_next)

        mock_resolve_embeds.assert_not_called()

    @pytest.mark.asyncio
    async def test_calls_resolve_when_markers_present(self):
        """
        When configuration contains @ag.embed markers and resolve flag is True,
        resolve_embeds MUST be called.
        """
        from agenta.sdk.middlewares.running.resolver import ResolverMiddleware
        from agenta.sdk.models.workflows import (
            WorkflowInvokeRequest,
            WorkflowRequestData,
        )

        params_with_embed = {
            "prompt": {
                "@ag.embed": {
                    "@ag.references": {"workflow_revision": {"slug": "base"}},
                }
            }
        }

        request = WorkflowInvokeRequest(
            credentials="test-creds",
            flags={"resolve": True},
            data=WorkflowRequestData(
                revision={
                    "data": {
                        "uri": "test://uri",
                        "parameters": params_with_embed,
                    }
                }
            ),
        )

        resolved_params = {"prompt": "resolved-value"}

        with (
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_handler",
                new_callable=AsyncMock,
                return_value=MagicMock(),
            ),
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_embeds",
                new_callable=AsyncMock,
                return_value=resolved_params,
            ) as mock_resolve_embeds,
        ):
            mw = ResolverMiddleware()
            call_next = AsyncMock(return_value="result")
            with tracing_context_manager(TracingContext()):
                await mw(request, call_next)

        mock_resolve_embeds.assert_called_once_with(
            parameters=params_with_embed,
            credentials="test-creds",
        )

    @pytest.mark.asyncio
    async def test_skips_resolve_when_flag_is_false(self):
        """
        When resolve flag is explicitly False, resolve_embeds must NOT be called
        even if @ag.embed markers are present.
        """
        from agenta.sdk.middlewares.running.resolver import ResolverMiddleware
        from agenta.sdk.models.workflows import (
            WorkflowInvokeRequest,
            WorkflowRequestData,
        )

        params_with_embed = {
            "prompt": {"@ag.embed": {"@ag.references": {"workflow_revision": {}}}}
        }

        request = WorkflowInvokeRequest(
            credentials="test-creds",
            flags={"resolve": False},
            data=WorkflowRequestData(
                revision={
                    "data": {
                        "uri": "test://uri",
                        "parameters": params_with_embed,
                    }
                }
            ),
        )

        with (
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_handler",
                new_callable=AsyncMock,
                return_value=MagicMock(),
            ),
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_embeds",
                new_callable=AsyncMock,
            ) as mock_resolve_embeds,
        ):
            mw = ResolverMiddleware()
            call_next = AsyncMock(return_value="result")
            with tracing_context_manager(TracingContext()):
                await mw(request, call_next)

        mock_resolve_embeds.assert_not_called()

    @pytest.mark.asyncio
    async def test_stores_retrieval_references_on_tracing_context(self):
        from agenta.sdk.contexts.tracing import TracingContext
        from agenta.sdk.middlewares.running.resolver import ResolverMiddleware
        from agenta.sdk.models.workflows import (
            WorkflowInvokeRequest,
            WorkflowRevisionData,
        )

        request = WorkflowInvokeRequest(
            credentials="test-creds",
            references={"environment": {"slug": "production"}},
        )
        retrieval_references = {
            "environment": {"id": "env-id", "slug": "production"},
            "environment_revision": {"id": "env-rev-id", "version": "7"},
            "application_revision": {"id": "app-rev-id", "version": "3"},
        }
        revision = WorkflowRevisionData(
            uri="test://uri",
            parameters={"model": "gpt-4"},
        )

        token = TracingContext.set(TracingContext())
        try:
            with (
                patch(
                    "agenta.sdk.middlewares.running.resolver.resolve_handler",
                    new_callable=AsyncMock,
                    return_value=MagicMock(),
                ),
                patch(
                    "agenta.sdk.middlewares.running.resolver."
                    "resolve_references_with_info",
                    new_callable=AsyncMock,
                    return_value=(revision, retrieval_references, None),
                ),
            ):
                mw = ResolverMiddleware()
                call_next = AsyncMock(return_value="result")
                await mw(request, call_next)

            assert TracingContext.get().references == retrieval_references
        finally:
            TracingContext.reset(token)

    @pytest.mark.asyncio
    async def test_stores_retrieval_selector_on_tracing_context(self):
        from agenta.sdk.contexts.tracing import TracingContext
        from agenta.sdk.middlewares.running.resolver import ResolverMiddleware
        from agenta.sdk.models.workflows import (
            WorkflowInvokeRequest,
            WorkflowRevisionData,
        )

        request = WorkflowInvokeRequest(
            credentials="test-creds",
            references={"environment": {"slug": "production"}},
        )
        retrieval_references = {
            "environment": {"id": "env-id", "slug": "production"},
            "application_revision": {"id": "app-rev-id", "version": "3"},
        }
        # The selector is the env slot that selected the target, as a dict.
        retrieval_selector = {"key": "demo.revision"}
        revision = WorkflowRevisionData(uri="test://uri", parameters={"model": "x"})

        token = TracingContext.set(TracingContext())
        try:
            with (
                patch(
                    "agenta.sdk.middlewares.running.resolver.resolve_handler",
                    new_callable=AsyncMock,
                    return_value=MagicMock(),
                ),
                patch(
                    "agenta.sdk.middlewares.running.resolver."
                    "resolve_references_with_info",
                    new_callable=AsyncMock,
                    return_value=(revision, retrieval_references, retrieval_selector),
                ),
            ):
                mw = ResolverMiddleware()
                call_next = AsyncMock(return_value="result")
                await mw(request, call_next)

            assert TracingContext.get().selector == {"key": "demo.revision"}
        finally:
            TracingContext.reset(token)

    @pytest.mark.asyncio
    async def test_direct_lookup_leaves_selector_unset(self):
        from agenta.sdk.contexts.tracing import TracingContext
        from agenta.sdk.middlewares.running.resolver import ResolverMiddleware
        from agenta.sdk.models.workflows import (
            WorkflowInvokeRequest,
            WorkflowRevisionData,
        )

        request = WorkflowInvokeRequest(
            credentials="test-creds",
            references={"application": {"slug": "my-app"}},
        )
        revision = WorkflowRevisionData(uri="test://uri", parameters={"model": "x"})

        token = TracingContext.set(TracingContext())
        try:
            with (
                patch(
                    "agenta.sdk.middlewares.running.resolver.resolve_handler",
                    new_callable=AsyncMock,
                    return_value=MagicMock(),
                ),
                patch(
                    "agenta.sdk.middlewares.running.resolver."
                    "resolve_references_with_info",
                    new_callable=AsyncMock,
                    return_value=(revision, {}, None),
                ),
            ):
                mw = ResolverMiddleware()
                call_next = AsyncMock(return_value="result")
                await mw(request, call_next)

            # Direct (non-environment-backed) retrieval has no selector.
            assert TracingContext.get().selector is None
        finally:
            TracingContext.reset(token)


class TestResolverMiddlewareTracingParameters:
    """Tests that ResolverMiddleware mirrors the resolved parameters onto
    TracingContext, so the root span records them under ag.meta.configuration.

    The middleware must populate TracingContext.parameters with whatever the
    handler will ultimately receive on request.data.parameters. That covers:
    - parameters supplied directly in the invoke payload
    - parameters fetched from a revision via data.revision or references
    - parameters after @ag.embed expansion
    """

    @pytest.mark.asyncio
    async def test_mirrors_parameters_supplied_in_request(self):
        """
        When the caller sends parameters in the invoke payload, those exact
        parameters must land on TracingContext.parameters.
        """
        from agenta.sdk.middlewares.running.resolver import ResolverMiddleware
        from agenta.sdk.models.workflows import (
            WorkflowInvokeRequest,
            WorkflowRequestData,
        )

        request_params = {"prompt": {"llm_config": {"model": "gpt-4o-mini"}}}

        request = WorkflowInvokeRequest(
            credentials="test-creds",
            flags={"resolve": True},
            data=WorkflowRequestData(
                parameters=request_params,
                revision={"data": {"uri": "test://uri"}},
            ),
        )

        with (
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_handler",
                new_callable=AsyncMock,
                return_value=MagicMock(),
            ),
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_embeds",
                new_callable=AsyncMock,
            ),
            tracing_context_manager(TracingContext()),
        ):
            mw = ResolverMiddleware()
            call_next = AsyncMock(return_value="result")
            await mw(request, call_next)

            assert TracingContext.get().parameters == request_params

    @pytest.mark.asyncio
    async def test_mirrors_parameters_fetched_from_revision(self):
        """
        When the caller sends no parameters but the revision carries them,
        the revision's parameters must land on TracingContext.parameters.
        """
        from agenta.sdk.middlewares.running.resolver import ResolverMiddleware
        from agenta.sdk.models.workflows import (
            WorkflowInvokeRequest,
            WorkflowRequestData,
        )

        revision_params = {"model": "gpt-4", "temperature": 0.7}

        request = WorkflowInvokeRequest(
            credentials="test-creds",
            flags={"resolve": True},
            data=WorkflowRequestData(
                revision={
                    "data": {
                        "uri": "test://uri",
                        "parameters": revision_params,
                    }
                }
            ),
        )

        with (
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_handler",
                new_callable=AsyncMock,
                return_value=MagicMock(),
            ),
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_embeds",
                new_callable=AsyncMock,
            ),
            tracing_context_manager(TracingContext()),
        ):
            mw = ResolverMiddleware()
            call_next = AsyncMock(return_value="result")
            await mw(request, call_next)

            assert TracingContext.get().parameters == revision_params

    @pytest.mark.asyncio
    async def test_mirrors_parameters_fetched_via_reference_hydration(self):
        """
        When the caller sends references but no data.revision and no
        data.parameters, the middleware must call resolve_references, hydrate
        the revision, and mirror the hydrated parameters onto TracingContext.

        This is the regression path the fix specifically calls out: the other
        tests seed data.revision directly and so bypass reference hydration.
        """
        from agenta.sdk.middlewares.running.resolver import ResolverMiddleware
        from agenta.sdk.models.workflows import (
            WorkflowInvokeRequest,
            WorkflowRequestData,
            WorkflowRevisionData,
        )

        hydrated_params = {"model": "gpt-4o-mini", "temperature": 0.2}

        request = WorkflowInvokeRequest(
            credentials="test-creds",
            flags={"resolve": True},
            references={
                "application": {"slug": "my-app"},
                "application_variant": {"slug": "my-app.default"},
            },
            data=WorkflowRequestData(),
        )

        hydrated_revision = WorkflowRevisionData(
            uri="test://uri",
            parameters=hydrated_params,
        )

        with (
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_references_with_info",
                new_callable=AsyncMock,
                return_value=(hydrated_revision, {}, None),
            ) as mock_resolve_references,
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_handler",
                new_callable=AsyncMock,
                return_value=MagicMock(),
            ),
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_embeds",
                new_callable=AsyncMock,
            ),
            tracing_context_manager(TracingContext()),
        ):
            mw = ResolverMiddleware()
            call_next = AsyncMock(return_value="result")
            await mw(request, call_next)

            mock_resolve_references.assert_called_once()
            assert TracingContext.get().parameters == hydrated_params

    @pytest.mark.asyncio
    async def test_mirrors_parameters_after_embed_expansion(self):
        """
        When the revision parameters contain @ag.embed markers and resolve is
        enabled, the post-expansion parameters (not the pre-expansion ones)
        must land on TracingContext.parameters.
        """
        from agenta.sdk.middlewares.running.resolver import ResolverMiddleware
        from agenta.sdk.models.workflows import (
            WorkflowInvokeRequest,
            WorkflowRequestData,
        )

        params_with_embed = {
            "prompt": {
                "@ag.embed": {
                    "@ag.references": {"workflow_revision": {"slug": "base"}},
                }
            }
        }
        resolved_params = {"prompt": {"messages": [{"role": "system"}]}}

        request = WorkflowInvokeRequest(
            credentials="test-creds",
            flags={"resolve": True},
            data=WorkflowRequestData(
                revision={
                    "data": {
                        "uri": "test://uri",
                        "parameters": params_with_embed,
                    }
                }
            ),
        )

        with (
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_handler",
                new_callable=AsyncMock,
                return_value=MagicMock(),
            ),
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_embeds",
                new_callable=AsyncMock,
                return_value=resolved_params,
            ),
            tracing_context_manager(TracingContext()),
        ):
            mw = ResolverMiddleware()
            call_next = AsyncMock(return_value="result")
            await mw(request, call_next)

            assert TracingContext.get().parameters == resolved_params
