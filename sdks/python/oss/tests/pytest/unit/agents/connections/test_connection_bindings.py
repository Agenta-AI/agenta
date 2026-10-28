"""The binding field on agent connection references (M7)."""

import pytest
from pydantic import ValidationError

from agenta.sdk.agents.connections.models import Connection
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
