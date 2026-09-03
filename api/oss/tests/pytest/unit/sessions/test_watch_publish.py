"""M3 live relay — publish side (T1).

The records worker tees a change notification onto the per-session watch channel
strictly AFTER `append_many` commits, once per distinct (project, session) in the
batch. Publishing is fire-and-forget: an append failure publishes nothing (there
is nothing new to see), and a publish failure never fails the worker loop (the
DB write is already committed and must not be re-driven by relay errors).
"""

import json
import zlib
from inspect import Parameter, signature
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from orjson import dumps

from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.streams.dtos import SessionStreamHeaderEdit
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.watch.interfaces import SessionsWatchPublisherInterface
from oss.src.core.sessions.records.dtos import SessionRecord, SessionRecordsAppendResult
from oss.src.core.workflows.dtos import Workflow, WorkflowEdit
from oss.src.core.workflows.service import WorkflowsService
from oss.src.dbs.redis.sessions.contract import project_watch_channel, watch_channel
from oss.src.dbs.redis.sessions.watch import SessionsWatchPublisher
from oss.src.tasks.asyncio.sessions.records_worker import RecordsWorker


def _payload(*, project_id, session_id, record_index=0):
    message = {
        "organization_id": None,
        "project_id": str(project_id),
        "record_event": {
            "project_id": str(project_id),
            "session_id": session_id,
            "record_index": record_index,
        },
    }
    return zlib.compress(dumps(message))


class _RecordingPublisher:
    """Watch-publisher fake that records calls; `fail=True` simulates a broken relay."""

    def __init__(self, *, fail: bool = False, journal=None):
        self.calls: list[tuple[str, str]] = []
        self.changed_calls: list[tuple[str, str, str]] = []
        self.fail = fail
        self.journal = journal

    async def records_changed(self, *, project_id: str, session_id: str) -> None:
        if self.fail:
            raise RuntimeError("relay down")
        self.calls.append((project_id, session_id))
        if self.journal is not None:
            self.journal.append(("publish", session_id))

    async def changed(self, *, project_id: str, entity: str, id: str) -> None:
        if self.fail:
            raise RuntimeError("relay down")
        self.changed_calls.append((project_id, entity, id))


def _worker(records_dao, publisher):
    return RecordsWorker(
        service=RecordsService(records_dao=records_dao),
        redis_client=None,
        stream_name="streams:records",
        consumer_group="worker-records",
        watch_publisher=publisher,
    )


@pytest.mark.asyncio
async def test_worker_publishes_once_per_session_after_append():
    project_id = uuid4()
    journal: list = []

    records_dao = AsyncMock()

    async def _append_many(*, events):
        journal.append(("append", len(events)))
        return SessionRecordsAppendResult(
            records=[
                SessionRecord(
                    record_id=uuid4(), session_id=e.session_id, project_id=project_id
                )
                for e in events
            ]
        )

    records_dao.append_many = AsyncMock(side_effect=_append_many)

    publisher = _RecordingPublisher(journal=journal)
    worker = _worker(records_dao, publisher)

    batch = [
        (b"1-0", {b"data": _payload(project_id=project_id, session_id="sess-a")}),
        (
            b"2-0",
            {
                b"data": _payload(
                    project_id=project_id, session_id="sess-a", record_index=1
                )
            },
        ),
        (b"3-0", {b"data": _payload(project_id=project_id, session_id="sess-b")}),
    ]

    total_appended, processed_ids = await worker.process_batch(batch)

    assert total_appended == 3
    assert len(processed_ids) == 3
    # 2 distinct sessions -> exactly 2 publishes, never one per record.
    assert sorted(publisher.calls) == [
        (str(project_id), "sess-a"),
        (str(project_id), "sess-b"),
    ]
    # Strict ordering: the append committed before any publish fired.
    assert journal[0] == ("append", 3)
    assert all(entry[0] == "publish" for entry in journal[1:])


@pytest.mark.asyncio
async def test_worker_skips_publish_when_append_fails():
    project_id = uuid4()

    records_dao = AsyncMock()
    records_dao.append_many = AsyncMock(side_effect=RuntimeError("db down"))

    publisher = _RecordingPublisher()
    worker = _worker(records_dao, publisher)

    batch = [(b"1-0", {b"data": _payload(project_id=project_id, session_id="s")})]
    total_appended, processed_ids = await worker.process_batch(batch)

    assert total_appended == 0
    assert publisher.calls == []
    # `process_batch` acknowledges at parse time, before the append, so a failed append is still
    # acked and dropped by the shared consumer loop. That predates this change and is shared by
    # every worker on `BaseStreamConsumer`; the relay tee neither causes it nor repairs it. This
    # assertion pins the tee's scope, not an endorsement of the acknowledgement rule.
    assert len(processed_ids) == 1


@pytest.mark.asyncio
async def test_worker_survives_publisher_failure():
    project_id = uuid4()

    records_dao = AsyncMock()
    records_dao.append_many = AsyncMock(
        return_value=SessionRecordsAppendResult(
            records=[
                SessionRecord(record_id=uuid4(), session_id="s", project_id=project_id)
            ]
        )
    )

    worker = _worker(records_dao, _RecordingPublisher(fail=True))

    batch = [(b"1-0", {b"data": _payload(project_id=project_id, session_id="s")})]
    total_appended, processed_ids = await worker.process_batch(batch)

    # The committed append is still counted and acked; relay errors never re-drive it.
    assert total_appended == 1
    assert len(processed_ids) == 1


@pytest.mark.asyncio
async def test_publisher_publishes_on_watch_channel():
    import fakeredis

    redis = fakeredis.FakeAsyncRedis()
    pubsub = redis.pubsub()
    project_id = str(uuid4())
    channel = watch_channel(project_id, "sess-1")
    await pubsub.subscribe(channel)
    await pubsub.get_message(timeout=1)  # drain the subscribe confirmation

    publisher = SessionsWatchPublisher(redis_client=redis)
    await publisher.records_changed(project_id=project_id, session_id="sess-1")

    message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1)
    assert message is not None
    assert json.loads(message["data"]) == {
        "type": "records-changed",
        "session_id": "sess-1",
    }


@pytest.mark.asyncio
async def test_publisher_swallows_redis_failure():
    broken = AsyncMock()
    broken.publish = AsyncMock(side_effect=ConnectionError("redis gone"))

    publisher = SessionsWatchPublisher(redis_client=broken)
    # Must not raise — the relay is strictly best-effort.
    await publisher.records_changed(project_id="p", session_id="s")
    await publisher.lifecycle(project_id="p", session_id="s", state="running")
    await publisher.interaction(project_id="p", session_id="s", status="pending")
    assert broken.publish.await_count == 3


@pytest.mark.asyncio
async def test_publisher_publishes_entity_change_on_project_channel():
    import fakeredis

    redis = fakeredis.FakeAsyncRedis()
    pubsub = redis.pubsub()
    project_id = str(uuid4())
    channel = project_watch_channel(project_id)
    await pubsub.subscribe(channel)
    await pubsub.get_message(timeout=1)

    publisher = SessionsWatchPublisher(redis_client=redis)
    await publisher.changed(project_id=project_id, entity="session", id="session-1")

    message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1)
    assert message is not None
    assert json.loads(message["data"]) == {
        "type": "session-changed",
        "entity": "session",
        "id": "session-1",
    }


def test_changed_signature_is_keyword_only_on_protocol_and_publisher():
    protocol_parameters = list(
        signature(SessionsWatchPublisherInterface.changed).parameters.values()
    )
    assert [parameter.name for parameter in protocol_parameters] == [
        "self",
        "project_id",
        "entity",
        "id",
    ]
    assert all(
        parameter.kind is Parameter.KEYWORD_ONLY
        for parameter in protocol_parameters[1:]
    )

    publisher = SessionsWatchPublisher(redis_client=AsyncMock())
    with pytest.raises(TypeError):
        publisher.changed("project-1", "session", "session-1")


@pytest.mark.asyncio
async def test_set_header_publishes_session_change_with_explicit_project_id():
    project_id = uuid4()
    updated = object()
    streams_dao = AsyncMock()
    streams_dao.update_header.return_value = updated
    publisher = _RecordingPublisher()
    service = SessionStreamsService(
        streams_dao=streams_dao,
        lock_engine=None,
        watch_publisher=publisher,
    )

    result = await service.set_header(
        project_id=project_id,
        user_id=uuid4(),
        session_id="session-1",
        header=SessionStreamHeaderEdit(name="Renamed"),
    )

    assert result is updated
    assert publisher.changed_calls == [
        (str(project_id), "session", "session-1"),
    ]


@pytest.mark.asyncio
async def test_edit_workflow_publishes_workflow_change_with_explicit_project_id(
    monkeypatch,
):
    from oss.src.core.workflows import service as workflows_service_module

    project_id = uuid4()
    workflow_id = uuid4()
    workflow = Workflow(id=workflow_id, slug="workflow")
    workflows_dao = AsyncMock()
    workflows_dao.fetch_artifact.return_value = workflow
    workflows_dao.edit_artifact.return_value = workflow
    publisher = _RecordingPublisher()
    service = WorkflowsService(
        workflows_dao=workflows_dao,
        watch_publisher=publisher,
    )
    monkeypatch.setattr(workflows_service_module, "invalidate_cache", AsyncMock())
    monkeypatch.setattr(workflows_service_module, "set_cache", AsyncMock())

    result = await service.edit_workflow(
        project_id=project_id,
        user_id=uuid4(),
        workflow_edit=WorkflowEdit(id=workflow_id, name="Renamed"),
    )

    assert result is not None
    assert publisher.changed_calls == [
        (str(project_id), "workflow", str(workflow_id)),
    ]


@pytest.mark.asyncio
async def test_change_publisher_failure_does_not_fail_either_write(monkeypatch):
    from oss.src.core.workflows import service as workflows_service_module

    project_id = uuid4()
    publisher = _RecordingPublisher(fail=True)

    streams_dao = AsyncMock()
    streams_dao.update_header.return_value = object()
    streams_service = SessionStreamsService(
        streams_dao=streams_dao,
        lock_engine=None,
        watch_publisher=publisher,
    )
    session_result = await streams_service.set_header(
        project_id=project_id,
        user_id=uuid4(),
        session_id="session-1",
        header=SessionStreamHeaderEdit(name="Renamed"),
    )

    workflow_id = uuid4()
    workflow = Workflow(id=workflow_id, slug="workflow")
    workflows_dao = AsyncMock()
    workflows_dao.fetch_artifact.return_value = workflow
    workflows_dao.edit_artifact.return_value = workflow
    workflows_service = WorkflowsService(
        workflows_dao=workflows_dao,
        watch_publisher=publisher,
    )
    monkeypatch.setattr(workflows_service_module, "invalidate_cache", AsyncMock())
    monkeypatch.setattr(workflows_service_module, "set_cache", AsyncMock())
    workflow_result = await workflows_service.edit_workflow(
        project_id=project_id,
        user_id=uuid4(),
        workflow_edit=WorkflowEdit(id=workflow_id, name="Renamed"),
    )

    assert session_result is not None
    assert workflow_result is not None
