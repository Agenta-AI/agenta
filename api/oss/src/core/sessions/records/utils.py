"""Record event processing utilities.

strip_replay: strips the injected replay block from a user message payload
  before the event is stored.  If persisted as-is, the next resume would
  replay a record that already contains the prior replay, doubling context
  on every turn.  This is a correctness invariant, not an optimisation.

coalesce_events: folds a run's event list so that:
  - consecutive agent_message_chunk events are merged into a single
    agent_message event
  - standalone empty agent_message events are dropped (they would shadow
    the real assembled message)

Both functions are pure (no I/O) so they are easy to unit-test and to call
from any ingest path.
"""

from typing import Any, Dict, List, Optional

REPLAY_PREFIX = "__replay__:"


def strip_replay(payload: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Return payload with any injected replay block removed.

    The replay block is a synthetic text segment prepended to the user message
    on resume so the harness can re-feed prior context.  Its presence is
    signalled by the ``REPLAY_PREFIX`` marker at the start of the relevant
    text value.  We drop that entire text segment so the stored payload only
    ever holds the real user content.

    If the payload contains no replay block, it is returned unchanged.
    If payload is None, None is returned.
    """
    if payload is None:
        return None

    messages = payload.get("messages")
    if not isinstance(messages, list):
        return payload

    cleaned = []
    for msg in messages:
        if not isinstance(msg, dict):
            cleaned.append(msg)
            continue

        content = msg.get("content")

        # content is a plain string
        if isinstance(content, str):
            if content.startswith(REPLAY_PREFIX):
                # drop entire message — it is purely synthetic replay context
                continue
            cleaned.append(msg)
            continue

        # content is a list of content blocks
        if isinstance(content, list):
            filtered_blocks = [
                block
                for block in content
                if not (
                    isinstance(block, dict)
                    and isinstance(block.get("text"), str)
                    and block["text"].startswith(REPLAY_PREFIX)
                )
            ]
            if not filtered_blocks and content:
                # all blocks were replay — drop the message
                continue
            cleaned.append({**msg, "content": filtered_blocks})
            continue

        cleaned.append(msg)

    if cleaned == messages:
        return payload

    return {**payload, "messages": cleaned}


def coalesce_events(
    events: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Coalesce chunk events and drop empty agent messages.

    Rules (ported from PoC ``streamSession``):
    1. Consecutive ``agent_message_chunk`` records are folded into a single
       ``agent_message`` record whose text is the concatenation of all chunk
       texts.
    2. A standalone ``agent_message`` whose content is empty (no text, or
       text == "") is dropped.  These are emitted by some harnesses as a
       sentinel before chunks start and would shadow the assembled message.

    Records are dicts keyed by ``record_type`` with the body under ``attributes``.
    """
    result: List[Dict[str, Any]] = []
    chunk_buffer: List[Dict[str, Any]] = []

    def _flush_chunks() -> None:
        if not chunk_buffer:
            return
        combined_text = "".join(
            c.get("attributes", {}).get("text", "") or ""
            for c in chunk_buffer
            if isinstance(c.get("attributes"), dict)
        )
        if combined_text:
            base = chunk_buffer[0].copy()
            base["record_type"] = "agent_message"
            base["attributes"] = {
                **(
                    {}
                    if not isinstance(base.get("attributes"), dict)
                    else base["attributes"]
                ),
                "text": combined_text,
            }
            result.append(base)
        chunk_buffer.clear()

    for event in events:
        update = event.get("record_type", "")

        if update == "agent_message_chunk":
            chunk_buffer.append(event)
            continue

        # Non-chunk event — flush any pending chunks first
        _flush_chunks()

        if update == "agent_message":
            attributes = event.get("attributes") or {}
            text = attributes.get("text", "") if isinstance(attributes, dict) else ""
            if not text:
                # drop empty sentinel agent_message
                continue

        result.append(event)

    _flush_chunks()
    return result
