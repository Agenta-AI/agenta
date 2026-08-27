"""Resolution of ``gateway_connection`` entries into two runtime tools and one policy.

Covers the SDK half of the rework: one ``/tools/resolve`` request carries every connection
entry, the API answers with a whole catalog slice per integration, and the SDK compiles the
saved policy locally. Implements qa.md cases G6, G11, and the SDK half of C19.

The legacy per-tool arm keeps its own tests in ``test_gateway_http.py``; what this file adds
about it is the coexistence rule (G11 and G12): both arms resolve in one revision and neither
overrides the other.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents.platform import AgentaGatewayToolResolver, PlatformConnection
from agenta.sdk.agents.platform import gateway
from agenta.sdk.agents.tools import (
    GatewayConnectionToolConfig,
    GatewayToolConfig,
    GatewayToolResolutionError,
    ToolResolver,
    UnsupportedToolProviderError,
)


def _connection_config(
    integration: str = "github",
    *,
    slug: str = "github-work",
    default: str = "inherit",
    tools: dict | None = None,
) -> GatewayConnectionToolConfig:
    return GatewayConnectionToolConfig.model_validate(
        {
            "type": "gateway_connection",
            "connection": {
                "provider": "composio",
                "integration": integration,
                "slug": slug,
            },
            "policy": {"permissions": {"default": default, "tools": tools or {}}},
        }
    )


def _slice(integration: str, tools: list[dict]):
    """One ``gateway_connections`` entry, carrying only what the resolver reads from it.

    The response also echoes ``provider`` and ``connection``, but the resolver takes both
    from the saved entry instead, so they are left out here: including them would suggest a
    test passes because the response was echoed when it passes because the config was read.
    """
    return {
        "integration": integration,
        "toolkit_version": "20250827_00",
        "tools": tools,
    }


_GITHUB_CATALOG = [
    {
        "key": "GET_ISSUE",
        "read_only": True,
        "input_schema": {
            "type": "object",
            "properties": {"number": {"type": "integer"}},
        },
    },
    {"key": "CREATE_ISSUE", "read_only": False},
    {"key": "RUN_WORKFLOW"},
]


def _resolver(connection: PlatformConnection) -> AgentaGatewayToolResolver:
    return AgentaGatewayToolResolver(connection=connection)


# --------------------------------------------------------------------------- specs


async def test_one_entry_produces_two_specs_and_one_policy(fake_http, connection):
    capture = fake_http(
        gateway,
        payload={"gateway_connections": [_slice("github", _GITHUB_CATALOG)]},
    )

    resolution = await _resolver(connection).resolve_connections(
        [_connection_config()], mode="allow_reads"
    )

    # One request carries the whole entry, verbatim: the API validates the connection and
    # never reads `policy`, but the entry is what the SDK saved.
    assert capture["url"] == "https://api.x/api/tools/resolve"
    assert capture["json"] == {
        "tools": [
            {
                "type": "gateway_connection",
                "connection": {
                    "provider": "composio",
                    "integration": "github",
                    "slug": "github-work",
                },
                "policy": {
                    "permissions": {"default": "inherit", "tools": {}},
                },
            }
        ]
    }

    # The two derived specifications, exactly as contracts section 4 fixes them.
    assert [spec.name for spec in resolution.tool_specs] == ["search_tools", "run_tool"]
    search, run = resolution.tool_specs
    assert search.call_ref == "gateway.search"
    assert run.call_ref == "gateway.run"
    # The coarse `allow` opens the harness gate only; the runner's semantic gate decides.
    assert search.permission == "allow"
    assert run.permission == "allow"
    assert search.read_only is True
    assert run.read_only is None
    assert search.input_schema == {
        "type": "object",
        "properties": {"query": {"type": "string"}, "integration": {"type": "string"}},
        "required": ["query"],
    }
    assert run.input_schema == {
        "type": "object",
        "properties": {
            "integration": {"type": "string"},
            "tool": {"type": "string"},
            "arguments": {"type": "object"},
        },
        "required": ["integration", "tool", "arguments"],
    }

    # The policy: `inherit` under `allow_reads` allows a read and asks for everything else,
    # and an absent read-only hint stays null rather than collapsing to a write.
    assert resolution.gateway_policy.to_wire() == {
        "integrations": {
            "github": {
                "provider": "composio",
                "connection": "github-work",
                "toolkitVersion": "20250827_00",
                "tools": {
                    "GET_ISSUE": {"permission": "allow", "readOnly": True},
                    "CREATE_ISSUE": {"permission": "ask", "readOnly": False},
                    "RUN_WORKFLOW": {"permission": "ask", "readOnly": None},
                },
            }
        }
    }
    assert resolution.warnings == []
    assert resolution.tool_callback.endpoint == "https://api.x/api/tools/call"


async def test_two_integrations_share_one_pair_of_specs(fake_http, connection):
    capture = fake_http(
        gateway,
        payload={
            "gateway_connections": [
                _slice("github", [{"key": "GET_ISSUE", "read_only": True}]),
                _slice("slack", [{"key": "SEND_MESSAGE", "read_only": False}]),
            ]
        },
    )

    resolution = await _resolver(connection).resolve_connections(
        [
            _connection_config("github"),
            _connection_config("slack", slug="slack-main", default="allow"),
        ],
        mode="allow_reads",
    )

    # Both entries ride ONE request. A second round trip would buy nothing: the API answers
    # each entry with a whole catalog slice.
    assert len(capture["json"]["tools"]) == 2
    # One pair for the whole agent, not one pair per integration: the model names the
    # integration in the arguments, so a per-integration pair would say nothing extra.
    assert [spec.name for spec in resolution.tool_specs] == ["search_tools", "run_tool"]
    policy = resolution.gateway_policy.to_wire()["integrations"]
    assert set(policy) == {"github", "slack"}
    # The connection slug comes from the SAVED entry, not from the response: the model never
    # selects a connection, so the response's echo of it is not what the runner acts on.
    assert policy["slack"]["connection"] == "slack-main"
    assert policy["github"]["connection"] == "github-work"
    # Each integration compiles under its OWN saved policy: slack's `allow` default against
    # github's `inherit`, which under `allow_reads` allows a read.
    assert policy["slack"]["tools"]["SEND_MESSAGE"]["permission"] == "allow"
    assert policy["github"]["tools"]["GET_ISSUE"]["permission"] == "allow"


async def test_search_tools_names_the_connected_integrations(fake_http, connection):
    """ "Never invent an integration name" is only actionable beside the real ones.

    The description is read at every call, while the prompt guidance can fall out of a
    long context, so the list belongs in both.
    """
    fake_http(
        gateway,
        payload={
            "gateway_connections": [
                _slice("slack", [{"key": "SEND_MESSAGE", "read_only": False}]),
                _slice("github", [{"key": "GET_ISSUE", "read_only": True}]),
            ]
        },
    )

    resolution = await _resolver(connection).resolve_connections(
        [
            _connection_config("slack", slug="slack-main", default="allow"),
            _connection_config("github"),
        ],
        mode="allow_reads",
    )

    search = next(s for s in resolution.tool_specs if s.name == "search_tools")
    # Sorted, so the same agent always presents the same sentence.
    assert search.description.endswith("Connected integrations: github, slack.")
    # Names only. A slug is not the model's to know, and `run_tool` names no integration
    # because it is told which one in the arguments.
    for slug in ["github-work", "slack-main"]:
        assert slug not in search.description
    run = next(s for s in resolution.tool_specs if s.name == "run_tool")
    assert "Connected integrations" not in run.description


def test_an_empty_integration_list_leaves_no_dangling_sentence():
    """The resolver's caller guards this, so it is only reachable by a future one.

    Worth being total about: the failure mode is a malformed sentence in model-facing
    text, which no type or test elsewhere would catch.
    """
    from agenta.sdk.agents.platform.gateway import _derived_tool_specs

    search = next(s for s in _derived_tool_specs([]) if s.name == "search_tools")

    assert "Connected integrations" not in search.description
    assert search.description.endswith("Never invent an integration name.")


async def test_agent_wide_mode_reaches_the_compiler(fake_http, connection):
    """``inherit`` resolves against the agent-wide mode, not against a fixed default."""
    fake_http(
        gateway,
        payload={
            "gateway_connections": [
                _slice("github", [{"key": "GET_ISSUE", "read_only": True}])
            ]
        },
    )

    resolution = await _resolver(connection).resolve_connections(
        [_connection_config()], mode="deny"
    )

    tools = resolution.gateway_policy.to_wire()["integrations"]["github"]["tools"]
    assert tools["GET_ISSUE"]["permission"] == "deny"


async def test_authored_deny_survives_a_read_only_hint(fake_http, connection):
    """Catalog metadata never loosens an authored decision (the security half of C26)."""
    fake_http(
        gateway,
        payload={"gateway_connections": [_slice("github", _GITHUB_CATALOG)]},
    )

    resolution = await _resolver(connection).resolve_connections(
        [_connection_config(tools={"GET_ISSUE": "deny"})], mode="allow_reads"
    )

    tools = resolution.gateway_policy.to_wire()["integrations"]["github"]["tools"]
    assert tools["GET_ISSUE"] == {"permission": "deny", "readOnly": True}


# --------------------------------------------------------------------------- stale keys


async def test_stale_key_becomes_a_warning_and_no_executable_entry(
    fake_http, connection
):
    """The SDK half of C19: a configured key the catalog dropped is reported, never run."""
    fake_http(
        gateway,
        payload={
            "gateway_connections": [
                _slice("github", [{"key": "GET_ISSUE", "read_only": True}])
            ]
        },
    )

    resolution = await _resolver(connection).resolve_connections(
        [_connection_config(tools={"DELETED_ACTION": "allow"})], mode="allow_reads"
    )

    tools = resolution.gateway_policy.to_wire()["integrations"]["github"]["tools"]
    assert "DELETED_ACTION" not in tools
    assert len(resolution.warnings) == 1
    assert "DELETED_ACTION" in resolution.warnings[0]


async def test_stale_keys_reach_the_resolved_tool_set_as_warnings(
    fake_http, connection
):
    fake_http(
        gateway,
        payload={
            "gateway_connections": [
                _slice("github", [{"key": "GET_ISSUE", "read_only": True}])
            ]
        },
    )
    resolver = ToolResolver(gateway_connection_resolver=_resolver(connection))

    resolved = await resolver.resolve([_connection_config(tools={"GONE": "allow"})])

    assert len(resolved.warnings) == 1
    assert "GONE" in resolved.warnings[0]
    assert "GONE" not in resolved.gateway_policy.integrations["github"].tools


# --------------------------------------------------------------------------- failures


async def test_missing_api_base_raises_typed_error():
    resolver = _resolver(PlatformConnection())  # no base URL configured
    with pytest.raises(GatewayToolResolutionError, match="API base URL"):
        await resolver.resolve_connections([_connection_config()], mode="allow_reads")


async def test_missing_integration_in_the_response_fails_the_run(fake_http, connection):
    """An integration with no catalog slice would compile to no permitted tool at all.

    Failing loudly is the point: dropping it silently turns a configured integration into an
    unconfigured one, which the runner then denies with no explanation.
    """
    fake_http(gateway, payload={"gateway_connections": []})

    with pytest.raises(GatewayToolResolutionError, match="did not return integration"):
        await _resolver(connection).resolve_connections(
            [_connection_config()], mode="allow_reads"
        )


@pytest.mark.parametrize("toolkit_version", [None, "", "latest", " LATEST "])
async def test_non_concrete_toolkit_version_fails_the_run(
    fake_http, connection, toolkit_version
):
    response_slice = _slice("github", _GITHUB_CATALOG)
    response_slice["toolkit_version"] = toolkit_version
    fake_http(gateway, payload={"gateway_connections": [response_slice]})

    with pytest.raises(
        GatewayToolResolutionError, match="did not return a concrete toolkit version"
    ):
        await _resolver(connection).resolve_connections(
            [_connection_config()], mode="allow_reads"
        )


async def test_a_malformed_catalog_entry_fails_as_the_resolver_error(
    fake_http, connection
):
    """A bad tool inside a good slice must not escape as a raw pydantic error.

    The surrounding code tolerates a malformed SLICE (the per-integration check reports
    it by name), but a malformed TOOL was validated inside a comprehension, so
    `ValidationError` escaped naming a field path and never the integration. The caller
    then cannot tell which connection is at fault, and the failure sits outside the
    typed contract every other error on this path honors.
    """
    fake_http(
        gateway,
        payload={
            "gateway_connections": [
                {"integration": "github", "tools": [{"not": "a tool"}]}
            ]
        },
    )

    with pytest.raises(GatewayToolResolutionError, match="malformed catalog entry"):
        await _resolver(connection).resolve_connections(
            [_connection_config()], mode="allow_reads"
        )


async def test_backend_error_fails_the_run(fake_http, connection):
    """No 404 drop rule here: a connection entry has no single dead action to drop."""
    fake_http(gateway, status=404, payload={"detail": "Connection not found"})

    with pytest.raises(GatewayToolResolutionError, match="Connection not found"):
        await _resolver(connection).resolve_connections(
            [_connection_config()], mode="allow_reads"
        )


async def test_unsupported_provider_is_refused_before_the_request(
    fake_http, connection
):
    capture = fake_http(gateway, payload={"gateway_connections": []})
    entry = _connection_config()
    # Only `composio` parses today, so reach past validation to prove the guard is real.
    entry = entry.model_copy(
        update={"connection": entry.connection.model_copy(update={"provider": "other"})}
    )

    with pytest.raises(UnsupportedToolProviderError):
        await _resolver(connection).resolve_connections([entry], mode="allow_reads")
    assert capture == {}


# --------------------------------------------------------------------------- G6 / G11


async def test_no_connection_entry_gets_neither_derived_tool(fake_http, connection):
    """G6: the two runtime tools exist only for an agent that configured a connection."""
    fake_http(
        gateway,
        payload={
            "custom": [
                {
                    "name": "get_user",
                    "description": "Get a user",
                    "input_schema": {"type": "object", "properties": {}},
                    "call_ref": "tools.composio.github.GET_USER.github-work",
                    "read_only": True,
                }
            ]
        },
    )
    resolver = ToolResolver(gateway_resolver=_resolver(connection))

    resolved = await resolver.resolve(
        [
            GatewayToolConfig(
                integration="github", action="GET_USER", connection="github-work"
            )
        ]
    )

    names = [spec.name for spec in resolved.tool_specs]
    assert "search_tools" not in names
    assert "run_tool" not in names
    assert resolved.gateway_policy is None


async def test_legacy_and_connection_entries_both_resolve(fake_http, connection):
    """G11: a half-migrated revision keeps both surfaces.

    ``/tools/resolve`` answers the legacy entry in ``custom`` and the connection entry in
    ``gateway_connections``, and the resolver reads each from its own arm.
    """
    fake_http(
        gateway,
        payload={
            "custom": [
                {
                    "name": "get_issue",
                    "description": "Get an issue",
                    "input_schema": {"type": "object", "properties": {}},
                    "call_ref": "tools.composio.github.GET_ISSUE.github-work",
                    "read_only": True,
                }
            ],
            "gateway_connections": [_slice("github", _GITHUB_CATALOG)],
        },
    )
    gateway_resolver = _resolver(connection)
    resolver = ToolResolver(
        gateway_resolver=gateway_resolver,
        gateway_connection_resolver=gateway_resolver,
    )

    resolved = await resolver.resolve(
        [
            GatewayToolConfig(
                integration="github",
                action="GET_ISSUE",
                connection="github-work",
                name="get_issue",
                permission="allow",
            ),
            _connection_config(tools={"GET_ISSUE": "deny"}),
        ]
    )

    names = [spec.name for spec in resolved.tool_specs]
    assert names == ["search_tools", "run_tool", "get_issue"]
    # G12: the two surfaces disagree about GET_ISSUE and NEITHER overrides the other. The
    # legacy entry is its own named tool with its own permission; the connection policy
    # governs only calls made through `run_tool`.
    legacy = next(spec for spec in resolved.tool_specs if spec.name == "get_issue")
    assert legacy.permission == "allow"
    policy_tools = resolved.gateway_policy.integrations["github"].tools
    assert policy_tools["GET_ISSUE"].permission == "deny"
