"""An operator editing a space never resets the customer's STOP."""

from types import SimpleNamespace
from uuid import uuid4

from oss.src.core.channels.dtos import (
    ChannelSpaceData,
    ChannelSpaceEdit,
    ChannelSpaceFlags,
)
from oss.src.dbs.postgres.channels.mappings import map_space_dto_to_dbe_edit


def test_an_operator_edit_keeps_the_opt_out_and_its_fence():
    consent_event_id = str(uuid4())
    space_dbe = SimpleNamespace(
        flags={
            "is_active": True,
            "is_opted_out": True,
            "consent_event_id": consent_event_id,
        }
    )

    map_space_dto_to_dbe_edit(
        space_dbe=space_dbe,
        user_id=uuid4(),
        space=ChannelSpaceEdit(
            id=uuid4(),
            name="Kerry",
            data=ChannelSpaceData(external_locator={"wa_id": "16315551234"}),
            flags=ChannelSpaceFlags(is_active=False),
        ),
    )

    assert space_dbe.flags["is_active"] is False
    assert space_dbe.flags["is_opted_out"] is True
    assert space_dbe.flags["consent_event_id"] == consent_event_id
