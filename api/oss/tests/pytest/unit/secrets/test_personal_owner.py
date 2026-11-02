"""A person's own `secrets` rows: the owner type and the storage filters."""

from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

from oss.src.core.secrets.dtos import SecretOwner
from oss.src.core.secrets.enums import SecretOwnerKind
from oss.src.dbs.postgres.secrets.dao import (
    _LOAD_EFFECTIVE_SQL,
    _owner_filter,
    owner_columns,
)


def _sql(filters) -> str:
    return " AND ".join(str(f.compile(dialect=postgresql.dialect())) for f in filters)


def test_a_user_owner_always_names_its_organization():
    with pytest.raises(ValueError):
        SecretOwner(kind=SecretOwnerKind.USER, id=uuid4())
    with pytest.raises(ValueError):
        SecretOwner(
            kind=SecretOwnerKind.ORGANIZATION, id=uuid4(), organization_id=uuid4()
        )
    organization_id, user_id = uuid4(), uuid4()
    owner = SecretOwner.for_user(organization_id=organization_id, user_id=user_id)
    assert owner_columns(owner) == {
        "organization_id": organization_id,
        "user_id": user_id,
    }


def test_a_person_reads_only_their_own_rows():
    owner = SecretOwner.for_user(organization_id=uuid4(), user_id=uuid4())
    sql = _sql(_owner_filter(owner))
    assert "secrets.organization_id =" in sql and "secrets.user_id =" in sql


def test_an_organization_read_never_sees_a_persons_row():
    owner = SecretOwner(kind=SecretOwnerKind.ORGANIZATION, id=uuid4())
    assert "secrets.user_id IS NULL" in _sql(_owner_filter(owner))
    assert "secrets.user_id IS NULL" in _sql(_owner_filter(owner, shareable=True))
    # The effective set a project reads never carries a person's row either.
    assert "s.user_id IS NULL" in _LOAD_EFFECTIVE_SQL
