"""End-to-end SDK skill coverage: an `AgentConfig`'s skills land on the `/run` wire as
concrete inline packages, whether they were authored inline or pulled in via an `@ag.embed`.

These lock the two author shapes the skills feature ships:

1. **Inline skill -> wire.** An `AgentConfig` carrying an inline `SkillConfig` produces a runner
   request whose `skills[0]` is the materialized inline package (name/description/body/files +
   camelCase flags), via the `wire_skills()` seam that `request_to_wire` spreads.

2. **Embed skill -> resolve -> wire.** An `AgentConfig` whose `skills` list holds an `@ag.embed`
   entry, run through the resolution middleware against a MOCKED resolve endpoint that returns a
   `SkillConfig`-shaped `parameters.skill`, ends up on the wire as a concrete inline package (the
   embed is gone). This mirrors how the resolver tests mock `/workflows/revisions/resolve`, then
   carries the resolved params the rest of the way: `from_params` -> harness -> `request_to_wire`.

No live LLM, no runner, no network: the resolve endpoint is mocked and the wire is built directly.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import agenta as ag
from agenta.sdk.agents import (
    AgentConfig,
    Environment,
    HarnessType,
    Message,
    PiHarness,
    SessionConfig,
)
from agenta.sdk.agents.skills import SkillConfig
from agenta.sdk.agents.utils import request_to_wire
from agenta.sdk.contexts.tracing import TracingContext, tracing_context_manager
from agenta.sdk.middlewares.running.resolver import ResolverMiddleware
from agenta.sdk.models.workflows import WorkflowInvokeRequest, WorkflowRequestData


_INLINE_SKILL = {
    "name": "release-notes",
    "description": "Draft release notes from a changelog.",
    "body": "Read the changelog, then write release notes.",
    "files": [
        {"path": "scripts/draft.py", "content": "print('draft')", "executable": True}
    ],
    "disable_model_invocation": True,
    "allow_executable_files": True,
}


def _pi_wire(env: Environment, agent: AgentConfig) -> dict:
    """Translate an `AgentConfig` through the Pi harness and serialize one turn to the wire."""
    harness = PiHarness(env)
    pi_config = harness._to_harness_config(SessionConfig(agent=agent))
    return request_to_wire(
        harness=HarnessType.PI,
        sandbox="local",
        config=pi_config,
        messages=[Message(role="user", content="ship it")],
    )


# --------------------------------------------------------------------------- inline -> wire


def test_inline_skill_materializes_on_the_wire(make_env):
    env = make_env(supported=[HarnessType.PI])
    agent = AgentConfig(instructions="hi", model="gpt-5.5", skills=[_INLINE_SKILL])

    wire = _pi_wire(env, agent)

    # The whole inline package rides the `skills` field (its own seam, not `tools`).
    assert wire["skills"] == [
        {
            "name": "release-notes",
            "description": "Draft release notes from a changelog.",
            "body": "Read the changelog, then write release notes.",
            "files": [
                {
                    "path": "scripts/draft.py",
                    "content": "print('draft')",
                    "executable": True,
                }
            ],
            # Optional flags ride the wire in camelCase.
            "disableModelInvocation": True,
            "allowExecutableFiles": True,
        }
    ]


def test_minimal_inline_skill_omits_optional_flags_on_the_wire(make_env):
    env = make_env(supported=[HarnessType.PI])
    agent = AgentConfig(
        instructions="hi",
        model="gpt-5.5",
        skills=[SkillConfig(name="a", description="d", body="b")],
    )

    wire = _pi_wire(env, agent)

    assert wire["skills"] == [{"name": "a", "description": "d", "body": "b"}]
    # A minimal skill stays minimal: no optional keys leak onto the wire.
    only = wire["skills"][0]
    assert "files" not in only
    assert "disableModelInvocation" not in only
    assert "allowExecutableFiles" not in only


# ------------------------------------------------------ embed -> resolve -> wire


@pytest.mark.asyncio
async def test_embed_skill_resolves_to_a_concrete_package_on_the_wire(make_env):
    # The author config references a skill by an `@ag.embed` inside the skills list (the platform default-config shape). The resolver inlines the stored `SkillConfig` BEFORE the handler
    # builds the AgentConfig, so the runner must never see the embed -- only a concrete package.
    params_with_embed = {
        "skills": [
            {
                "@ag.embed": {
                    "@ag.references": {
                        "workflow": {"slug": "__ag__getting_started_with_agenta"}
                    },
                    "@ag.selector": {"path": "parameters.skill"},
                }
            }
        ]
    }
    resolved_params = {
        "skills": [
            {
                "name": "agenta-getting-started",
                "description": "Get started with Agenta.",
                "body": "Welcome. Here is how to begin.",
            }
        ]
    }

    request = WorkflowInvokeRequest(
        credentials="test-creds",
        flags={"resolve": True},
        data=WorkflowRequestData(parameters=params_with_embed),
    )

    # Mock the /workflows/revisions/resolve endpoint the resolver actually calls, so the real
    # resolver code runs (detect embed -> resolve -> inline). Same seam the resolver tests use.
    endpoint_response = MagicMock()
    endpoint_response.raise_for_status = MagicMock()
    endpoint_response.json = MagicMock(
        return_value={"workflow_revision": {"data": {"parameters": resolved_params}}}
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

    # The resolver hit the resolve endpoint and inlined the embed into the request params.
    post_mock.assert_awaited_once()
    assert request.data.parameters == resolved_params

    # Now carry the resolved params the rest of the way, exactly as the handler does: build the
    # AgentConfig from them, translate through the harness, and serialize the wire.
    env = make_env(supported=[HarnessType.PI])
    agent = AgentConfig.from_params(request.data.parameters)
    wire = _pi_wire(env, agent)

    # The embed is gone; a concrete inline package rides the wire.
    assert wire["skills"] == [
        {
            "name": "agenta-getting-started",
            "description": "Get started with Agenta.",
            "body": "Welcome. Here is how to begin.",
        }
    ]
    assert "@ag.embed" not in str(wire["skills"])
