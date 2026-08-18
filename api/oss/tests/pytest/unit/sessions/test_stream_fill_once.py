"""A session gets a title and its references from the run itself, exactly once.

Before this, the browser was the only component that ever wrote a session name and the
only reliable writer of a complete reference set: 98.6% of sessions were untitled and
every untitled one was created headlessly (runner beat or trigger dispatch), so no
browser ever rendered it. The fix lets the beat propose both, under one rule — write
only where the column is still NULL.

The rule cuts both ways, and both directions are pinned here: a beat must be able to
title a session nothing else will, and a beat must never touch a name a human (rename,
`rename_session`) or the browser auto-title already set.
"""

from typing import Optional
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio

from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionStream,
    SessionStreamCommandRequest,
    SessionStreamHeaderEdit,
)
from oss.src.core.sessions.streams.service import (
    SESSION_NAME_MAX_CHARS,
    SessionStreamsService,
    derive_session_name,
    normalize_session_name,
)
from oss.src.core.sessions.types import ReferenceKey, SessionReference

from unit.sessions.test_project_scoped_locks import _FakeRedis


_PROJECT = uuid4()
_SESSION = "session_fill_once"


class _FakeStreamsDAO:
    """One in-memory row with the real DAO's fill-once contract.

    `fill_missing` mirrors the real statement's semantics — COALESCE per column behind a
    NULL guard — so a service-level test asserts the same rule the SQL enforces.
    """

    def __init__(self, existing: Optional[SessionStream] = None):
        self.row = existing
        self.fills: list[dict] = []

    async def get_by_session_id(self, *, project_id: UUID, session_id: str):
        return self.row

    async def create(self, *, project_id, user_id, stream):
        kwargs = dict(
            id=uuid4(),
            project_id=project_id,
            session_id=stream.session_id,
            name=stream.name,
            description=stream.description,
            turn_id=stream.turn_id,
            references=stream.references,
        )
        if stream.flags is not None:
            kwargs["flags"] = stream.flags
        self.row = SessionStream(**kwargs)
        return self.row

    async def update(self, *, project_id, user_id, session_id, stream):
        prior = self.row
        self.row = SessionStream(
            id=prior.id if prior else uuid4(),
            project_id=project_id,
            session_id=session_id,
            name=stream.name
            if stream.name is not None
            else (prior.name if prior else None),
            flags=stream.flags
            if stream.flags is not None
            else (prior.flags if prior else None),
            turn_id=stream.turn_id
            if stream.turn_id is not None
            else (prior.turn_id if prior else None),
            references=prior.references if prior else None,
        )
        return self.row

    async def update_header(self, *, project_id, user_id, session_id, header):
        if self.row is None:
            return None
        prior = self.row
        self.row = prior.model_copy(
            update={
                "name": header.name if header.name is not None else prior.name,
                "description": header.description
                if header.description is not None
                else prior.description,
            }
        )
        return self.row

    async def fill_missing(
        self, *, project_id, session_id, name=None, references=None
    ) -> bool:
        self.fills.append({"name": name, "references": references})
        if self.row is None:
            return False
        update = {}
        # Truthiness, like the real statement: an empty proposal is not a proposal.
        if name and self.row.name is None:
            update["name"] = name
        if references and self.row.references is None:
            update["references"] = references
        if not update:
            return False
        self.row = self.row.model_copy(update=update)
        return True

    async def delete_by_session_id(self, *, project_id, session_id):
        return True


@pytest_asyncio.fixture
async def lock_engine():
    from oss.src.dbs.redis.shared.engine import LockEngine

    eng = LockEngine()
    with patch.object(eng, "_client", return_value=_FakeRedis()):
        yield eng


def _service(lock_engine, dao):
    return SessionStreamsService(streams_dao=dao, lock_engine=lock_engine)


def _beat(turn: str, *, name=None, references=None) -> SessionHeartbeatRequest:
    return SessionHeartbeatRequest(
        session_id=_SESSION,
        replica_id="replica-a",
        turn_id=turn,
        is_running=True,
        name=name,
        references=references,
    )


def _references() -> list[SessionReference]:
    return [
        SessionReference(id=uuid4(), slug="wf", key=ReferenceKey.workflow),
        SessionReference(id=uuid4(), slug="wf-var", key=ReferenceKey.workflow_variant),
    ]


# ---------------------------------------------------------------------------
# Normalization: what a proposal is worth before it reaches the row.
# ---------------------------------------------------------------------------


def test_a_proposal_is_trimmed_and_capped():
    assert normalize_session_name("  Migrate billing  ") == "Migrate billing"
    assert len(normalize_session_name("x" * 500)) == SESSION_NAME_MAX_CHARS


def test_a_blank_proposal_is_no_proposal_not_a_clear():
    # An empty name is the explicit clear-title action on the rename path; a beat must
    # never be able to express it, or an idle runner would erase a title.
    assert normalize_session_name("   ") is None
    assert normalize_session_name("") is None
    assert normalize_session_name(None) is None


def test_the_title_is_the_first_user_message_like_the_browser():
    inputs = {
        "messages": [
            {"role": "system", "content": "ignored"},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Run the"},
                    {"type": "image", "url": "http://x"},
                    {"type": "text", "text": "migration"},
                ],
            },
            {"role": "user", "content": "second message, never used"},
        ]
    }
    assert derive_session_name(inputs) == "Run the migration"


def test_an_image_only_first_message_yields_no_title():
    # Matches the browser, which keeps only `type === "text"` parts and gives up on "".
    inputs = {
        "messages": [{"role": "user", "content": [{"type": "image", "url": "u"}]}]
    }
    assert derive_session_name(inputs) is None
    assert derive_session_name({"messages": []}) is None
    assert derive_session_name(None) is None


# ---------------------------------------------------------------------------
# The beat fills a NULL, on the row it creates and on one that already exists.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_beat_that_creates_the_row_titles_it(lock_engine):
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)

    result = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("turn-1", name="Nightly changelog")
    )

    assert result.stream.name == "Nightly changelog"


@pytest.mark.asyncio
async def test_a_later_beat_fills_a_row_that_is_still_untitled(lock_engine):
    # The row usually exists before the runner has anything to say about it: `_start_turn`
    # or a trigger claim created it. That row is exactly the untitled population.
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))
    assert dao.row.name is None

    result = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("turn-1", name="Filled later")
    )

    assert result.stream.name == "Filled later"


@pytest.mark.asyncio
async def test_a_beat_never_overwrites_an_existing_title(lock_engine):
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)
    await svc.set_header(
        project_id=_PROJECT,
        user_id=None,
        session_id=_SESSION,
        header=SessionStreamHeaderEdit(name="Named by a human"),
    )

    result = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("turn-1", name="Proposed by the runner")
    )

    assert result.stream.name == "Named by a human"
    assert dao.row.name == "Named by a human"


@pytest.mark.asyncio
async def test_a_rename_after_a_fill_still_wins(lock_engine):
    # The fill is not a claim on the name: renaming overwrites, so the user is never
    # fighting the runner for the title.
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1", name="Auto title"))

    await svc.set_header(
        project_id=_PROJECT,
        user_id=None,
        session_id=_SESSION,
        header=SessionStreamHeaderEdit(name="My title"),
    )
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1", name="Auto title"))

    assert dao.row.name == "My title"


@pytest.mark.asyncio
async def test_the_proposal_repeats_on_every_beat_without_repeating_the_write(
    lock_engine,
):
    """The runner re-proposes the same name on every beat, including the final
    is_running=false release beat. Filling is idempotent, and once the row holds a value
    the service stops issuing the write at all rather than paying a no-op UPDATE per beat
    per session."""
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1", name="Same title"))
    writes_after_first = len(dao.fills)
    for _ in range(3):
        await svc.heartbeat(
            project_id=_PROJECT, request=_beat("turn-1", name="Same title")
        )
    await svc.heartbeat(
        project_id=_PROJECT,
        request=SessionHeartbeatRequest(
            session_id=_SESSION,
            replica_id="replica-a",
            turn_id="turn-1",
            is_running=False,
            name="Same title",
        ),
    )

    assert dao.row.name == "Same title"
    assert len(dao.fills) == writes_after_first


@pytest.mark.asyncio
async def test_a_beat_without_a_proposal_does_not_touch_the_row(lock_engine):
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))

    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))

    assert dao.fills == [], "a beat with nothing to say must not issue a write"


# ---------------------------------------------------------------------------
# The same rule, applied to references.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_beat_records_what_the_session_runs(lock_engine):
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)
    references = _references()

    result = await svc.heartbeat(
        project_id=_PROJECT, request=_beat("turn-1", references=references)
    )

    assert result.stream.references == references
    assert result.stream.references[0].key == "workflow"


@pytest.mark.asyncio
async def test_references_fill_a_row_that_has_none_and_are_then_frozen(lock_engine):
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1"))
    first = _references()
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1", references=first))

    later = [SessionReference(id=uuid4(), key=ReferenceKey.workflow)]
    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-2", references=later))

    assert dao.row.references == first


@pytest.mark.asyncio
async def test_an_empty_reference_list_does_not_burn_the_fill(lock_engine):
    """A beat that has nothing to attribute must leave the slot open.

    Each column is fillable exactly once, so storing `[]` would spend that one chance and
    make the real references arriving on a later beat un-writable — the session would stay
    unopenable for the reason the column exists to prevent.
    """
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1", references=[]))
    assert dao.row.references is None

    references = _references()
    await svc.heartbeat(
        project_id=_PROJECT, request=_beat("turn-2", references=references)
    )

    assert dao.row.references == references


@pytest.mark.asyncio
async def test_an_empty_name_does_not_burn_the_fill(lock_engine):
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)

    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1", name="   "))
    assert dao.row.name is None

    await svc.heartbeat(
        project_id=_PROJECT, request=_beat("turn-2", name="A real title")
    )

    assert dao.row.name == "A real title"


@pytest.mark.asyncio
async def test_a_title_fill_leaves_existing_references_alone(lock_engine):
    # The two columns are filled independently: a beat carrying only a name must not
    # reset references, and vice versa.
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)
    references = _references()
    await svc.heartbeat(
        project_id=_PROJECT, request=_beat("turn-1", references=references)
    )

    await svc.heartbeat(project_id=_PROJECT, request=_beat("turn-1", name="A title"))

    assert dao.row.references == references
    assert dao.row.name == "A title"


# ---------------------------------------------------------------------------
# The browser send path fills from its own inputs.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_send_titles_the_session_from_its_inputs(lock_engine):
    # The client's auto-title effect is fire-and-forget with no retry; deriving the same
    # title server-side means a dropped PUT no longer leaves the session nameless.
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)

    await svc.command(
        project_id=_PROJECT,
        user_id=uuid4(),
        request=SessionStreamCommandRequest(
            session_id=_SESSION,
            data={"inputs": {"messages": [{"role": "user", "content": "Ship it"}]}},
        ),
    )

    assert dao.row.name == "Ship it"


@pytest.mark.asyncio
async def test_a_send_on_a_named_session_keeps_the_name(lock_engine):
    dao = _FakeStreamsDAO()
    svc = _service(lock_engine, dao)
    await svc.set_header(
        project_id=_PROJECT,
        user_id=None,
        session_id=_SESSION,
        header=SessionStreamHeaderEdit(name="Kept"),
    )

    await svc.command(
        project_id=_PROJECT,
        user_id=uuid4(),
        request=SessionStreamCommandRequest(
            session_id=_SESSION,
            data={"inputs": {"messages": [{"role": "user", "content": "Ship it"}]}},
        ),
    )

    assert dao.row.name == "Kept"
