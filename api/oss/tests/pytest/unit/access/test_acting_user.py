"""`AccessService.acting_user_id`: the user a run acts as, from its authority only."""

from uuid import uuid4

from oss.src.core.access.dtos import PrincipalKind, PrincipalRecord, PrincipalRef
from oss.src.core.access.service import AccessService
from oss.tests.pytest.utils.principals import InMemoryPrincipalsDAO, make_envelope


def _service(*records):
    dao = InMemoryPrincipalsDAO()
    for record in records:
        dao.add(record)
    service = AccessService.__new__(AccessService)
    service._principals = dao
    return service


async def test_api_key_acts_as_its_creator():
    creator = uuid4()
    envelope = make_envelope(kind="api_key", sender=None)
    key = envelope.authority.principal
    service = _service(
        PrincipalRecord(principal=key, acting_user_id=creator, is_active=True)
    )
    assert await service.acting_user_id(authority=envelope.authority) == creator


async def test_installation_acts_as_its_linked_user_else_the_binding_creator():
    linked, creator = uuid4(), uuid4()
    binding = PrincipalRef(kind=PrincipalKind.INSTALLATION, id=uuid4())
    service = _service(
        PrincipalRecord(principal=binding, acting_user_id=creator, is_active=True)
    )
    linked_env = make_envelope(
        kind="installation", principal_id=binding.id, linked_user_id=linked, sender=None
    )
    unlinked_env = make_envelope(
        kind="installation", principal_id=binding.id, sender=None
    )
    assert await service.acting_user_id(authority=linked_env.authority) == linked
    assert await service.acting_user_id(authority=unlinked_env.authority) == creator


async def test_inactive_principal_has_no_acting_user():
    envelope = make_envelope(kind="api_key", sender=None)
    service = _service(
        PrincipalRecord(
            principal=envelope.authority.principal,
            acting_user_id=uuid4(),
            is_active=False,
        )
    )
    assert await service.acting_user_id(authority=envelope.authority) is None
    assert await _service().acting_user_id(authority=envelope.authority) is None
