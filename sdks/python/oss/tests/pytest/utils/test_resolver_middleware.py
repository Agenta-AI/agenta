"""
Unit tests for the ResolverMiddleware and related helpers.

Tests cover:
- _has_embed_markers() detection of @ag.embed in various config structures
- ResolverMiddleware skipping resolve_embeds() when no markers present
- ResolverMiddleware mirroring resolved parameters onto TracingContext
"""

import pytest
import agenta as ag
from unittest.mock import AsyncMock, MagicMock, patch

from agenta.sdk.contexts.tracing import TracingContext, tracing_context_manager
from agenta.sdk.middlewares.running.resolver import (
    _has_embed_markers,
    _validate_executable_reference_families,
    resolve_references_with_info,
)


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
    async def test_resolves_embeds_in_inline_parameters(self):
        """
        When the caller runs an UNSAVED config (parameters inline on
        request.data.parameters, no data.revision), embeds in those inline
        parameters must still resolve. This is the playground path the old
        middleware skipped, because resolution was attached only to the
        revision object. It is the regression the skills-config fix targets:
        an @ag.embed inside `parameters.skills[i]` resolves on this path too.
        """
        from agenta.sdk.middlewares.running.resolver import ResolverMiddleware
        from agenta.sdk.models.workflows import (
            WorkflowInvokeRequest,
            WorkflowRequestData,
        )

        params_with_embed = {
            "skills": [
                {
                    "@ag.embed": {
                        "@ag.references": {"workflow_revision": {"slug": "my-skill"}},
                        "@ag.selector": {"path": "parameters.skill"},
                    }
                }
            ]
        }
        resolved_params = {
            "skills": [
                {
                    "name": "my-skill",
                    "description": "A resolved skill.",
                    "body": "Do the thing.",
                }
            ]
        }

        request = WorkflowInvokeRequest(
            credentials="test-creds",
            flags={"resolve": True},
            data=WorkflowRequestData(parameters=params_with_embed),
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
            ) as mock_resolve_embeds,
            tracing_context_manager(TracingContext()),
        ):
            mw = ResolverMiddleware()
            call_next = AsyncMock(return_value="result")
            await mw(request, call_next)

        # Resolution ran on the inline parameters (no revision involved)...
        mock_resolve_embeds.assert_called_once_with(
            parameters=params_with_embed,
            credentials="test-creds",
        )
        # ...and the resolved parameters are written back so the handler sees concrete skills.
        assert request.data.parameters == resolved_params

    @pytest.mark.asyncio
    async def test_inline_embed_resolves_end_to_end_via_mocked_endpoint(self):
        """
        Prove a REAL no-revision request resolves embeds end-to-end. Instead of patching the
        `resolve_embeds` SDK helper, this mocks the `/workflows/revisions/resolve` HTTP endpoint
        it calls, so the actual resolver code runs: the middleware detects the inline `@ag.embed`
        in `parameters.skills[0]`, calls `resolve_embeds`, and inlines the returned skill package.

        This is the playground path (parameters inline on `request.data.parameters`, no
        `data.revision`) that the old middleware skipped.
        """
        from agenta.sdk.middlewares.running.resolver import ResolverMiddleware
        from agenta.sdk.models.workflows import (
            WorkflowInvokeRequest,
            WorkflowRequestData,
        )

        params_with_embed = {
            "skills": [
                {
                    "@ag.embed": {
                        "@ag.references": {"workflow_revision": {"slug": "my-skill"}},
                        "@ag.selector": {"path": "parameters.skill"},
                    }
                }
            ]
        }
        resolved_params = {
            "skills": [
                {
                    "name": "my-skill",
                    "description": "A resolved skill.",
                    "body": "Do the thing.",
                }
            ]
        }

        request = WorkflowInvokeRequest(
            credentials="test-creds",
            flags={"resolve": True},
            data=WorkflowRequestData(parameters=params_with_embed),
        )

        # The /workflows/revisions/resolve endpoint returns the inlined parameters under
        # workflow_revision.data.parameters (the shape `resolve_embeds` unwraps).
        endpoint_response = MagicMock()
        endpoint_response.raise_for_status = MagicMock()
        endpoint_response.json = MagicMock(
            return_value={
                "workflow_revision": {"data": {"parameters": resolved_params}}
            }
        )

        post_mock = AsyncMock(return_value=endpoint_response)

        class _FakeAsyncClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def post(self, *args, **kwargs):
                return await post_mock(*args, **kwargs)

        fake_async_api = MagicMock()
        fake_async_api._client_wrapper._base_url = "http://api.test"

        with (
            patch.object(ag, "async_api", fake_async_api),
            patch(
                "agenta.sdk.middlewares.running.resolver.httpx.AsyncClient",
                return_value=_FakeAsyncClient(),
            ),
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_handler",
                new_callable=AsyncMock,
                return_value=MagicMock(),
            ),
            tracing_context_manager(TracingContext()),
        ):
            mw = ResolverMiddleware()
            call_next = AsyncMock(return_value="result")
            await mw(request, call_next)

        # The real resolver hit the resolve endpoint once...
        post_mock.assert_awaited_once()
        url = post_mock.await_args.args[0]
        assert url.endswith("/workflows/revisions/resolve")
        # ...and the embed was inlined into a concrete skill package on the inline params.
        assert request.data.parameters == resolved_params
        assert request.data.parameters["skills"][0]["name"] == "my-skill"

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


class _FakeAsyncClient:
    """Queues canned responses for successive `httpx.AsyncClient().post()` calls."""

    def __init__(self, post_mock):
        self._post_mock = post_mock

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, *args, **kwargs):
        return await self._post_mock(*args, **kwargs)


def _json_response(payload):
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json = MagicMock(return_value=payload)
    return response


class TestArchivedReferenceGuard:
    """resolve_references_with_info must never resolve an archived workflow,
    application, evaluator, or revision into a live invoke."""

    @pytest.mark.asyncio
    async def test_sends_include_archived_false_on_the_primary_retrieve(self):
        from agenta.sdk.models.workflows import WorkflowInvokeRequest

        request = WorkflowInvokeRequest(references={"workflow": {"slug": "my-wf"}})
        post_mock = AsyncMock(return_value=_json_response({"workflow_revision": None}))
        fake_async_api = MagicMock()
        fake_async_api._client_wrapper._base_url = "http://api.test"

        with (
            patch.object(ag, "async_api", fake_async_api),
            patch(
                "agenta.sdk.middlewares.running.resolver.httpx.AsyncClient",
                return_value=_FakeAsyncClient(post_mock),
            ),
        ):
            result = await resolve_references_with_info(
                request=request, credentials="test-creds"
            )

        assert result == (None, None, None)
        # Primary retrieve, then the archived probe: both miss, no fallback for a bare workflow ref.
        assert post_mock.await_count == 2
        assert post_mock.await_args_list[0].kwargs["json"]["include_archived"] is False
        assert post_mock.await_args_list[1].kwargs["json"]["include_archived"] is True

    @pytest.mark.asyncio
    async def test_raises_archived_error_when_only_the_probe_finds_it(self):
        from agenta.sdk.models.workflows import WorkflowInvokeRequest
        from agenta.sdk.engines.running.errors import ArchivedReferenceV0Error

        request = WorkflowInvokeRequest(references={"workflow": {"slug": "my-wf"}})
        post_mock = AsyncMock(
            side_effect=[
                _json_response({"workflow_revision": None}),
                _json_response({"workflow_revision": {"data": {"uri": "test://uri"}}}),
            ]
        )
        fake_async_api = MagicMock()
        fake_async_api._client_wrapper._base_url = "http://api.test"

        with (
            patch.object(ag, "async_api", fake_async_api),
            patch(
                "agenta.sdk.middlewares.running.resolver.httpx.AsyncClient",
                return_value=_FakeAsyncClient(post_mock),
            ),
        ):
            with pytest.raises(ArchivedReferenceV0Error):
                await resolve_references_with_info(
                    request=request, credentials="test-creds"
                )

        assert post_mock.await_count == 2

    @pytest.mark.asyncio
    async def test_genuine_miss_returns_none_without_raising(self):
        from agenta.sdk.models.workflows import WorkflowInvokeRequest

        request = WorkflowInvokeRequest(
            references={"workflow": {"slug": "does-not-exist"}}
        )
        post_mock = AsyncMock(return_value=_json_response({"workflow_revision": None}))
        fake_async_api = MagicMock()
        fake_async_api._client_wrapper._base_url = "http://api.test"

        with (
            patch.object(ag, "async_api", fake_async_api),
            patch(
                "agenta.sdk.middlewares.running.resolver.httpx.AsyncClient",
                return_value=_FakeAsyncClient(post_mock),
            ),
        ):
            result = await resolve_references_with_info(
                request=request, credentials="test-creds"
            )

        # Both the direct retrieve and the archived probe missed: a genuine not-found,
        # not an archived hit, so no exception.
        assert result == (None, None, None)

    @pytest.mark.asyncio
    async def test_application_retrieve_and_its_workflow_fallback_both_exclude_archived(
        self,
    ):
        from agenta.sdk.models.workflows import WorkflowInvokeRequest

        request = WorkflowInvokeRequest(references={"application": {"slug": "my-app"}})
        post_mock = AsyncMock(
            side_effect=[
                _json_response({"application_revision": None}),
                _json_response({"workflow_revision": None}),
                _json_response({"application_revision": None}),
            ]
        )
        fake_async_api = MagicMock()
        fake_async_api._client_wrapper._base_url = "http://api.test"

        with (
            patch.object(ag, "async_api", fake_async_api),
            patch(
                "agenta.sdk.middlewares.running.resolver.httpx.AsyncClient",
                return_value=_FakeAsyncClient(post_mock),
            ),
        ):
            result = await resolve_references_with_info(
                request=request, credentials="test-creds"
            )

        assert result == (None, None, None)
        # Primary /applications retrieve, its /workflows compatibility fallback, then the probe.
        assert post_mock.await_count == 3
        primary_body, fallback_body, probe_body = (
            call.kwargs["json"] for call in post_mock.await_args_list
        )
        assert primary_body["include_archived"] is False
        assert fallback_body["include_archived"] is False
        assert probe_body["include_archived"] is True


class TestResolverMiddlewareHydrationIntent:
    """Tests for WHEN reference hydration fires.

    A service process pre-seeds `RunningContext.revision` with the decorator's REGISTERED
    DEFAULT configuration, so `resolve_revision` always returns a fully-configured
    revision. Hydration intent must therefore be read off the CALLER's request only:
    references + no inline `data.parameters` + no `data.revision` means hydrate.
    Reading it off the resolved revision made every references-only invoke (the mobile
    resume shape) silently run the service default instead of the referenced revision.
    """

    # The registered default the decorator pre-seeds onto RunningContext.revision.
    DEFAULT_REVISION = {
        "data": {
            "uri": "test://uri",
            "parameters": {"model": "registered-default-model"},
        }
    }

    @staticmethod
    def _running_ctx_with_default():
        from agenta.sdk.contexts.running import RunningContext

        return RunningContext(
            credentials="test-creds",
            revision=TestResolverMiddlewareHydrationIntent.DEFAULT_REVISION,
        )

    async def _run(self, request, *, hydrated=None):
        """Run the middleware with a decorator-seeded RunningContext.

        `hydrated` is what `resolve_references_with_info` returns as the revision;
        None models a hydration failure (the resolver swallows API errors).
        """
        from agenta.sdk.contexts.running import running_context_manager
        from agenta.sdk.middlewares.running.resolver import ResolverMiddleware

        with (
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_references_with_info",
                new_callable=AsyncMock,
                return_value=(hydrated, {}, None),
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
            running_context_manager(self._running_ctx_with_default()),
            tracing_context_manager(TracingContext()),
        ):
            await ResolverMiddleware()(request, AsyncMock(return_value="result"))
            return mock_resolve_references

    @pytest.mark.asyncio
    async def test_references_only_hydrates_over_registered_default(self):
        """
        The mobile resume shape: references, no data.parameters, no data.revision.
        Hydration MUST fire and the referenced revision's config MUST win over the
        registered default sitting on RunningContext.
        """
        from agenta.sdk.models.workflows import (
            WorkflowInvokeRequest,
            WorkflowRequestData,
            WorkflowRevisionData,
        )

        request = WorkflowInvokeRequest(
            credentials="test-creds",
            references={
                "workflow": {"slug": "my-agent"},
                "workflow_revision": {"id": "019faa90-c0b6-7310-9ab1-a31268c2163e"},
            },
            data=WorkflowRequestData(inputs={"messages": []}),
        )
        referenced_params = {"model": "anthropic/claude-haiku-4-5"}

        mock_resolve_references = await self._run(
            request,
            hydrated=WorkflowRevisionData(
                uri="test://uri",
                parameters=referenced_params,
            ),
        )

        mock_resolve_references.assert_called_once()
        assert request.data.parameters == referenced_params

    @pytest.mark.asyncio
    async def test_inline_parameters_skip_hydration(self):
        """Desktop parity: an inline config is caller intent, so references are not
        hydrated and the inline parameters drive the run untouched."""
        from agenta.sdk.models.workflows import (
            WorkflowInvokeRequest,
            WorkflowRequestData,
        )

        inline_params = {"model": "caller-supplied-model"}
        request = WorkflowInvokeRequest(
            credentials="test-creds",
            references={"workflow": {"slug": "my-agent"}},
            data=WorkflowRequestData(parameters=inline_params),
        )

        mock_resolve_references = await self._run(request)

        mock_resolve_references.assert_not_called()
        assert request.data.parameters == inline_params

    @pytest.mark.asyncio
    async def test_data_revision_skips_hydration(self):
        """A caller-supplied `data.revision` is a materialised config: no hydration."""
        from agenta.sdk.models.workflows import (
            WorkflowInvokeRequest,
            WorkflowRequestData,
        )

        revision_params = {"model": "caller-supplied-revision-model"}
        request = WorkflowInvokeRequest(
            credentials="test-creds",
            references={"workflow": {"slug": "my-agent"}},
            data=WorkflowRequestData(
                revision={"data": {"uri": "test://uri", "parameters": revision_params}},
            ),
        )

        mock_resolve_references = await self._run(request)

        mock_resolve_references.assert_not_called()
        assert request.data.parameters == revision_params

    @pytest.mark.asyncio
    async def test_hydration_failure_falls_back_to_registered_default(self):
        """
        When hydration is attempted but yields nothing (API error — the resolver
        swallows it and returns None), the run must not crash: it falls back to the
        revision already on the context, seeded with the registered default config.
        """
        from agenta.sdk.models.workflows import (
            WorkflowInvokeRequest,
            WorkflowRequestData,
        )

        request = WorkflowInvokeRequest(
            credentials="test-creds",
            references={"workflow": {"slug": "my-agent"}},
            data=WorkflowRequestData(inputs={"messages": []}),
        )

        mock_resolve_references = await self._run(request, hydrated=None)

        mock_resolve_references.assert_called_once()
        assert request.data.parameters == self.DEFAULT_REVISION["data"]["parameters"]

    @pytest.mark.asyncio
    async def test_no_references_never_hydrates(self):
        """No references at all: nothing to hydrate from, registered default applies."""
        from agenta.sdk.models.workflows import (
            WorkflowInvokeRequest,
            WorkflowRequestData,
        )

        request = WorkflowInvokeRequest(
            credentials="test-creds",
            data=WorkflowRequestData(inputs={"messages": []}),
        )

        mock_resolve_references = await self._run(request)

        mock_resolve_references.assert_not_called()
        assert request.data.parameters == self.DEFAULT_REVISION["data"]["parameters"]


class TestCallerSuppliedConfiguration:
    """Unit tests for the caller-intent predicate behind hydration."""

    @staticmethod
    def _request(**data_kwargs):
        from agenta.sdk.models.workflows import (
            WorkflowInvokeRequest,
            WorkflowRequestData,
        )

        return WorkflowInvokeRequest(
            data=WorkflowRequestData(**data_kwargs) if data_kwargs else None,
        )

    def test_no_data_is_not_caller_supplied(self):
        from agenta.sdk.middlewares.running.resolver import (
            _caller_supplied_configuration,
        )

        assert _caller_supplied_configuration(self._request()) is False

    def test_inputs_only_is_not_caller_supplied(self):
        from agenta.sdk.middlewares.running.resolver import (
            _caller_supplied_configuration,
        )

        request = self._request(inputs={"messages": []})
        assert _caller_supplied_configuration(request) is False

    def test_empty_parameters_are_not_caller_supplied(self):
        from agenta.sdk.middlewares.running.resolver import (
            _caller_supplied_configuration,
        )

        assert _caller_supplied_configuration(self._request(parameters={})) is False

    def test_parameters_are_caller_supplied(self):
        from agenta.sdk.middlewares.running.resolver import (
            _caller_supplied_configuration,
        )

        request = self._request(parameters={"model": "gpt-4"})
        assert _caller_supplied_configuration(request) is True

    def test_revision_is_caller_supplied(self):
        from agenta.sdk.middlewares.running.resolver import (
            _caller_supplied_configuration,
        )

        request = self._request(revision={"data": {"uri": "test://uri"}})
        assert _caller_supplied_configuration(request) is True


class TestResolverReferenceValidation:
    @pytest.mark.asyncio
    async def test_rejects_competing_application_and_evaluator_refs(self):
        from agenta.sdk.models.workflows import WorkflowInvokeRequest

        request = WorkflowInvokeRequest(
            references={
                "application": {"slug": "my-app"},
                "evaluator": {"slug": "my-eval"},
            },
        )

        with pytest.raises(ValueError, match="Competing execution target references"):
            await resolve_references_with_info(
                request=request,
                credentials="test-creds",
            )

    @pytest.mark.asyncio
    async def test_ignores_empty_reference_objects(self):
        from agenta.sdk.models.workflows import WorkflowInvokeRequest

        request = WorkflowInvokeRequest(
            references={
                "application": {},
                "evaluator": {"slug": "my-eval"},
            },
        )

        with patch.object(ag, "async_api", None):
            assert await resolve_references_with_info(
                request=request,
                credentials="test-creds",
            ) == (None, None, None)

    def test_ignores_none_reference_values(self):
        _validate_executable_reference_families(
            {
                "application": None,
                "evaluator": {"slug": "my-eval"},
            },
        )


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
