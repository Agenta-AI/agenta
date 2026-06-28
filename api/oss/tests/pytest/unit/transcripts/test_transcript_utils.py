"""Unit tests for core/sessions/transcripts/utils.py.

Covers:
- strip_replay: idempotent, only strips the replay prefix, leaves real content intact
- coalesce_events: chunk folding, empty agent_message dropping
"""

from oss.src.core.sessions.transcripts.utils import (
    REPLAY_PREFIX,
    coalesce_events,
    strip_replay,
)


# ---------------------------------------------------------------------------
# strip_replay
# ---------------------------------------------------------------------------


class TestStripReplay:
    def test_none_returns_none(self):
        assert strip_replay(None) is None

    def test_no_messages_unchanged(self):
        payload = {"foo": "bar"}
        assert strip_replay(payload) == {"foo": "bar"}

    def test_no_replay_block_unchanged(self):
        payload = {
            "messages": [
                {"role": "user", "content": "Hello, agent!"},
            ]
        }
        result = strip_replay(payload)
        assert result == payload

    def test_strips_string_replay_message(self):
        payload = {
            "messages": [
                {"role": "user", "content": f"{REPLAY_PREFIX}prior context..."},
                {"role": "user", "content": "Real question"},
            ]
        }
        result = strip_replay(payload)
        assert result["messages"] == [
            {"role": "user", "content": "Real question"},
        ]

    def test_strips_replay_block_in_list_content(self):
        payload = {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": f"{REPLAY_PREFIX}old context"},
                        {"type": "text", "text": "Real question"},
                    ],
                }
            ]
        }
        result = strip_replay(payload)
        assert result["messages"][0]["content"] == [
            {"type": "text", "text": "Real question"},
        ]

    def test_drops_message_when_all_content_blocks_are_replay(self):
        payload = {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": f"{REPLAY_PREFIX}all replay"},
                    ],
                },
                {"role": "user", "content": "Keep me"},
            ]
        }
        result = strip_replay(payload)
        assert len(result["messages"]) == 1
        assert result["messages"][0]["content"] == "Keep me"

    def test_idempotent(self):
        payload = {
            "messages": [
                {"role": "user", "content": "Just a normal message"},
            ]
        }
        once = strip_replay(payload)
        twice = strip_replay(once)
        assert once == twice

    def test_replay_already_stripped_is_unchanged(self):
        """Calling strip_replay on already-clean payload returns the same structure."""
        payload = {
            "messages": [
                {"role": "user", "content": "Clean message"},
            ]
        }
        result = strip_replay(strip_replay(payload))
        assert result == payload

    def test_preserves_other_payload_fields(self):
        payload = {
            "model": "gpt-4o",
            "messages": [
                {"role": "user", "content": f"{REPLAY_PREFIX}old"},
                {"role": "user", "content": "new"},
            ],
        }
        result = strip_replay(payload)
        assert result["model"] == "gpt-4o"
        assert len(result["messages"]) == 1

    def test_non_list_content_kept(self):
        payload = {
            "messages": [
                {"role": "user", "content": {"weird": "dict"}},
            ]
        }
        result = strip_replay(payload)
        assert result == payload


# ---------------------------------------------------------------------------
# coalesce_events
# ---------------------------------------------------------------------------


def _evt(update: str, text: str = "", **kwargs):
    return {
        "session_update": update,
        "payload": {"text": text},
        **kwargs,
    }


class TestCoalesceEvents:
    def test_empty_list(self):
        assert coalesce_events([]) == []

    def test_no_chunks_unchanged(self):
        events = [
            _evt("user_message", "hello"),
            _evt("agent_message", "world"),
        ]
        assert coalesce_events(events) == events

    def test_single_chunk_becomes_agent_message(self):
        events = [_evt("agent_message_chunk", "hello")]
        result = coalesce_events(events)
        assert len(result) == 1
        assert result[0]["session_update"] == "agent_message"
        assert result[0]["payload"]["text"] == "hello"

    def test_multiple_chunks_merged(self):
        events = [
            _evt("agent_message_chunk", "foo"),
            _evt("agent_message_chunk", " bar"),
            _evt("agent_message_chunk", " baz"),
        ]
        result = coalesce_events(events)
        assert len(result) == 1
        assert result[0]["session_update"] == "agent_message"
        assert result[0]["payload"]["text"] == "foo bar baz"

    def test_chunks_flushed_before_next_event(self):
        events = [
            _evt("user_message", "Q"),
            _evt("agent_message_chunk", "A"),
            _evt("agent_message_chunk", "nswer"),
            _evt("tool_call"),
        ]
        result = coalesce_events(events)
        assert len(result) == 3
        assert result[0]["session_update"] == "user_message"
        assert result[1]["session_update"] == "agent_message"
        assert result[1]["payload"]["text"] == "Answer"
        assert result[2]["session_update"] == "tool_call"

    def test_empty_agent_message_dropped(self):
        events = [
            _evt("agent_message", ""),  # empty sentinel
            _evt("agent_message", "real response"),
        ]
        result = coalesce_events(events)
        assert len(result) == 1
        assert result[0]["payload"]["text"] == "real response"

    def test_empty_chunk_sequence_produces_nothing(self):
        """Chunks with no text content → empty combined text → nothing stored."""
        events = [
            _evt("agent_message_chunk", ""),
            _evt("agent_message_chunk", ""),
        ]
        result = coalesce_events(events)
        assert result == []

    def test_non_agent_events_preserved(self):
        events = [
            {"session_update": "tool_result", "payload": {"data": 123}},
        ]
        result = coalesce_events(events)
        assert result == events

    def test_multiple_chunk_runs_in_one_list(self):
        events = [
            _evt("agent_message_chunk", "first"),
            _evt("user_message", "mid"),
            _evt("agent_message_chunk", "second"),
        ]
        result = coalesce_events(events)
        assert len(result) == 3
        assert result[0]["payload"]["text"] == "first"
        assert result[0]["session_update"] == "agent_message"
        assert result[1]["session_update"] == "user_message"
        assert result[2]["payload"]["text"] == "second"
        assert result[2]["session_update"] == "agent_message"
