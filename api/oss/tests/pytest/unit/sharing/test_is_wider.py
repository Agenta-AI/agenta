"""`is_wider(item, than)`: whether a person who cannot read `than` can read `item`
(design D11)."""

from uuid import uuid4

from oss.src.core.sharing.dtos import AccessPolicy, Visibility
from oss.src.core.sharing.widening import SharedItemReaders, is_wider

ANA = uuid4()
BEN = uuid4()


def project(owner=None, **kwargs) -> SharedItemReaders:
    return SharedItemReaders(
        policy=AccessPolicy(visibility=Visibility.PROJECT, owner_user_id=owner),
        **kwargs,
    )


def private(owner, *grantees, **kwargs) -> SharedItemReaders:
    return SharedItemReaders(
        policy=AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=owner),
        grantee_user_ids=frozenset(grantees),
        **kwargs,
    )


def test_a_project_item_is_wider_than_a_private_one_and_never_narrower():
    assert is_wider(project(ANA), private(ANA))
    assert not is_wider(private(ANA), project(BEN))
    assert not is_wider(project(ANA), project(BEN))


def test_two_private_items_compare_their_readers():
    assert not is_wider(private(ANA), private(ANA))
    # Ana's private session reads Ana's session that she shared with Ben: no new reader.
    assert not is_wider(private(ANA), private(ANA, BEN))
    # A session shared with Ben reads Ana's own private session: Ben would read it.
    assert is_wider(private(ANA, BEN), private(ANA))
    # Another owner.
    assert is_wider(private(BEN), private(ANA))


def test_a_channel_session_is_wider_than_every_private_item():
    assert is_wider(private(ANA, is_channel=True), private(ANA))
    assert is_wider(project(is_channel=True), private(ANA))
    assert not is_wider(project(is_channel=True), project(ANA))
