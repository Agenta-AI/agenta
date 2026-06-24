"""The ``/invoke`` handler (`_agent`) end-to-end in-process.

Runs the real parse -> resolve -> harness -> record path with a ``FakeBackend`` and the
network-touching helpers stubbed. No runner, no LLM, no HTTP. This is where the cross-harness
"byte-identical response body" guarantee is locked at the Python layer.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents import (
    AgentConfig,
    AgentResult,
    GatewayToolResolutionError,
    ResolvedToolSet,
)

from oss.src.agent import app


def _patch_handler(monkeypatch, backend, *, builtins=(), tool_callback=None):
    """Stub the network-touching helpers and pin one ``backend`` for the run.

    ``builtins`` are the resolved built-in tool names ``resolve_tools`` hands back, so a turn
    can carry a real tool list and the per-harness translation has something to diverge on.
    Returns the ``recorded`` dict the usage hook writes into.
    """
    recorded = {}

    async def _tools(tools, **_kw):
        return ResolvedToolSet(
            builtin_names=list(builtins),
            tool_callback=tool_callback,
        )

    async def _no_mcp(mcp_servers, **_kw):
        return []

    async def _no_secrets():
        return {}

    monkeypatch.setattr(app, "resolve_tools", _tools)
    monkeypatch.setattr(app, "resolve_mcp_servers", _no_mcp)
    monkeypatch.setattr(app, "resolve_secrets", _no_secrets)
    monkeypatch.setattr(app, "trace_context", lambda: None)
    monkeypatch.setattr(
        app, "record_usage", lambda usage: recorded.__setitem__("usage", usage)
    )
    monkeypatch.setattr(app, "select_backend", lambda selection: backend)
    monkeypatch.setattr(
        app, "_default_agent_config", lambda: AgentConfig(instructions="x", model="m")
    )
    return recorded


@pytest.fixture
def patched(monkeypatch, fake_backend):
    backend = fake_backend(result=AgentResult(output="echo", usage={"total": 15}))
    recorded = _patch_handler(monkeypatch, backend)
    return backend, recorded


async def _invoke(harness="pi", **agent):
    return await app._agent(
        messages=[{"role": "user", "content": "hi"}],
        parameters={"agent": {"harness": harness, **agent}},
    )


async def test_invoke_returns_assistant_message(patched):
    assert await _invoke("pi") == {"role": "assistant", "content": "echo"}


async def test_invoke_records_usage(patched):
    _, recorded = patched
    await _invoke("pi")
    assert recorded["usage"] == {"total": 15}


async def test_invoke_runs_backend_lifecycle(patched):
    backend, _ = patched
    await _invoke("pi")
    assert backend.setup_calls == 1
    assert backend.shutdown_calls == 1  # cleanup() tears the backend down


async def test_messages_session_id_reaches_session_config(patched):
    backend, _ = patched

    await app._agent(
        messages=[{"role": "user", "content": "hi"}],
        parameters={"agent": {"harness": "pi"}},
        session_id="sess_request",
    )

    assert backend.created_session_ids == ["sess_request"]


async def test_invoke_cross_harness_same_body_divergent_configs(
    monkeypatch, fake_backend
):
    """The real cross-harness guarantee, exercised through the handler — not stubbed.

    The earlier version of this test pinned a single echoing backend and asserted
    ``pi == agenta == claude`` on the echoed constant. That passes no matter how badly the
    per-harness translation diverges, because the translation never ran. Here the same turn
    runs as pi / agenta / claude against a backend that records the *harness-shaped* config it
    receives, so we can assert two distinct things:

      1. the response body is byte-identical across the three harnesses (the response-layer
         guarantee), and
      2. the config that reached the backend boundary diverged exactly as designed — proving
         the handler actually drove ``PiHarness`` / ``ClaudeHarness`` / ``AgentaHarness``,
         each producing its own config.

    The turn carries a built-in tool (``web_search``), a ``deny`` policy, and one author skill
    so the divergence is observable: Claude drops Pi built-ins and honors the policy; Pi keeps
    them and forces ``auto``; Agenta unions the forced tools. The skill rides the neutral config,
    so every skill-loading harness emits it on its own ``wire_skills`` seam (never in the tool
    wire); there is no forced skill-name list anymore.
    """
    backend = fake_backend(result=AgentResult(output="echo", usage={"total": 15}))
    _patch_handler(monkeypatch, backend, builtins=["web_search"])

    skill = {
        "name": "release-notes",
        "description": "Draft release notes.",
        "body": "Read the changelog, then write notes.",
    }
    bodies = [
        await _invoke(harness, permission_policy="deny", skills=[skill])
        for harness in ("pi", "agenta", "claude")
    ]
    pi_body, agenta_body, claude_body = bodies

    # (1) Response-layer guarantee: identical body regardless of harness.
    assert (
        pi_body
        == agenta_body
        == claude_body
        == {
            "role": "assistant",
            "content": "echo",
        }
    )

    # (2) The three harness-shaped configs that reached the backend boundary, in call order.
    assert len(backend.created_configs) == 3
    pi_cfg, agenta_cfg, claude_cfg = backend.created_configs
    pi_wire = pi_cfg.wire_tools()
    agenta_wire = agenta_cfg.wire_tools()
    claude_wire = claude_cfg.wire_tools()

    # Pi keeps its built-in tool natively and never gates tool use (policy forced to auto,
    # the author's `deny` notwithstanding). Skills never ride the tool wire.
    assert pi_wire["tools"] == ["web_search"]
    assert pi_wire["permissionPolicy"] == "auto"
    assert "skills" not in pi_wire

    # Claude has no Pi built-ins (the `web_search` name is dropped) and honors the policy.
    assert claude_wire["tools"] == []
    assert claude_wire["permissionPolicy"] == "deny"
    assert "skills" not in claude_wire

    # Agenta is Pi-with-an-opinion: it unions the forced tools onto the author's set and forces
    # auto like Pi. Skills are not tools, so they never appear in the tool wire.
    assert agenta_wire["tools"] == ["web_search", "read", "bash"]
    assert agenta_wire["permissionPolicy"] == "auto"
    assert "skills" not in agenta_wire

    # Skills ride the dedicated `wire_skills` seam. Pi and Agenta load them; Claude's SDK path
    # cannot, so it logs-and-drops (graceful degrade), emitting no skills.
    assert pi_cfg.wire_skills()["skills"][0]["name"] == "release-notes"
    assert agenta_cfg.wire_skills()["skills"][0]["name"] == "release-notes"
    assert claude_cfg.wire_skills() == {}

    # The configs genuinely differ at the boundary; the body's sameness is not a tautology.
    assert pi_wire != claude_wire
    assert agenta_wire != pi_wire


async def test_stream_tool_resolution_failure_is_raised_before_backend_setup(
    monkeypatch,
):
    async def _failure(tools, **_kw):
        raise GatewayToolResolutionError("gateway unavailable")

    monkeypatch.setattr(app, "resolve_tools", _failure)
    monkeypatch.setattr(
        app,
        "_default_agent_config",
        lambda: AgentConfig(
            tools=[
                {
                    "type": "gateway",
                    "integration": "github",
                    "action": "GET_USER",
                    "connection": "c1",
                }
            ]
        ),
    )
    monkeypatch.setattr(
        app,
        "select_backend",
        lambda _selection: (_ for _ in ()).throw(
            AssertionError("backend must not be selected")
        ),
    )

    with pytest.raises(GatewayToolResolutionError, match="gateway unavailable"):
        await app._agent(
            messages=[{"role": "user", "content": "hi"}],
            parameters={"agent": {"harness": "pi"}},
            stream=True,
        )
