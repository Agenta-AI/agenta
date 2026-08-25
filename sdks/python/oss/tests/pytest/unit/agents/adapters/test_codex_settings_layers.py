"""Codex ``config.toml`` rendering: file-free managed auth plus permission Layers 1 and 2.

Managed auth is file-free (D-002 final ruling): a managed run renders a custom ``model_providers``
block with ``env_key = "OPENAI_API_KEY"`` and never writes a credential. A run is managed unless it
is explicitly subscription (``credential_mode = "runtime_provided"``). These Layer-1/2 tests pass
``credential_mode="runtime_provided"`` to isolate the scalar rendering from the managed block; the
managed block has its own tests below.

Per the D-008 amendment (2026-07-24) no ``[mcp_servers.*]`` approval tables are rendered (codex
0.145 rejects a transport-less server entry at ``session/new``; the runner-side gate is the
tool-permission authority).
"""

from __future__ import annotations

import tomllib

import pytest

from agenta.sdk.agents.adapters.codex_settings import (
    MANAGED_PROVIDER_ENV_KEY,
    MANAGED_PROVIDER_ID,
    build_codex_settings_files,
)
from agenta.sdk.agents.dtos import SandboxPermission
from agenta.sdk.agents.mcp import MCPPolicy, MCPToolPolicy, ResolvedMCPServer

# A subscription run renders no managed provider block, so its scalar rendering is testable alone.
SUB = "runtime_provided"


def _config(files):
    assert len(files) == 1
    assert files[0]["path"] == ".codex/config.toml"
    content = files[0]["content"]
    return content, tomllib.loads(content)


def _mcp(name: str, permission=None, tool_names=None) -> ResolvedMCPServer:
    tools = (
        MCPToolPolicy(mode="include", names=tool_names)
        if tool_names
        else MCPToolPolicy()
    )
    return ResolvedMCPServer(
        name=name,
        url="https://x",
        policy=MCPPolicy(permission=permission, tools=tools),
    )


# --- File-free managed auth (D-002 final ruling) ---


def test_managed_run_renders_file_free_provider_block():
    # A managed run (credential_mode "env", "none", or unresolved None) writes ONLY the provider
    # block when nothing else is authored. The key never appears; codex reads env_key at request time.
    for credential_mode in ("env", "none", None):
        content, config = _config(
            build_codex_settings_files({}, credential_mode=credential_mode)
        )
        assert config["model_provider"] == MANAGED_PROVIDER_ID
        provider = config["model_providers"][MANAGED_PROVIDER_ID]
        assert provider["env_key"] == MANAGED_PROVIDER_ENV_KEY
        assert provider["name"] == "Agenta OpenAI"
        # No credential in the file, and no built-in provider override attempt.
        assert (
            "OPENAI_API_KEY" == MANAGED_PROVIDER_ENV_KEY
        )  # sanity: only the NAME is written
        assert "sk-" not in content


def test_gateway_route_renders_base_url_and_env_http_headers():
    # A gateway-routed managed connection carries base_url + env_http_headers, mapping
    # OUR header name to the shared env var — never the raw value.
    content, config = _config(
        build_codex_settings_files(
            {},
            credential_mode="none",
            gateway_base_url="https://gw.example.com/gateways/llms/standard/openai",
            gateway_header="X-AG-Credentials",
        )
    )
    provider = config["model_providers"][MANAGED_PROVIDER_ID]
    assert (
        provider["base_url"] == "https://gw.example.com/gateways/llms/standard/openai"
    )
    assert provider["env_http_headers"] == {
        "X-AG-Credentials": "AGENTA_GATEWAY_CREDENTIALS_VALUE"
    }
    assert "ApiKey" not in content  # never the raw credential value


def test_non_gateway_run_omits_base_url_and_headers():
    # Byte-identical to before when there is nothing gateway-shaped to add.
    content, config = _config(build_codex_settings_files({}, credential_mode="env"))
    provider = config["model_providers"][MANAGED_PROVIDER_ID]
    assert "base_url" not in provider
    assert "env_http_headers" not in provider


def test_managed_run_places_model_provider_scalar_before_the_table():
    # TOML requires top-level scalars before any table. The provider pointer and any authored scalars
    # must precede the [model_providers.*] table, or tomllib would fold them into it.
    content, config = _config(
        build_codex_settings_files({"approval_policy": "never"}, credential_mode="env")
    )
    assert content.index("model_provider") < content.index("[model_providers")
    assert content.index("approval_policy") < content.index("[model_providers")
    assert config["approval_policy"] == "never"
    assert config["model_provider"] == MANAGED_PROVIDER_ID


def test_subscription_run_renders_no_provider_block():
    # Subscription uses the built-in provider + mounted OAuth login: no block, and fileless when
    # nothing else is authored.
    assert build_codex_settings_files({}, credential_mode=SUB) == []
    content, config = _config(
        build_codex_settings_files(
            {"approval_policy": "on-request"}, credential_mode=SUB
        )
    )
    assert "model_provider" not in config
    assert "[model_providers" not in content
    assert config["approval_policy"] == "on-request"


# --- Layer 1: author's Codex-native scalars pass through verbatim ---
def test_layer1_scalars_pass_through():
    content, config = _config(
        build_codex_settings_files(
            {"approval_policy": "on-request", "sandbox_mode": "workspace-write"},
            credential_mode=SUB,
        )
    )

    assert config["approval_policy"] == "on-request"
    assert config["sandbox_mode"] == "workspace-write"
    assert "[mcp_servers" not in content


# Layer 2: a read-only/off filesystem reinforces sandbox_mode; nothing else.
@pytest.mark.parametrize("filesystem", ["readonly", "off"])
def test_filesystem_boundary_derives_read_only_sandbox_mode(filesystem):
    content, config = _config(
        build_codex_settings_files(
            None, SandboxPermission(filesystem=filesystem), credential_mode=SUB
        )
    )

    assert content == 'sandbox_mode = "read-only"\n'
    assert config["sandbox_mode"] == "read-only"


def test_authored_sandbox_mode_is_not_overridden_by_layer_2():
    content, config = _config(
        build_codex_settings_files(
            {"sandbox_mode": "workspace-write"},
            SandboxPermission(filesystem="readonly"),
            credential_mode=SUB,
        )
    )

    assert content == 'sandbox_mode = "workspace-write"\n'
    assert config["sandbox_mode"] == "workspace-write"


@pytest.mark.parametrize("network_mode", ["off", "allowlist"])
def test_network_restriction_renders_nothing_when_not_expressible(network_mode):
    network = {"mode": network_mode}
    if network_mode == "allowlist":
        network["allowlist"] = ["10.0.0.0/8"]

    assert (
        build_codex_settings_files(
            None, SandboxPermission(network=network), credential_mode=SUB
        )
        == []
    )


# A tool-bearing run with permission rules never renders an
# [mcp_servers.*] table. A transport-less server entry crashes codex at session/new; the
# runner-side gate is the tool-permission authority.
def test_permission_rules_render_no_mcp_servers_tables():
    files = build_codex_settings_files(
        {"approval_policy": "untrusted"},  # a Layer-1 scalar keeps the file non-empty
        None,
        [
            _mcp("github", permission="ask"),
            _mcp("filesystem", permission="allow"),
            _mcp("blocked", permission="deny", tool_names=["a", "b"]),
        ],
        [
            {
                "kind": "callback",
                "name": "capital_lookup",
                "description": "d",
                "callRef": "workflow.x",
                "permission": "allow",
            },
            {
                "kind": "callback",
                "name": "danger",
                "description": "d",
                "callRef": "workflow.y",
                "permission": "deny",
            },
        ],
        credential_mode=SUB,
    )
    content, config = _config(files)

    # Only the Layer-1 scalar survives; no server/tool tables at all.
    assert content == 'approval_policy = "untrusted"\n'
    assert "mcp_servers" not in config
    assert "[mcp_servers" not in content
    assert "approval_mode" not in content
    assert "default_tools_approval_mode" not in content
    assert "disabled_tools" not in content


def test_permission_only_subscription_run_writes_no_file():
    # No Layer-1/2 scalar authored/derived, subscription (no managed block): the tables that WOULD
    # have been the only content are no longer rendered, so nothing is written at all.
    assert (
        build_codex_settings_files(
            None,
            None,
            [
                _mcp("github", permission="ask"),
                _mcp("blocked", permission="deny", tool_names=["a"]),
            ],
            [
                {
                    "kind": "callback",
                    "name": "writer",
                    "description": "d",
                    "callRef": "workflow.x",
                    "permission": "deny",
                }
            ],
            credential_mode=SUB,
        )
        == []
    )


def test_fileless_subscription_run_still_returns_empty_list():
    assert build_codex_settings_files(None, credential_mode=SUB) == []
    assert build_codex_settings_files({}, credential_mode=SUB) == []
    assert (
        build_codex_settings_files(
            None,
            SandboxPermission(network={"mode": "on"}, filesystem="on"),
            [_mcp("unset")],
            [],
            credential_mode=SUB,
        )
        == []
    )
