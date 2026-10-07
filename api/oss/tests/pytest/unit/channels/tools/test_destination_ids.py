"""Opaque references handed to the model: a destination is a space row, a
thread or message is a provider reference inside one space. Decoding never
raises; anything malformed is simply not found."""

from uuid import uuid4

import pytest

from oss.src.core.channels.tools.ids import (
    decode_destination_id,
    decode_space_ref,
    encode_destination_id,
    encode_space_ref,
)


def test_destination_id_round_trips():
    space_id = uuid4()

    assert decode_destination_id(encode_destination_id(space_id)) == space_id


@pytest.mark.parametrize(
    "value",
    ["", "C0123", "dst_", "dst_not-a-uuid", "thr_abc", None, 42, "x" * 500],
)
def test_malformed_destination_id_decodes_to_none(value):
    assert decode_destination_id(value) is None


def test_destination_id_contains_no_provider_identifier():
    space_id = uuid4()

    # the space row's own id and nothing else: no channel id, team, or chat id
    assert encode_destination_id(space_id) == f"dst_{space_id.hex}"


def test_thread_and_message_refs_round_trip_inside_their_space():
    space_id = uuid4()

    thread_id = encode_space_ref("thr", space_id, "1700000000.000100")
    message_id = encode_space_ref("msg", space_id, "42")

    assert decode_space_ref("thr", thread_id) == (space_id, "1700000000.000100")
    assert decode_space_ref("msg", message_id) == (space_id, "42")
    assert "1700000000" not in thread_id


@pytest.mark.parametrize("value", ["", "thr_%%%", "thr_Zm9v", "msg_x", None])
def test_malformed_space_ref_decodes_to_none(value):
    assert decode_space_ref("thr", value) is None


def test_a_message_ref_is_not_a_thread_ref():
    message_id = encode_space_ref("msg", uuid4(), "1.0")

    assert decode_space_ref("thr", message_id) is None
