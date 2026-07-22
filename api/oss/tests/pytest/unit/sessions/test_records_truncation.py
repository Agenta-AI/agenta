"""Smart truncation of oversized record bodies (`_truncate_attributes`).

The legacy path replaces an over-cap body with `{"_truncated": True}`, losing the event's
type/id and all content. Smart truncation preserves the event shape + partial content so the
record log stays reconstructable server-side. These pin that contract.
"""

from orjson import dumps

from oss.src.core.sessions.records.streaming import (
    MAX_ATTRIBUTES_BYTES,
    _TRUNCATION_MARKER,
    _truncate_attributes,
)


def _size(obj) -> int:
    return len(dumps(obj))


def test_under_budget_returns_unchanged():
    attrs = {"type": "message", "text": "hi"}
    out = _truncate_attributes(attrs, MAX_ATTRIBUTES_BYTES, _size(attrs))
    assert out is attrs  # untouched, no _truncated marker


def test_large_string_field_is_trimmed_but_structure_preserved():
    big = "x" * (MAX_ATTRIBUTES_BYTES * 2)
    attrs = {"type": "tool_result", "id": "call-1", "output": big}
    out = _truncate_attributes(attrs, MAX_ATTRIBUTES_BYTES, _size(attrs))

    # Discriminator fields survive (unlike the legacy whole-body drop).
    assert out["type"] == "tool_result"
    assert out["id"] == "call-1"
    # The big field is trimmed + marked, and the whole body now fits the cap.
    assert out["output"].endswith(_TRUNCATION_MARKER)
    assert len(out["output"]) < len(big)
    assert _size(out) <= MAX_ATTRIBUTES_BYTES
    # Metadata records what was trimmed.
    assert out["_truncated"]["fields"] == ["output"]
    assert out["_truncated"]["original_bytes"] == _size(attrs)


def test_trims_the_largest_of_several_string_fields():
    attrs = {
        "type": "message",
        "small": "ok",
        "text": "y" * (MAX_ATTRIBUTES_BYTES * 2),
    }
    out = _truncate_attributes(attrs, MAX_ATTRIBUTES_BYTES, _size(attrs))
    assert out["small"] == "ok"  # small field untouched
    assert out["text"].endswith(_TRUNCATION_MARKER)
    assert _size(out) <= MAX_ATTRIBUTES_BYTES


def test_non_string_bloat_falls_back_to_discriminator_only():
    # A huge nested structure with no single big string leaf can't be string-trimmed.
    attrs = {
        "type": "tool_call",
        "id": "call-9",
        "input": {str(i): i for i in range(MAX_ATTRIBUTES_BYTES)},
    }
    out = _truncate_attributes(attrs, MAX_ATTRIBUTES_BYTES, _size(attrs))
    assert out["type"] == "tool_call"
    assert out["id"] == "call-9"
    assert out["_truncated"] is True
    assert _size(out) <= MAX_ATTRIBUTES_BYTES


def test_non_dict_attributes_fall_back():
    huge = "z" * (MAX_ATTRIBUTES_BYTES * 2)
    out = _truncate_attributes(huge, MAX_ATTRIBUTES_BYTES, _size(huge))
    assert out == {"_truncated": True, "_original_bytes": _size(huge)}
