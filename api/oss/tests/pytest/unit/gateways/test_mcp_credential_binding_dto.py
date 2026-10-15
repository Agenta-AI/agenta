"""What an MCP credential binding may say, checked where a request enters the API.

A query binding's value is added to the URL at request time, so the stored URL must not
already carry that parameter, and a query value takes no scheme prefix.
"""

import pytest
from pydantic import ValidationError

from oss.src.core.gateways.mcps.dtos import MCPCredentialBinding, MCPEndpointRoute


def test_a_query_binding_refuses_a_prefix():
    with pytest.raises(ValidationError, match="takes no prefix"):
        MCPCredentialBinding(kind="query", name="token", prefix="Bearer")


def test_a_header_binding_keeps_its_prefix():
    binding = MCPCredentialBinding(name=" Authorization ", prefix=" Basic ")

    assert (binding.name, binding.prefix) == ("Authorization", "Basic")


def test_a_url_that_already_carries_the_bound_parameter_is_refused():
    with pytest.raises(ValidationError, match="exaApiKey"):
        MCPEndpointRoute(
            base_url="https://mcp.example.com/mcp?exaApiKey=test-key-one",
            credential_binding=MCPCredentialBinding(kind="query", name="exaApiKey"),
        )


def test_other_query_parameters_and_header_bindings_are_left_alone():
    MCPEndpointRoute(
        base_url="https://mcp.example.com/mcp?codemode=false",
        credential_binding=MCPCredentialBinding(kind="query", name="exaApiKey"),
    )
    # A header binding sends nothing in the URL, so a same-named parameter is the URL's own.
    MCPEndpointRoute(
        base_url="https://mcp.example.com/mcp?token=public",
        credential_binding=MCPCredentialBinding(name="token"),
    )
