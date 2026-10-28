"""The binding field on agent connection references (M7)."""

import pytest
from pydantic import ValidationError

from agenta.sdk.agents.connections.models import Connection
from agenta.sdk.agents.mcp.models import MCPGatewayConnection
from agenta.sdk.agents.mcp.resolver import _gateway_mcp_route
from agenta.sdk.agents.tools.models import GatewayConnectionRef


def test_a_reference_without_binding_is_the_shared_account():
    assert Connection().binding is None
    assert GatewayConnectionRef(integration="gmail", slug="g").binding is None


def test_each_persons_own_account_parses_on_every_reference():
    assert Connection(binding="caller_account").is_caller_account
    assert (
        GatewayConnectionRef(
            integration="gmail", slug="g", binding="caller_account"
        ).binding
        == "caller_account"
    )


@pytest.mark.parametrize(
    "build",
    [
        # One fixed account is not in the first step.
        lambda: GatewayConnectionRef(integration="gmail", slug="g", binding="specific"),
        # An organization connection is a shared account.
        lambda: Connection(
            scope="organization", slug="company", binding="caller_account"
        ),
        # A personal subscription login is not available yet: never the shared one.
        lambda: Connection(
            mode="self_managed", slug="claude", binding="caller_account"
        ),
    ],
)
def test_unsupported_bindings_are_refused(build):
    with pytest.raises(ValidationError):
        build()


def test_a_personal_mcp_server_routes_to_the_user_namespace():
    personal = MCPGatewayConnection(
        namespace="custom", slug="notes", scope="user", binding="caller_account"
    )
    route = _gateway_mcp_route(
        connection=personal, name="notes", gateway_base_url="https://api.x/api"
    )
    assert route == "https://api.x/api/gateways/mcps/user/notes"
    # An unset scope and binding serialize as before M7.
    assert (
        "scope" not in MCPGatewayConnection(namespace="custom", slug="n").model_dump()
    )


@pytest.mark.parametrize(
    "fields",
    [
        {"namespace": "custom", "slug": "n", "scope": "user"},
        {
            "namespace": "custom",
            "slug": "n",
            "scope": "user",
            "binding": "project_default",
        },
        {"namespace": "custom", "slug": "n", "binding": "caller_account"},
    ],
)
def test_unsupported_personal_mcp_references_are_refused(fields):
    with pytest.raises(ValidationError):
        MCPGatewayConnection(**fields)
