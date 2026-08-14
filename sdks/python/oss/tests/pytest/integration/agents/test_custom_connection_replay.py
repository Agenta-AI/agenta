"""Replay the custom OpenAI-compatible connection cell through the real SDK + service path.

The agent-workflows QA matrix cell ``e2-pi-custom-openai-compatible`` is green: a real vault
``custom_provider`` connection (``data.kind == custom``) pointed at an OpenAI-compatible gateway
(OpenRouter) was resolved by the service and run through Pi, and the assistant returned the
forced token. This pins that cell so it stays green with no live LLM and no live vault.

Two halves of the same recorded run are asserted, both against the SAME real code path the
service uses:

1. The REQUEST-shaping half. The service resolves the author's ``{mode: agenta, slug}``
   connection against the vault (here the recorded, redacted ``custom_provider`` secret, fed
   through the real ``_StaticSecretsResolver`` / ``_default_resolve_session_connection`` — the
   offline stand-in for the live ``GET /secrets/`` fetch), threads the resulting
   ``ResolvedConnection`` onto the ``SessionConfig``, and ``request_to_wire`` spreads it onto the
   ``/run`` payload. The test drives that through the real subprocess transport and asserts the
   wire carries ``modelConnection`` with ``deployment=custom``, ``provider=openai``, the endpoint
   ``baseUrl``, and the provider key as a typed credential bound to ``OPENAI_API_KEY`` (value
   redacted), plus the author's ``connection`` and the exact resolved ``model`` at the top level.

2. The RESULT-parsing half. The recorded runner response replays back through
   ``result_from_wire`` / the transport, proving the SDK folds a real recorded custom-connection
   run into the expected ``AgentResult`` shape.

Provenance and redactions live in the fixture's own ``provenance`` block. See the
``agent-replay-test`` skill for the capture/redact/replay conventions.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from agenta.sdk.agents import (
    AgentTemplate,
    EndpointResolutionError,
    Environment,
    Message,
    ModelRef,
    PiHarness,
    RuntimeAuthContext,
    SessionConfig,
)
from agenta.sdk.agents.handler import (
    _agent_model_ref,
    _default_resolve_session_connection,
)
from agenta.sdk.agents.platform.connections import _StaticSecretsResolver

from ._fake_runner_backend import FakeRunnerBackend

pytestmark = [pytest.mark.integration, pytest.mark.cost_free]

REC = Path(__file__).parent / "recordings"


def _load(name: str) -> dict:
    """Load a recorded ``/run`` cell verbatim (never hand-copied into the test)."""
    return json.loads((REC / name).read_text(encoding="utf-8"))


def _template_from_recording(rec: dict) -> AgentTemplate:
    """Build today's :class:`AgentTemplate` from the recorded request, exactly as the service
    handler does (``AgentTemplate.from_params`` over ``parameters.agent``). The nested
    ``llm.connection`` is what makes ``model_ref`` structured, so the author's ``{mode, slug}``
    survives to the wire."""
    req = rec["request"]
    params = {
        "agent": {
            "instructions": {"agents_md": req["agents_md"]},
            "llm": {"model": req["model"], "connection": req["connection"]},
            "harness": {"kind": req["harness"]},
            "sandbox": {"kind": req["sandbox"]},
        }
    }
    return AgentTemplate.from_params(params)


_GATEWAY_BASE = "https://gateway.example.com"
_GATEWAY_CREDENTIALS = "Secret replay-token"


async def _resolve_connection(template: AgentTemplate, rec: dict):
    """Resolve the connection over the recorded (redacted) vault secret, through the same
    ``_default_resolve_session_connection`` the handler calls -- only the live ``GET /secrets/``
    fetch is swapped for a static list, which is the whole point of an offline replay. The
    gateway base URL and caller credentials stand in for what ``VaultConnectionResolver``
    would derive from the live ``PlatformConnection`` (WP12: the connected path routes
    through the gateway rather than injecting the vault's provider secret)."""
    model_ref = _agent_model_ref(template)
    assert model_ref is not None
    ctx = RuntimeAuthContext(harness=template.harness, backend=template.sandbox)
    static = _StaticSecretsResolver(
        rec["request"]["vault_secrets"],
        gateway_base_url=_GATEWAY_BASE,
        gateway_credentials_value=_GATEWAY_CREDENTIALS,
    )
    return await _default_resolve_session_connection(
        model_ref, ctx, resolve_connection=static.resolve
    )


def _replay_backend(
    tmp_path: Path, result: dict, capture_path: Path
) -> FakeRunnerBackend:
    """A runner that records the ``/run`` request it received (for the request-shaping asserts)
    and echoes the recorded runner ``result`` verbatim (for the result-parsing asserts). The
    recorded result rides a sidecar JSON file so control characters in a real reply stay valid."""
    result_path = tmp_path / "recorded_result.json"
    result_path.write_text(json.dumps(result), encoding="utf-8")
    runner = tmp_path / "custom_connection_replay_runner.py"
    runner.write_text(
        "import sys, json\n"
        "req = json.load(sys.stdin)\n"
        f"open({json.dumps(str(capture_path))}, 'w', encoding='utf-8')"
        ".write(json.dumps(req))\n"
        f"sys.stdout.write(open({json.dumps(str(result_path))}, encoding='utf-8').read())\n",
        encoding="utf-8",
    )
    return FakeRunnerBackend(command=[sys.executable, str(runner)], cwd=str(tmp_path))


async def test_custom_openai_compatible_connection_replays(tmp_path):
    rec = _load("e2-pi-custom-openai-compatible.json")
    template = _template_from_recording(rec)

    # The service's connection resolution over the recorded, redacted vault secret. Guard the
    # resolved plan first so a stale fixture is caught before the wire assertions ride on it.
    resolved = await _resolve_connection(template, rec)
    assert resolved.provider == "openai"
    assert resolved.deployment == "custom"
    assert resolved.model == "openai/gpt-oss-20b:free"
    assert resolved.endpoint is not None
    # W1/D30: the gateway holds the provider secret now; the resolved route names the
    # gateway's `custom/{slug}` target, not the vault record's own upstream URL.
    assert resolved.endpoint.base_url == (
        f"{_GATEWAY_BASE}/gateways/llms/custom/replay-compat"
    )
    assert resolved.credential_mode == "none"
    assert resolved.credentials == []
    assert resolved.gateway_credentials is not None
    assert resolved.gateway_credentials.value == _GATEWAY_CREDENTIALS

    # The resolved connection is the only credential channel; nothing rides beside it.
    session_config = SessionConfig(agent=template, resolved_connection=resolved)
    messages = [
        Message(role=m["role"], content=m["content"])
        for m in rec["request"]["messages"]
    ]
    capture_path = tmp_path / "run_request.json"
    harness = PiHarness(
        Environment(_replay_backend(tmp_path, rec["result"], capture_path))
    )

    result = await harness.prompt(session_config, messages)

    # 1) REQUEST-shaping half: the /run wire carries the resolved custom-connection descriptor.
    sent = json.loads(capture_path.read_text(encoding="utf-8"))
    assert sent["connection"] == {"mode": "agenta", "slug": "replay-compat"}
    assert sent["model"] == "openai/gpt-oss-20b:free"
    connection = sent["modelConnection"]
    assert connection["deployment"] == "custom"
    assert connection["provider"] == "openai"
    assert connection["endpoint"] == {
        "baseUrl": f"{_GATEWAY_BASE}/gateways/llms/custom/replay-compat"
    }
    assert connection["credentialMode"] == "none"
    # No provider secret ever reaches the wire now (W1/D30): the gateway holds it. Our own
    # credentials into the gateway ride the dedicated field, never `credentials`.
    assert connection["credentials"] == []
    assert connection["gatewayCredentials"] == {
        "header": "X-AG-Credentials",
        "value": _GATEWAY_CREDENTIALS,
    }

    # 2) RESULT-parsing half: the recorded runner response folds back cleanly, no live LLM.
    assert result.output == rec["result"]["output"] == "REPLAY-COMPAT-OK"
    assert result.stop_reason == "end_turn"
    assert result.model == "openai/gpt-oss-20b:free"
    assert result.capabilities is not None and result.capabilities.mcp_tools is False
    assert result.session_id == "sess-replay"


async def test_url_less_custom_connection_fails_loud_with_422():
    """A named custom (OpenAI-compatible) connection with NO base URL cannot route the request.

    The companion to the recorded green cell: the same resolver, fed a custom connection whose
    vault record has no ``url``, must fail loud with a 422 ``EndpointResolutionError`` (not degrade
    to a provider default) -- the design's Decision 4. The error names the slug and never carries
    the key. This pins the ``no base URL`` branch and the ``status_code`` the ``/invoke`` remap
    reads (the existing http tests cover only egress-BLOCKED urls, and none assert the 422)."""
    secret = {
        "kind": "custom_provider",
        "header": {"name": "no-url"},
        "data": {
            "kind": "custom",
            "provider_slug": "no-url",
            "provider": {"key": "sk-test"},  # placeholder; never a real key
            "models": [{"slug": "some-model"}],
            "model_keys": ["no-url/custom/some-model"],
        },
    }
    model = ModelRef(
        model="some-model", connection={"mode": "agenta", "slug": "no-url"}
    )

    with pytest.raises(EndpointResolutionError) as exc:
        await _StaticSecretsResolver([secret]).resolve(
            model=model,
            context=RuntimeAuthContext(harness="pi_core", backend="local"),
        )

    assert exc.value.status_code == 422
    assert "no-url" in str(exc.value)
    assert "sk-test" not in str(exc.value)
