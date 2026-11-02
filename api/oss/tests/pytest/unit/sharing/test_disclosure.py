"""`build_share_disclosure`: the gateway connections an agent revision's tools use."""

from oss.src.core.sharing.disclosure import build_share_disclosure
from oss.src.core.sharing.dtos import DisclosedConnection, ShareDisclosure


def _gateway(action: str, *, integration="github", connection="team-github"):
    return {
        "type": "gateway",
        "provider": "composio",
        "integration": integration,
        "action": action,
        "connection": connection,
    }


def _assert_fixed_statements(disclosure: ShareDisclosure) -> None:
    assert disclosure.turns_use_run_credentials is True
    assert disclosure.files_and_tool_results_shared is True
    assert disclosure.trace_readers_can_read is True


def test_connections_from_tools_parameters():
    parameters = {
        "agent": {
            "tools": [
                _gateway("GITHUB_CREATE_ISSUE"),
                _gateway("GITHUB_LIST_ISSUES"),
                # The whole-integration entry of another connection.
                {
                    "type": "gateway_connection",
                    "connection": {
                        "provider": "composio",
                        "integration": "slack",
                        "slug": "acme-slack",
                    },
                },
                # The legacy slug form of the first connection.
                "tools.composio.github.GITHUB_GET_REPO.team-github",
                # Not a gateway tool: never listed.
                {"type": "code", "name": "adder", "script": "x = 1"},
                {"type": "agenta_tools", "tools": {"rename_session": "allow"}},
                # An entry that does not parse is skipped, not fatal.
                {"type": "gateway", "integration": "broken"},
            ],
            # MCP endpoints are not connections of the gateway: never listed.
            "mcps": [{"type": "remote", "url": "https://mcp.example.com/sse"}],
        },
        # A provider key in the model settings is not listed either.
        "llm": {"model": "gpt-5.5", "api_key": "sk-not-listed"},
    }

    disclosure = build_share_disclosure(parameters=parameters)

    assert disclosure.connections == [
        DisclosedConnection(
            provider="composio", integration="github", connection="team-github"
        ),
        DisclosedConnection(
            provider="composio", integration="slack", connection="acme-slack"
        ),
    ]
    _assert_fixed_statements(disclosure)


def test_bare_template_tools_are_read_too():
    disclosure = build_share_disclosure(
        parameters={
            "tools": [
                _gateway("B", integration="notion", connection="z"),
                _gateway("A", integration="github", connection="a"),
            ]
        }
    )

    assert [(c.integration, c.connection) for c in disclosure.connections] == [
        ("github", "a"),
        ("notion", "z"),
    ]


def test_no_tools_gives_empty_connections():
    for parameters in (
        None,
        {},
        {"agent": {}},
        {"agent": {"tools": None}},
        {"agent": {"tools": "not a list"}},
        {"agent": "not a dict"},
    ):
        disclosure = build_share_disclosure(parameters=parameters)
        assert disclosure.connections == []
        _assert_fixed_statements(disclosure)


def test_a_user_item_is_listed_by_its_integration_without_a_slug():
    """A personal Gmail tool names no connection: the disclosure says each person's own
    Gmail, never a slug, and never fails the sharing read."""
    parameters = {
        "agent": {
            "tools": [
                {
                    "type": "gateway_connection",
                    "connection": {
                        "provider": "composio",
                        "integration": "gmail",
                        "account_source": "user",
                    },
                },
                {
                    "type": "gateway_connection",
                    "connection": {
                        "provider": "composio",
                        "integration": "slack",
                        "slug": "team-slack",
                    },
                },
            ]
        }
    }
    disclosure = build_share_disclosure(parameters=parameters)
    assert disclosure.connections == [
        DisclosedConnection(
            provider="composio",
            integration="gmail",
            connection=None,
            account_source="user",
        ),
        DisclosedConnection(
            provider="composio", integration="slack", connection="team-slack"
        ),
    ]
