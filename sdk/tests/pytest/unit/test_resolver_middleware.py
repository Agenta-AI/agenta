"""
Unit tests for the ResolverMiddleware and related helpers.

Tests cover:
- _has_embed_markers() detection of @ag.embed in various config structures
- ResolverMiddleware skipping resolve_embeds() when no markers present
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

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
                "system_prompt": "You are helpful.",
                "temperature": 0.7,
                "model": "gpt-4",
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
            WorkflowServiceRequest,
            WorkflowServiceConfiguration,
        )

        request = MagicMock(spec=WorkflowServiceRequest)
        request.flags = {"resolve": True}
        request.credentials = "test-creds"
        request.interface = None
        request.configuration = WorkflowServiceConfiguration(
            parameters={"model": "gpt-4", "temperature": 0.7}
        )
        request.data = None

        with (
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_interface",
                new_callable=AsyncMock,
                return_value=MagicMock(uri="test://uri"),
            ),
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_configuration",
                new_callable=AsyncMock,
                return_value=request.configuration,
            ),
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
            WorkflowServiceRequest,
            WorkflowServiceConfiguration,
        )

        params_with_embed = {
            "prompt": {
                "@ag.embed": {
                    "@ag.references": {"workflow_revision": {"slug": "base"}},
                }
            }
        }

        request = MagicMock(spec=WorkflowServiceRequest)
        request.flags = {"resolve": True}
        request.credentials = "test-creds"
        request.interface = None
        request.configuration = WorkflowServiceConfiguration(
            parameters=params_with_embed
        )
        request.data = None

        resolved_params = {"prompt": "resolved-value"}

        with (
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_interface",
                new_callable=AsyncMock,
                return_value=MagicMock(uri="test://uri"),
            ),
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_configuration",
                new_callable=AsyncMock,
                return_value=request.configuration,
            ),
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
            await mw(request, call_next)

        mock_resolve_embeds.assert_called_once_with(
            configuration=params_with_embed,
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
            WorkflowServiceRequest,
            WorkflowServiceConfiguration,
        )

        params_with_embed = {
            "prompt": {"@ag.embed": {"@ag.references": {"workflow_revision": {}}}}
        }

        request = MagicMock(spec=WorkflowServiceRequest)
        request.flags = {"resolve": False}
        request.credentials = "test-creds"
        request.interface = None
        request.configuration = WorkflowServiceConfiguration(
            parameters=params_with_embed
        )
        request.data = None

        with (
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_interface",
                new_callable=AsyncMock,
                return_value=MagicMock(uri="test://uri"),
            ),
            patch(
                "agenta.sdk.middlewares.running.resolver.resolve_configuration",
                new_callable=AsyncMock,
                return_value=request.configuration,
            ),
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
            await mw(request, call_next)

        mock_resolve_embeds.assert_not_called()
