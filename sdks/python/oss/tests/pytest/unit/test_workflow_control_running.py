"""
The session-control matrix folded into the single invoke command:

    run-vs-control axis = presence of `data.inputs`
    takeover axis       = `request.flags.force` (invoke-plane twin of this PoC's
                          own `control` axis below; see specs.md "Out of scope")

    | data.inputs | control | behavior |
    | present     | False   | send   (run a turn)            |
    | present     | True    | steer  (take over + run)       |
    | missing     | False   | cancel (stop the live run)     |
    | missing     | True    | attach (adopt/watch live run)  |

`data.inputs` distinguishes three states that MUST survive the wire:
    {}        -> a real run of a no-arg workflow  (present, empty)
    {...}     -> a normal turn                    (present)
    missing   -> no turn -> a control call        (absent; not null, not {})

This is an EXECUTABLE SPEC, not shipped code. Real session control needs a
server-owned run/session store (Redis alive/attached locks + a durable
transcript) which `application` does not have yet — so the dispatch logic lives
HERE in the test (a PoC), driven against an in-memory fake store, NOT in the SDK.
It pins the matrix so the real implementation has a target.
"""

import asyncio

import pytest

from agenta.sdk.models.workflows import WorkflowServiceRequest


# PoC control dispatch — local to the test (NOT SDK code); proves the matrix logic only.
class ControlConflict(Exception):
    """A turn sent to a session with a live run and no takeover -> HTTP 409."""


async def dispatch(*, session_id, inputs_present, control, store, run=None):
    row = store.row(session_id)
    alive = bool(row.get("alive"))

    if inputs_present:
        if not alive:
            row["token"] = row.get("token", 0) + 1
            await _launch(row, run)
            return "send"
        if not control:
            raise ControlConflict(f"session {session_id} has a live run")
        _cancel(row)
        row["token"] = row.get("token", 0) + 1
        await _launch(row, run)
        return "steer"

    if control:
        row["attached"] = True
        return "attach"

    _cancel(row)
    row["alive"] = False
    return "cancel"


def detach(*, session_id, store):
    """Client disconnect: drop the watch; the run keeps going."""
    store.row(session_id)["attached"] = False
    return "detach"


async def _launch(row, run):
    if run is None:
        return
    task = asyncio.ensure_future(run())
    row["cancel"] = task.cancel
    await asyncio.sleep(0)  # let the run reach its first await


def _cancel(row):
    cancel = row.get("cancel")
    if callable(cancel):
        cancel()


# The run-vs-control axis: missing inputs != empty inputs must survive the model
def test_missing_inputs_distinct_from_empty_inputs():
    run_no_args = WorkflowServiceRequest(data={"inputs": {}})
    control_call = WorkflowServiceRequest(data={})  # inputs omitted

    # after round-tripping through the model, the two must remain distinguishable
    run_dump = run_no_args.model_dump(exclude_none=False)
    ctl_dump = control_call.model_dump(exclude_none=False)

    run_inputs = run_dump["data"]["inputs"]
    ctl_inputs = ctl_dump["data"]["inputs"]

    assert run_inputs == {}, "no-arg run keeps inputs={}"
    assert ctl_inputs is None or "inputs" not in ctl_dump["data"], (
        "control call has no inputs"
    )
    assert run_inputs != ctl_inputs, "missing-vs-empty must not collapse"


# Behavior matrix — store-driven, against a concurrent slow run (see docstring table above).


class _FakeSessionStore:
    """In-memory session store (the durable Postgres/Redis store stays out of the
    SDK; production injects a real one). Rows: {alive, attached, token, cancel}."""

    def __init__(self):
        self._rows: dict = {}

    def row(self, sid: str) -> dict:
        return self._rows.setdefault(
            sid, {"alive": False, "attached": False, "token": 0, "cancel": None}
        )


@pytest.mark.asyncio
async def test_send_on_idle_session_marks_alive_and_increments_token():
    store = _FakeSessionStore()
    started = asyncio.Event()

    async def slow_run():
        store.row("s1")["alive"] = True
        started.set()
        await asyncio.Event().wait()  # stays alive until cancelled

    action = await dispatch(
        session_id="s1",
        inputs_present=True,
        control=False,
        store=store,
        run=slow_run,
    )
    await started.wait()

    assert action == "send"
    assert store.row("s1")["alive"] is True
    assert store.row("s1")["token"] == 1


@pytest.mark.asyncio
async def test_send_collision_when_alive_without_control_is_409():
    store = _FakeSessionStore()
    store.row("s1")["alive"] = True

    with pytest.raises(ControlConflict):
        await dispatch(
            session_id="s1", inputs_present=True, control=False, store=store, run=None
        )


@pytest.mark.asyncio
async def test_steer_cancels_alive_run_and_restarts():
    store = _FakeSessionStore()
    row = store.row("s1")
    row["alive"] = True
    row["token"] = 1
    cancelled = {"v": False}
    row["cancel"] = lambda: cancelled.__setitem__("v", True)

    async def new_run():
        store.row("s1")["alive"] = True

    action = await dispatch(
        session_id="s1", inputs_present=True, control=True, store=store, run=new_run
    )

    assert action == "steer"
    assert cancelled["v"] is True
    assert store.row("s1")["token"] == 2


@pytest.mark.asyncio
async def test_cancel_marks_dead():
    store = _FakeSessionStore()
    row = store.row("s1")
    row["alive"] = True
    cancelled = {"v": False}
    row["cancel"] = lambda: cancelled.__setitem__("v", True)

    action = await dispatch(
        session_id="s1", inputs_present=False, control=False, store=store, run=None
    )

    assert action == "cancel"
    assert store.row("s1")["alive"] is False
    assert cancelled["v"] is True


@pytest.mark.asyncio
async def test_attach_to_alive_detached_run():
    store = _FakeSessionStore()
    row = store.row("s1")
    row["alive"] = True
    row["attached"] = False

    action = await dispatch(
        session_id="s1", inputs_present=False, control=True, store=store, run=None
    )

    assert action == "attach"
    assert store.row("s1")["attached"] is True
    assert store.row("s1")["alive"] is True  # attaching never changes run status


@pytest.mark.asyncio
async def test_detach_on_client_disconnect_keeps_run_alive():
    store = _FakeSessionStore()
    row = store.row("s1")
    row["alive"] = True
    row["attached"] = True

    detach(session_id="s1", store=store)

    assert store.row("s1")["attached"] is False
    assert store.row("s1")["alive"] is True  # disconnect != cancel
