"""Connection bindings (M7): which connections are each person's own account.

Spec: openspec/changes/personal-credentials-bindings/specs/connection-bindings.
"""

from uuid import uuid4

import pytest

from oss.src.core.access.dtos import PrincipalKind, PrincipalRef, RunAuthority
from oss.src.core.credentials.bindings import (
    Binding,
    BindingClaim,
    ConnectionKey,
    InvalidBinding,
    binding_claims_for_revision,
    bound_to_caller,
    caller_user_id,
    claims_from_token,
    claims_to_token,
)
from oss.src.core.workflows.service import (
    _binding_claims,
    _reject_unrunnable_agent_connection,
)
from oss.src.core.workflows.types import InvalidAgentConnectionError


def _revision(**agent):
    return {"parameters": {"agent": agent}}


def test_a_revision_without_bindings_has_no_claims():
    revision = _revision(
        llm={"provider": "openai", "model": "gpt-5", "connection": {"slug": "main"}},
        tools=[
            {
                "type": "gateway_connection",
                "connection": {"integration": "gmail", "slug": "gmail-support"},
            }
        ],
        mcps=[
            {
                "name": "notes",
                "connection": {"type": "gateway", "namespace": "custom", "slug": "n"},
            }
        ],
    )
    assert binding_claims_for_revision(revision) == []


def test_project_default_is_never_signed():
    revision = _revision(
        llm={
            "provider": "openai",
            "model": "gpt-5",
            "connection": {"binding": "project_default"},
        }
    )
    assert binding_claims_for_revision(revision) == []


def test_each_persons_own_model_key_is_signed():
    revision = _revision(
        llm={"model": "openai/gpt-5", "connection": {"binding": "caller_account"}},
    )
    [claim] = binding_claims_for_revision(revision)
    assert claim.key == ConnectionKey(kind="model", service="openai")
    assert claim.binding == Binding.CALLER_ACCOUNT


def test_a_personal_composio_entry_is_signed_with_its_own_slug():
    tool = {
        "type": "gateway_connection",
        "connection": {
            "integration": "gmail",
            "slug": "gmail-mine",
            "binding": "caller_account",
        },
    }
    [claim] = binding_claims_for_revision(_revision(tools=[tool]))
    assert claim.key == ConnectionKey(kind="tool", service="composio:gmail:gmail-mine")


def test_personal_mcp_waits_for_its_store():
    mcp = {
        "name": "notes",
        "connection": {
            "type": "gateway",
            "namespace": "custom",
            "slug": "notes",
            "scope": "user",
        },
    }
    # Refused, never read as the project's server, until the run path serves it.
    with pytest.raises(InvalidBinding):
        binding_claims_for_revision(_revision(mcps=[mcp]))


def test_a_personal_subscription_login_is_not_available_yet():
    revision = _revision(
        llm={
            "provider": "anthropic",
            "model": "claude-sonnet-4-5",
            "connection": {
                "mode": "self_managed",
                "slug": "claude",
                "binding": "caller_account",
            },
        }
    )
    # Refused, never read as the project's login.
    with pytest.raises(InvalidBinding):
        binding_claims_for_revision(revision)


@pytest.mark.parametrize(
    "agent,where",
    [
        # One fixed account is not in the first step.
        (
            {
                "tools": [
                    {
                        "type": "gateway_connection",
                        "connection": {
                            "integration": "gmail",
                            "slug": "g",
                            "binding": "specific",
                        },
                    }
                ]
            },
            "agent.tools[0].connection",
        ),
        # A personal MCP server is always each person's own.
        (
            {
                "mcps": [
                    {
                        "name": "n",
                        "connection": {
                            "type": "gateway",
                            "namespace": "custom",
                            "slug": "n",
                            "scope": "user",
                            "binding": "project_default",
                        },
                    }
                ]
            },
            "agent.mcps[0].connection",
        ),
        # An organization connection is a shared account.
        (
            {
                "llm": {
                    "provider": "openai",
                    "model": "gpt-5",
                    "connection": {
                        "scope": "organization",
                        "namespace": "organization",
                        "slug": "company",
                        "binding": "caller_account",
                    },
                }
            },
            "agent.llm.connection",
        ),
    ],
)
def test_unsupported_bindings_name_the_connection(agent, where):
    with pytest.raises(InvalidBinding) as refused:
        binding_claims_for_revision(_revision(**agent))
    assert refused.value.where == where


def test_an_unsupported_binding_is_saved_and_refused_at_run_start():
    revision = _revision(
        llm={"provider": "openai", "model": "gpt-5"},
        tools=[
            {
                "type": "gateway_connection",
                "connection": {
                    "integration": "gmail",
                    "slug": "g",
                    "binding": "specific",
                },
            }
        ],
    )
    # Saving never checks bindings (owner rule: no checks at save time).
    _reject_unrunnable_agent_connection(revision)
    with pytest.raises(InvalidAgentConnectionError) as refused:
        _binding_claims(revision)
    detail = refused.value.to_detail()
    assert detail["details"]["reason"] == "binding_not_supported"
    assert detail["details"]["field"] == "parameters.agent.tools[0].connection"


def _authority(kind, *, linked_user_id=None):
    return RunAuthority(
        principal=PrincipalRef(kind=kind, id=uuid4()),
        organization_id=uuid4(),
        project_id=uuid4(),
        linked_user_id=linked_user_id,
    )


def test_the_caller_is_the_person_behind_the_run():
    human = _authority(PrincipalKind.HUMAN)
    assert caller_user_id(human) == human.principal.id

    linked = uuid4()
    channel = _authority(PrincipalKind.INSTALLATION, linked_user_id=linked)
    assert caller_user_id(channel) == linked
    # Never the connection's creator: an unlinked channel user has no person.
    assert caller_user_id(_authority(PrincipalKind.INSTALLATION)) is None
    # An API key is no person until personal keys exist (M6a).
    assert caller_user_id(_authority(PrincipalKind.API_KEY)) is None
    assert caller_user_id(None) is None


def test_claims_round_trip_and_fail_closed():
    claim = BindingClaim(
        key=ConnectionKey(kind="model", service="openai"),
        binding=Binding.CALLER_ACCOUNT,
    )
    claims = claims_from_token(claims_to_token([claim]))
    assert bound_to_caller(claims, ConnectionKey(kind="model", service="openai"))
    assert not bound_to_caller(claims, ConnectionKey(kind="model", service="anthropic"))
    # A credential minted before M7, or a malformed claim, binds nothing.
    assert claims_from_token(None) == ()
    assert claims_from_token([{"key": {"kind": "model"}, "binding": "x"}]) == ()
