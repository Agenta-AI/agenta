"""What an MCP credential binding may say, checked where a request enters the API.

A query binding's value is added to the URL at request time, so the stored URL must not
already carry that parameter, and a query value takes no scheme prefix. A url binding's
value replaces `{secret}` in the stored URL's path, so the two must agree.
"""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from oss.src.core.gateways.mcps.dtos import (
    MCPCredentialBinding,
    MCPEndpointCreate,
    MCPEndpointData,
    MCPEndpointEdit,
    MCPEndpointRoute,
    with_url_secret,
)


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


_FIRECRAWL = "https://mcp.firecrawl.dev/{secret}/v2/mcp"


def test_a_url_binding_with_one_placeholder_in_the_path_is_stored_as_written():
    route = MCPEndpointRoute(
        base_url=_FIRECRAWL, credential_binding=MCPCredentialBinding(kind="url")
    )

    assert route.base_url == _FIRECRAWL


@pytest.mark.parametrize(
    "base_url",
    [
        "https://mcp.firecrawl.dev/v2/mcp",
        "https://mcp.example.com/{secret}/{secret}/mcp",
        # Outside the path, the value could move the request to another host.
        "https://{secret}.example.com/mcp",
        "https://mcp.example.com/mcp?key={secret}",
    ],
)
def test_a_url_binding_needs_exactly_one_placeholder_in_the_path(base_url):
    with pytest.raises(ValidationError, match="exactly one"):
        MCPEndpointRoute(
            base_url=base_url, credential_binding=MCPCredentialBinding(kind="url")
        )


@pytest.mark.parametrize(
    "binding",
    [None, MCPCredentialBinding(name="Authorization", prefix="Bearer")],
)
def test_a_placeholder_needs_a_url_binding(binding):
    with pytest.raises(ValidationError, match="only a secret sent in the URL"):
        MCPEndpointRoute(base_url=_FIRECRAWL, credential_binding=binding)


def test_a_url_binding_takes_no_name_and_the_others_need_one():
    with pytest.raises(ValidationError, match="no name"):
        MCPCredentialBinding(kind="url", name="key")
    with pytest.raises(ValidationError, match="needs a name"):
        MCPCredentialBinding(kind="query")


def test_the_value_is_encoded_as_one_path_segment():
    """A `/` or `?` in a key stays inside its segment instead of changing the request."""
    assert (
        with_url_secret(_FIRECRAWL, "test key/one?x")
        == "https://mcp.firecrawl.dev/test%20key%2Fone%3Fx/v2/mcp"
    )


def _url_data() -> MCPEndpointData:
    return MCPEndpointData(
        route=MCPEndpointRoute(
            base_url=_FIRECRAWL, credential_binding=MCPCredentialBinding(kind="url")
        )
    )


@pytest.mark.parametrize("auth_mode", ["none", "oauth"])
def test_a_url_binding_is_refused_on_a_row_that_sends_no_key(auth_mode):
    with pytest.raises(ValidationError, match="Only an API key"):
        MCPEndpointCreate(name="Firecrawl", auth_mode=auth_mode, data=_url_data())
    with pytest.raises(ValidationError, match="Only an API key"):
        MCPEndpointEdit(
            id=uuid4(), name="Firecrawl", auth_mode=auth_mode, data=_url_data()
        )


def test_a_url_binding_is_stored_on_an_api_key_row():
    MCPEndpointCreate(name="Firecrawl", auth_mode="api_key", data=_url_data())
