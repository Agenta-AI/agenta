"""The shared-session guard in the selection path (M7, design D6)."""

from uuid import uuid4

import pytest

import oss.src.core.credentials.policy as policy_module
import oss.src.core.credentials.selection as selection
from oss.src.core.access.dtos import PrincipalKind, PrincipalRef, RunAuthority
from oss.src.core.credentials.policy import PersonalCredentialRefused


@pytest.fixture(autouse=True)
def _open_gate(monkeypatch):
    monkeypatch.setattr(
        policy_module.env.agenta.access, "personal_credentials_enabled", True
    )
    monkeypatch.setattr(policy_module, "is_ee", lambda: False)
    yield
    selection.set_personal_use_guard(None)


def _authority(kind=PrincipalKind.HUMAN, linked_user_id=None):
    return RunAuthority(
        principal=PrincipalRef(kind=kind, id=uuid4()),
        organization_id=uuid4(),
        project_id=uuid4(),
        linked_user_id=linked_user_id,
    )


class _Guard:
    def __init__(self, answer):
        self.answer = answer
        self.calls = 0

    async def __call__(self, *, project_id, session_id):
        self.calls += 1
        return self.answer


async def _select(authority, session_id):
    async def read(user_id):
        return f"key-of-{user_id}"

    return await selection.select_personal_credential(
        authority=authority, label="Gmail", read=read, session_id=session_id
    )


async def test_a_private_session_uses_the_key_and_is_checked_once():
    guard = _Guard(True)
    selection.set_personal_use_guard(guard)
    authority = _authority()
    assert await _select(authority, "s-1") == f"key-of-{authority.principal.id}"
    await _select(authority, "s-1")
    # The mark never clears, so the second use needs no lock.
    assert guard.calls == 1


async def test_a_shared_session_refuses_with_the_spec_sentence():
    selection.set_personal_use_guard(_Guard(False))
    with pytest.raises(PersonalCredentialRefused) as refused:
        await _select(_authority(), "s-shared")
    assert refused.value.code == "shared_session"
    assert refused.value.message == (
        "This conversation is shared. Gmail is set to use each person's own account, "
        "which shared conversations cannot use."
    )


async def test_without_a_guard_a_session_is_refused():
    selection.set_personal_use_guard(None)
    with pytest.raises(PersonalCredentialRefused):
        await _select(_authority(), "s-1")


async def test_a_channel_turn_skips_the_guard():
    guard = _Guard(False)
    selection.set_personal_use_guard(guard)
    linked = uuid4()
    channel = _authority(PrincipalKind.INSTALLATION, linked_user_id=linked)
    assert await _select(channel, "s-channel") == f"key-of-{linked}"
    assert guard.calls == 0


async def test_a_run_with_no_private_conversation_is_refused_before_any_read(
    monkeypatch,
):
    """An evaluation, a direct call, or a child of a run with no conversation leaves
    output in project traces. Refused before the policy, the credential or the guard
    is read."""
    guard = _Guard(True)
    selection.set_personal_use_guard(guard)

    async def no_policy_read(**kwargs):
        raise AssertionError("the policy must not be read")

    async def no_credential_read(user_id):
        raise AssertionError("the credential must not be read")

    monkeypatch.setattr(selection, "check_personal_credentials_allowed", no_policy_read)
    with pytest.raises(PersonalCredentialRefused) as refused:
        await selection.select_personal_credential(
            authority=_authority(), label="Gmail", read=no_credential_read
        )
    assert refused.value.code == "no_private_conversation"
    assert guard.calls == 0


def test_a_child_run_has_no_protection_session():
    from types import SimpleNamespace

    from oss.src.core.access.context import reset_request_access, set_request_access
    from oss.src.core.workflows.service import _protection_session
    from oss.tests.pytest.utils.principals import make_envelope, make_request_access

    request = SimpleNamespace(session_id="s-child")
    # Not under a run: the request's own session.
    assert _protection_session(request) == "s-child"

    access = make_request_access(
        envelope=make_envelope(kind="human"), credential_kind="run_credential"
    )
    # A child run has no private conversation of its own in this step: refused.
    for parent_session, expected in (
        ("s-parent", None),
        (None, None),
    ):
        token = set_request_access(
            access.model_copy(update={"session_id": parent_session})
        )
        try:
            assert _protection_session(request) == expected
        finally:
            reset_request_access(token)


async def test_a_personal_use_is_recorded_once_per_run_and_connection():
    from types import SimpleNamespace  # noqa: PLC0415

    from oss.src.core.credentials.bindings import ConnectionKey  # noqa: PLC0415

    selection.set_personal_use_guard(_Guard(True))
    recorded = []

    async def recorder(*, project_id, use):
        recorded.append((project_id, use))

    selection.set_use_recorder(recorder)
    authority = _authority()
    key = ConnectionKey(kind="model", service="openai")
    found = SimpleNamespace(id=uuid4(), header=SimpleNamespace(name="OpenAI"))

    async def read(user_id):
        return found

    for _ in range(3):
        await selection.select_personal_credential(
            authority=authority,
            label="OpenAI",
            read=read,
            session_id="s-1",
            key=key,
            run_id="run-1",
        )
    try:
        assert len(recorded) == 1
        project_id, use = recorded[0]
        assert project_id == authority.project_id
        assert use.connection_key == "model:openai"
        assert use.owner_id == authority.principal.id
        assert use.credential_id == found.id
        assert use.credential_name == "OpenAI"
        assert use.binding == "caller_account"
    finally:
        selection.set_use_recorder(None)
