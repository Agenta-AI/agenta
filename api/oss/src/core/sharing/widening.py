"""The one rule that keeps text from reaching people who cannot read its source.

A session tool moves text between two items of one project: a read puts the text of a
source session (or a drive) into the calling session's transcript, and a send puts the
calling session's text into a child session. Every reader of the target then reads it.
`is_wider(item, than)` answers whether that would widen who can read the text.
"""

from typing import FrozenSet
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from oss.src.core.sharing.dtos import AccessPolicy, Visibility


class SharedItemReaders(BaseModel):
    """Who can read one item: its current policy and the people it is granted to. A
    drive has no grants."""

    model_config = ConfigDict(frozen=True)

    policy: AccessPolicy
    grantee_user_ids: FrozenSet[UUID] = frozenset()
    # A channel session: its channel shows the text to people outside the project.
    is_channel: bool = False


def _private_readers(item: SharedItemReaders) -> FrozenSet[UUID]:
    owner = item.policy.owner_user_id
    return item.grantee_user_ids | ({owner} if owner is not None else frozenset())


def is_wider(item: SharedItemReaders, than: SharedItemReaders) -> bool:
    """Whether a person who cannot read `than` can read `item`.

    A project-visible item is never narrower than another item of the same project, so
    it is wider only than a private item. A private item is never wider than a
    project-visible one. Two private items compare their readers, the owner and the
    grantees: `item` is wider when it has a reader that `than` does not have. A channel
    session is wider than every private item, whatever its own policy, because its
    channel shows the text outside the project.
    """

    if item.is_channel and than.policy.visibility == Visibility.PRIVATE:
        return True
    if item.policy.visibility == Visibility.PROJECT:
        return than.policy.visibility == Visibility.PRIVATE
    if than.policy.visibility == Visibility.PROJECT:
        return False
    return not _private_readers(item) <= _private_readers(than)
