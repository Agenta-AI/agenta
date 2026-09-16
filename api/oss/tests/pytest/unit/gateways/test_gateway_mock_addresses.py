"""The mock gateways' addresses come from the allocation, not from a written-down port.

`env.sh` allocates a host port per worktree so two dev stacks can run side by side. The
suites that dial the mock from the host wrote `9092` instead of reading it, so a stack
given a different port dialled whatever was on 9092, or nothing, and said nothing about it
(D76, CR8).
"""

import pytest

from oss.tests.pytest.utils.mock_gateways import (
    mock_llm_published_port,
    mock_mcp_container_url,
    mock_mcp_published_port,
    mock_mcp_published_url,
)


def test_the_published_port_comes_from_the_allocation(monkeypatch):
    monkeypatch.setenv("AGENTA_MOCK_MCP_GATEWAY_PORT", "14123")

    assert mock_mcp_published_port() == 14123
    assert mock_mcp_published_url() == "http://localhost:14123"


def test_the_llm_mock_reads_its_own_allocation(monkeypatch):
    monkeypatch.setenv("AGENTA_MOCK_LLM_GATEWAY_PORT", "14124")
    monkeypatch.setenv("AGENTA_MOCK_MCP_GATEWAY_PORT", "14123")

    assert mock_llm_published_port() == 14124
    assert mock_mcp_published_port() == 14123


@pytest.mark.parametrize("unset", ["", "   "])
def test_an_unallocated_stack_keeps_the_compose_default(monkeypatch, unset):
    monkeypatch.setenv("AGENTA_MOCK_MCP_GATEWAY_PORT", unset)
    monkeypatch.delenv("AGENTA_MOCK_MCP_GATEWAY_PUBLISHED_URL", raising=False)

    assert mock_mcp_published_port() == 9092
    assert mock_mcp_published_url() == "http://localhost:9092"


def test_an_explicit_published_url_still_wins(monkeypatch):
    """A tunnelled stack points the browser leg at a public address, which is neither
    localhost nor a port this can compute."""
    monkeypatch.setenv("AGENTA_MOCK_MCP_GATEWAY_PORT", "14123")
    monkeypatch.setenv(
        "AGENTA_MOCK_MCP_GATEWAY_PUBLISHED_URL", "https://mock.example.test/"
    )

    assert mock_mcp_published_url() == "https://mock.example.test"


def test_the_container_address_does_not_move_with_the_allocation(monkeypatch):
    """The published port is remapped onto the container's own, which is fixed. Reading
    the allocation here would point the API container at a port nothing listens on."""
    monkeypatch.setenv("AGENTA_MOCK_MCP_GATEWAY_PORT", "14123")
    monkeypatch.delenv("AGENTA_MOCK_MCP_GATEWAY_URL", raising=False)

    assert mock_mcp_container_url() == "http://mock-mcp-gateway:9092"


def test_an_explicit_container_url_wins(monkeypatch):
    monkeypatch.setenv("AGENTA_MOCK_MCP_GATEWAY_URL", "http://elsewhere:9092/")

    assert mock_mcp_container_url() == "http://elsewhere:9092"


def test_a_malformed_allocation_is_reported_rather_than_ignored(monkeypatch):
    """Falling back silently is how a suite ends up dialling a port nobody asked for."""
    monkeypatch.setenv("AGENTA_MOCK_MCP_GATEWAY_PORT", "not-a-port")

    with pytest.raises(AssertionError, match="not a port number"):
        mock_mcp_published_port()
