"""Unit tests for how a subscription's event reaches the agent's inputs:
``compose_event_inputs``, ``format_event_text``, and the two new data fields.

The value fixtures and the shared example match the web preview tests, so the
dispatcher and the preview give the same text.
"""

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from oss.src.core.triggers.dtos import (
    TriggerSubscriptionData,
    TriggerSubscriptionEdit,
)
from oss.src.core.triggers.utils import compose_event_inputs, format_event_text
from oss.src.dbs.postgres.triggers.dbes import TriggerSubscriptionDBE
from oss.src.dbs.postgres.triggers.mappings import (
    map_subscription_dbe_to_dto,
    map_subscription_dto_to_dbe_edit,
)

_ATTRIBUTES = {"action": "opened", "number": 42, "title": "Fix the login page"}
_CONTEXT = {
    "event": {
        "event_id": "evt_1",
        "event_type": "GITHUB_PULL_REQUEST_EVENT",
        "attributes": _ATTRIBUTES,
    }
}
# The shared example of design decision 3.
_EVENT_TEXT = (
    "\n\nEvent data (GITHUB_PULL_REQUEST_EVENT):\n"
    "```json\n"
    "{\n"
    '  "action": "opened",\n'
    '  "number": 42,\n'
    '  "title": "Fix the login page"\n'
    "}\n"
    "```"
)


def _compose(inputs, *, include_event=True, context=_CONTEXT):
    return compose_event_inputs(inputs, context=context, include_event=include_event)


def _user(content):
    return {"messages": [{"role": "user", "content": content}]}


# --- format_event_text ------------------------------------------------------ #


def test_format_event_text_matches_the_shared_example():
    assert format_event_text("GITHUB_PULL_REQUEST_EVENT", _ATTRIBUTES) == _EVENT_TEXT


def test_format_event_text_without_event_type():
    assert format_event_text(None, {"a": 1}).startswith("\n\nEvent data:\n```json\n")


# --- shapes ----------------------------------------------------------------- #


def test_string_content_gets_the_event_text_appended():
    result = _compose(_user("Review this pull request"))
    assert result == _user("Review this pull request" + _EVENT_TEXT)


def test_parts_content_gets_one_more_text_part():
    parts = [{"type": "text", "text": "Review "}]
    result = _compose(_user(parts))
    assert result["messages"][0]["content"] == [
        {"type": "text", "text": "Review "},
        {"type": "text", "text": _EVENT_TEXT},
    ]


def test_last_message_not_user_gets_a_new_user_message():
    inputs = {
        "messages": [
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "Hello"},
        ]
    }
    result = _compose(inputs)
    assert result["messages"][:2] == inputs["messages"]
    assert result["messages"][2] == {"role": "user", "content": _EVENT_TEXT.lstrip()}


def test_empty_mapping_becomes_one_user_message():
    assert _compose({}) == _user(_EVENT_TEXT.lstrip())


def test_completion_mapping_is_unchanged():
    assert _compose({"number": 42}) == {"number": 42}


def test_whole_context_mapping_is_unchanged():
    assert _compose(dict(_CONTEXT)) == _CONTEXT


def test_option_off_adds_no_event_text():
    assert _compose(_user("Review"), include_event=False) == _user("Review")


@pytest.mark.parametrize("event", [{}, {"event_type": "X", "attributes": None}])
def test_event_without_attributes_adds_no_event_text(event):
    assert _compose(_user("Review"), context={"event": event}) == _user("Review")


def test_argument_is_not_mutated():
    inputs = _user([{"type": "text", "text": 42}])
    _compose(inputs)
    assert inputs == _user([{"type": "text", "text": 42}])


# --- text coercion (same fixtures as the web preview tests) ----------------- #


@pytest.mark.parametrize(
    ("value", "text"),
    [
        ("Fix the login page", "Fix the login page"),
        (42, "42"),
        (True, "true"),
        ({"login": "octocat", "id": 1}, '{"login":"octocat","id":1}'),
        (None, ""),
    ],
)
def test_message_text_is_coerced_to_a_string(value, text):
    part = _compose(_user([{"type": "text", "text": value}]), include_event=False)
    assert part == _user([{"type": "text", "text": text}])

    content = _compose(_user(value), include_event=False)
    assert content == _user(text)


def test_array_in_a_text_part_is_coerced_to_json():
    # A bare `content` array is read as message parts, so the composer stores a pill as a
    # text part (design decision 10) and the array arrives here as `text`.
    part = _compose(
        _user([{"type": "text", "text": ["bug", "urgent"]}]), include_event=False
    )
    assert part == _user([{"type": "text", "text": '["bug","urgent"]'}])


def test_non_text_parts_are_untouched():
    image = {"type": "image_url", "image_url": {"url": "https://example.com/a.png"}}
    assert _compose(_user([image]), include_event=False) == _user([image])


# --- data fields ------------------------------------------------------------ #


def test_subscription_without_include_event_reads_as_on():
    assert TriggerSubscriptionData.model_validate({"event_key": "x"}).include_event


def test_include_event_false_round_trips_through_the_mappings():
    dbe = TriggerSubscriptionDBE(
        id=uuid4(),
        project_id=uuid4(),
        created_at=datetime.now(timezone.utc),
        connection_id=uuid4(),
    )
    map_subscription_dto_to_dbe_edit(
        subscription_dbe=dbe,
        user_id=uuid4(),
        subscription=TriggerSubscriptionEdit(
            id=dbe.id,
            connection_id=dbe.connection_id,
            data=TriggerSubscriptionData(event_key="x", include_event=False),
        ),
    )
    assert dbe.data["include_event"] is False
    assert map_subscription_dbe_to_dto(subscription_dbe=dbe).data.include_event is False
