"""NUL stripping of record bodies at the producer boundary (`_strip_nul`).

Postgres stores neither `text` nor `jsonb` containing U+0000, so one NUL anywhere in a record
body fails the INSERT with `UntranslatableCharacterError` (SQLSTATE 22P05). Record bodies carry
arbitrary tool output, so a NUL is reachable from ordinary use — a `grep` over a binary file —
and by the time the write fails the record is already off the runner, so the batch can only be
redelivered. One such record (a `tool_result` holding console output) held the records stream in
a 30s redelivery loop for over a day.

These pin that the character never reaches the stream, and that the cheap escape scan guarding
the walk actually fires.
"""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import zlib

from orjson import dumps, loads

from oss.src.core.sessions.records.dtos import SessionRecordEvent
from oss.src.core.sessions.records.streaming import (
    _NUL_ESCAPE,
    MAX_ATTRIBUTES_BYTES,
    _strip_nul,
    _TRUNCATION_MARKER,
    publish_record,
)


def test_orjson_escapes_nul_as_the_scanned_escape():
    """`publish_record` only walks a body whose serialized form contains `_NUL_ESCAPE`. If
    orjson ever stopped emitting exactly that, the guard would silently stop firing and the
    poison loop would come back, so pin the encoding itself."""
    assert _NUL_ESCAPE in dumps({"text": "a\x00b"})


def test_strips_nul_from_string_values():
    assert _strip_nul({"text": "a\x00b"}) == {"text": "ab"}


def test_strips_nul_from_nested_containers():
    body = {
        "type": "tool_result",
        "output": ["clean", "no\x00pe"],
        "meta": {"inner": "x\x00y"},
    }
    assert _strip_nul(body) == {
        "type": "tool_result",
        "output": ["clean", "nope"],
        "meta": {"inner": "xy"},
    }


def test_strips_nul_from_dict_keys():
    # A key is as fatal as a value: the whole `jsonb` document is rejected either way.
    assert _strip_nul({"k\x00ey": "value"}) == {"key": "value"}


def test_leaves_non_string_leaves_alone():
    body = {"type": "usage", "total": 17, "cost": 1.5, "ok": True, "none": None}
    assert _strip_nul(body) == body


def test_clean_body_is_unchanged():
    body = {"type": "message", "text": "hello"}
    assert _strip_nul(body) == body


async def _published_attributes(attributes):
    """Run `publish_record` against a mock Redis and return what landed on the stream."""
    redis = AsyncMock()
    project_id = uuid4()
    record = SessionRecordEvent(
        project_id=project_id,
        session_id="session-1",
        record_type="tool_result",
        attributes=attributes,
    )
    with patch(
        "oss.src.core.sessions.records.streaming._get_redis", return_value=redis
    ):
        assert await publish_record(project_id=project_id, record_event=record)

    payload = redis.xadd.await_args.kwargs["fields"]["data"]
    return loads(zlib.decompress(payload))["record_event"]["attributes"]


async def test_published_record_carries_no_nul():
    attributes = await _published_attributes(
        {"type": "tool_result", "id": "call-1", "output": "```console\na\x00b\n```"}
    )
    # The record still reaches the stream — stripping a character must not drop the transcript.
    assert attributes["id"] == "call-1"
    assert attributes["output"] == "```console\nab\n```"
    assert _NUL_ESCAPE not in dumps(attributes)


async def test_nul_is_stripped_before_the_size_check():
    """Stripping runs first so truncation measures the body that will actually be stored."""
    padding = "p" * (MAX_ATTRIBUTES_BYTES * 2)
    attributes = await _published_attributes(
        {"type": "tool_result", "id": "call-2", "output": "\x00" + padding}
    )
    assert attributes["id"] == "call-2"
    assert attributes["output"].endswith(_TRUNCATION_MARKER)
    assert _NUL_ESCAPE not in dumps(attributes)
