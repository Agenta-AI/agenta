"""The one factory every composition root calls: proves `agenta` rides the
same registry as `slack`/`mock`, built by one function, not a third
hand-built adapters dict."""

from unittest.mock import AsyncMock, patch
from uuid import UUID


from entrypoints.channel_adapters import (
    _resolve_agenta_api_key_project,
    build_channel_adapter_registry,
)
from oss.src.core.access.dtos import (
    Decision,
    DecisionReason,
    PrincipalKind,
    PrincipalRef,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.channels.adapters.agenta.adapter import AgentaAdapter
from oss.src.core.channels.adapters.embed.adapter import EmbedAdapter


def test_registry_includes_agenta_beside_slack_and_mock():
    registry = build_channel_adapter_registry()

    assert set(registry.keys()) >= {"slack", "mock", "agenta"}
    assert isinstance(registry.get("agenta"), AgentaAdapter)


def test_registry_includes_embed():
    assert isinstance(build_channel_adapter_registry().get("embed"), EmbedAdapter)


async def test_resolve_agenta_api_key_project_returns_none_for_an_invalid_key():
    with patch(
        "entrypoints.channel_adapters.use_api_key",
        new_callable=AsyncMock,
        return_value=False,
    ):
        assert await _resolve_agenta_api_key_project("bad.key") is None


_PROJECT_ID = "11111111-1111-1111-1111-111111111111"
_USER_ID = "22222222-2222-2222-2222-222222222222"
_KEY_ID = "33333333-3333-3333-3333-333333333333"


class _FakeApiKey:
    id = _KEY_ID
    project_id = _PROJECT_ID
    created_by_id = _USER_ID


class _RecordingDecide:
    def __init__(self, allowed):
        self.allowed = allowed
        self.calls = []

    async def decide(self, **kwargs):
        self.calls.append(kwargs)
        return Decision(
            allowed=self.allowed,
            reason=(
                DecisionReason.ROLE
                if self.allowed
                else DecisionReason.MISSING_CAPABILITY
            ),
        )


def _resolve_with(*, api_key, may_run):
    access = _RecordingDecide(may_run)
    return (
        patch(
            "entrypoints.channel_adapters.use_api_key",
            new_callable=AsyncMock,
            return_value=api_key,
        ),
        patch("entrypoints.channel_adapters.get_access_service", lambda: access),
        access,
    )


async def test_agenta_key_channel_uses_api_key_principal():
    key_patch, access_patch, access = _resolve_with(api_key=_FakeApiKey(), may_run=True)
    with key_patch, access_patch:
        project_id = await _resolve_agenta_api_key_project("good.key")

    assert project_id == _PROJECT_ID
    assert access.calls == [
        {
            "authority": None,
            "principal": PrincipalRef(kind=PrincipalKind.API_KEY, id=UUID(_KEY_ID)),
            "action": Permission.RUN_CHANNELS,
            "project_id": UUID(_PROJECT_ID),
        }
    ]


async def test_resolve_agenta_api_key_project_refuses_a_key_without_run_channels():
    """A viewer's key is valid for the project but may not run its agents: a
    post on the agenta channel must refuse it like an unknown key."""

    key_patch, access_patch, _ = _resolve_with(api_key=_FakeApiKey(), may_run=False)
    with key_patch, access_patch:
        assert await _resolve_agenta_api_key_project("viewer.key") is None


async def test_resolve_agenta_api_key_project_refuses_a_key_with_no_owner():
    class _OwnerlessApiKey(_FakeApiKey):
        created_by_id = None

    key_patch, access_patch, access = _resolve_with(
        api_key=_OwnerlessApiKey(), may_run=True
    )
    with key_patch, access_patch:
        assert await _resolve_agenta_api_key_project("orphan.key") is None
    assert access.calls == []


async def test_agenta_channel_refuses_key_with_missing_creator():
    """Production finding: a key whose creator row is gone. The real decision reads
    the key record as inactive, so the channel refuses it (returns None), as today."""

    from oss.src.core.access.dtos import PrincipalRecord  # noqa: PLC0415
    from oss.src.core.access.service import AccessService  # noqa: PLC0415
    from oss.src.core.memberships.dtos import MembershipPolicy  # noqa: PLC0415
    from oss.src.core.memberships.service import MembershipsService  # noqa: PLC0415
    from oss.tests.pytest.utils.memberships import (  # noqa: PLC0415
        InMemoryMembershipsDAO,
        RecordingRbac,
    )
    from oss.tests.pytest.utils.principals import InMemoryPrincipalsDAO  # noqa: PLC0415

    key = PrincipalRef(kind=PrincipalKind.API_KEY, id=UUID(_KEY_ID))
    principals = InMemoryPrincipalsDAO()
    principals.add(
        PrincipalRecord(
            principal=key,
            project_id=UUID(_PROJECT_ID),
            acting_user_id=UUID(_USER_ID),
            is_active=False,
        )
    )
    service = AccessService(
        memberships=MembershipsService(
            memberships_dao=InMemoryMembershipsDAO(),
            policy=MembershipPolicy.ORGANIZATION_WIDE,
        ),
        rbac=RecordingRbac(),
        principals=principals,
    )
    with (
        patch(
            "entrypoints.channel_adapters.use_api_key",
            new_callable=AsyncMock,
            return_value=_FakeApiKey(),
        ),
        patch("entrypoints.channel_adapters.get_access_service", lambda: service),
    ):
        assert await _resolve_agenta_api_key_project("ghost.key") is None
