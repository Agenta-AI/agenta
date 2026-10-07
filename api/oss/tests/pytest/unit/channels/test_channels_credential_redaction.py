"""Known credential field names are redacted on inbox/outbox `processed`
payloads -- a platform that echoes a token back would otherwise put it in
our log."""

from oss.src.core.channels.dtos import (
    ChannelInboxEventProcessed,
    ChannelOutboxEventData,
)


def test_inbox_content_redacts_a_credential_field_name_nested_in_a_part():
    processed = ChannelInboxEventProcessed(
        content=[{"type": "text", "text": "hi", "bot_token": "xoxb-leak"}],
        sender={"id": "U1"},
    )

    assert processed.content[0]["bot_token"] == "[REDACTED]"
    assert processed.content[0]["text"] == "hi"  # everything else survives


def test_inbox_sender_redacts_a_credential_field_name():
    processed = ChannelInboxEventProcessed(
        content=[{"type": "text", "text": "hi"}],
        sender={"id": "U1", "signing_secret": "leak"},
    )

    assert processed.sender["signing_secret"] == "[REDACTED]"
    assert processed.sender["id"] == "U1"


def test_outbox_processed_redacts_a_credential_field_name_at_any_depth():
    data = ChannelOutboxEventData(
        processed={"headers": {"webhook_secret": "leak"}, "body": "ok"}
    )

    assert data.processed["headers"]["webhook_secret"] == "[REDACTED]"
    assert data.processed["body"] == "ok"


def test_outbox_processed_none_survives_unchanged():
    data = ChannelOutboxEventData(processed=None)

    assert data.processed is None


def test_redaction_is_case_insensitive_on_the_field_name():
    processed = ChannelInboxEventProcessed(
        content=[{"type": "text", "text": "hi", "Bot_Token": "leak"}],
        sender={"id": "U1"},
    )

    assert processed.content[0]["Bot_Token"] == "[REDACTED]"
