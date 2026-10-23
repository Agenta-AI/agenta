"""An embedded reference to a private agent resolves only for its owner.

Every embed goes through the universal resolver, so a readable outer revision (a
stored one or an inline one) cannot carry a private agent's configuration out. A
hidden embed fails exactly like a reference that names nothing.
"""

from types import SimpleNamespace
from typing import Optional
from uuid import UUID, uuid4

import pytest

from oss.src.core.access.context import reset_request_access, set_request_access
from oss.src.core.access.dtos import (
    DecisionReason,
    PrincipalKind,
    PrincipalRef,
    RequestAccess,
    RequestCredentialKind,
    ResourceKind,
    RunAuthority,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.applications.dtos import ApplicationRevision, ApplicationRevisionData
from oss.src.core.embeds.dtos import ErrorPolicy
from oss.src.core.embeds.exceptions import EmbedNotFoundError
from oss.src.core.embeds.service import EmbedsService
from oss.src.core.evaluators.dtos import EvaluatorRevision, EvaluatorRevisionData
from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import WorkflowRevision, WorkflowRevisionData


pytestmark = [pytest.mark.asyncio, pytest.mark.real_resource_checks]

_PROJECT = uuid4()
_ORGANIZATION = uuid4()
_ALICE = uuid4()
_BOB = uuid4()
_PRIVATE = uuid4()  # Alice's private agent
_SHARED = uuid4()  # a project-visible agent


class _Policy:
    """`resource_policy.evaluate`: rule A2 for `_PRIVATE`, A1 for the rest."""

    def __init__(self) -> None:
        self.calls = []

    async def evaluate(self, *, principal, action, project_id, resource):
        self.calls.append((principal, action, project_id, resource))
        assert resource.kind == ResourceKind.AGENT
        if resource.id == str(_PRIVATE) and not (
            principal.kind == PrincipalKind.HUMAN and principal.id == _ALICE
        ):
            return DecisionReason.RESOURCE_DENIED
        return None


def _parameters(name: str) -> dict:
    return {"parameters": {"system_prompt": f"secret of {name}"}}


class _Service:
    """Revisions by slug: `private` belongs to `_PRIVATE`, `shared` to `_SHARED`,
    anything else is unknown."""

    def __init__(self, family: str) -> None:
        self.family = family

    def _revision(self, ref: Optional[Reference]):
        slug = ref.slug if ref else None
        if slug not in ("private", "shared"):
            return None
        artifact_id = _PRIVATE if slug == "private" else _SHARED
        common = dict(id=uuid4(), project_id=_PROJECT, version="1", slug=slug)
        if self.family == "workflow":
            return WorkflowRevision(
                **common,
                workflow_id=artifact_id,
                workflow_variant_id=uuid4(),
                data=WorkflowRevisionData(**_parameters(slug)),
            )
        if self.family == "application":
            return ApplicationRevision(
                **common,
                application_id=artifact_id,
                application_variant_id=uuid4(),
                data=ApplicationRevisionData(**_parameters(slug)),
            )
        return EvaluatorRevision(
            **common,
            evaluator_id=artifact_id,
            evaluator_variant_id=uuid4(),
            data=EvaluatorRevisionData(**_parameters(slug)),
        )

    async def fetch_workflow_revision(self, *, workflow_ref=None, **_):
        return self._revision(workflow_ref)

    async def fetch_application_revision(self, *, application_ref=None, **_):
        return self._revision(application_ref)

    async def fetch_evaluator_revision(self, *, evaluator_ref=None, **_):
        return self._revision(evaluator_ref)


@pytest.fixture
def policy(monkeypatch):
    policy = _Policy()
    monkeypatch.setattr(
        "oss.src.core.embeds.service.get_access_service",
        lambda: SimpleNamespace(resource_policy=policy),
    )
    return policy


@pytest.fixture
def embeds():
    return EmbedsService(
        workflows_service=_Service("workflow"),
        applications_service=_Service("application"),
        evaluators_service=_Service("evaluator"),
        environments_service=SimpleNamespace(),
    )


def _as(principal: Optional[PrincipalRef]):
    """The request access of `principal` (Bearer for a human, ApiKey otherwise)."""

    if principal is None:
        return None
    kind = (
        RequestCredentialKind.BEARER_SESSION
        if principal.kind == PrincipalKind.HUMAN
        else RequestCredentialKind.API_KEY
    )
    return set_request_access(
        RequestAccess(
            principal=principal,
            authority=RunAuthority(
                principal=principal,
                organization_id=_ORGANIZATION,
                project_id=_PROJECT,
            ),
            credential_kind=kind,
            acting_user_id=_BOB if principal.id != _ALICE else _ALICE,
        )
    )


def _config(family: str, slug: str) -> dict:
    return {"embedded": {"@ag.embed": {"@ag.references": {family: {"slug": slug}}}}}


async def _resolve(embeds, principal, configuration, **kwargs):
    token = _as(principal)
    try:
        return await embeds.resolve_configuration(
            project_id=_PROJECT, configuration=configuration, **kwargs
        )
    finally:
        if token is not None:
            reset_request_access(token)


_HUMAN_BOB = PrincipalRef(kind=PrincipalKind.HUMAN, id=_BOB)
_HUMAN_ALICE = PrincipalRef(kind=PrincipalKind.HUMAN, id=_ALICE)
_API_KEY = PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4())
_FAMILIES = ["workflow", "application", "evaluator"]


@pytest.mark.parametrize("family", _FAMILIES)
@pytest.mark.parametrize("principal", [_HUMAN_BOB, _API_KEY], ids=["bearer", "key"])
async def test_hidden_embed_fails_like_an_unknown_one(
    embeds, policy, family, principal
):
    with pytest.raises(EmbedNotFoundError) as unknown:
        await _resolve(embeds, principal, _config(family, "missing"))
    with pytest.raises(EmbedNotFoundError) as hidden:
        await _resolve(embeds, principal, _config(family, "private"))

    assert type(hidden.value) is type(unknown.value)
    assert str(hidden.value) == str(unknown.value).replace("missing", "private")
    assert "secret" not in str(hidden.value)
    assert policy.calls[-1][1] == Permission.VIEW_WORKFLOWS
    assert policy.calls[-1][3].id == str(_PRIVATE)


@pytest.mark.parametrize("family", _FAMILIES)
async def test_placeholder_policy_hides_the_content(embeds, policy, family):
    unknown, unknown_info = await _resolve(
        embeds,
        _HUMAN_BOB,
        _config(family, "missing"),
        error_policy=ErrorPolicy.PLACEHOLDER,
    )
    hidden, hidden_info = await _resolve(
        embeds,
        _HUMAN_BOB,
        _config(family, "private"),
        error_policy=ErrorPolicy.PLACEHOLDER,
    )
    assert "secret" not in str(hidden)
    assert str(hidden).replace("private", "missing") == str(unknown)
    assert [e.replace("private", "missing") for e in hidden_info.errors] == (
        unknown_info.errors
    )


@pytest.mark.parametrize("family", _FAMILIES)
async def test_owner_and_shared_agents_resolve(embeds, policy, family):
    resolved, _ = await _resolve(embeds, _HUMAN_ALICE, _config(family, "private"))
    assert resolved["embedded"]["parameters"]["system_prompt"] == "secret of private"

    resolved, _ = await _resolve(embeds, _HUMAN_BOB, _config(family, "shared"))
    assert resolved["embedded"]["parameters"]["system_prompt"] == "secret of shared"


async def test_without_a_request_principal_the_embed_is_hidden(embeds, policy):
    with pytest.raises(EmbedNotFoundError):
        await _resolve(embeds, None, _config("workflow", "shared"))
    assert policy.calls == []


async def test_one_check_per_embed_and_none_without_embeds(embeds, policy):
    await _resolve(embeds, _HUMAN_BOB, {"parameters": {"model": "gpt-4"}})
    assert policy.calls == []

    configuration = {
        "a": _config("workflow", "shared")["embedded"],
        "b": _config("application", "shared")["embedded"],
    }
    await _resolve(embeds, _HUMAN_BOB, configuration)
    assert len(policy.calls) == 2
    assert {call[3].id for call in policy.calls} == {str(_SHARED)}
    assert all(UUID(str(call[2])) == _PROJECT for call in policy.calls)
