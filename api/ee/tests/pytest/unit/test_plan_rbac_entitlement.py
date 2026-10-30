"""`PlanRbacEntitlement` never answers from a failed plan read (small team roles).

`check_entitlements` answers True on a Redis or database error. If the role reader used
it, a Hobby or Pro invite without a role, an auto-join or a role removal would store
`viewer` for good. The adapter raises instead, and keeps no failed answer in its memo.
"""

from uuid import uuid4

import pytest

import ee.src.core.access.rbac as rbac_module
from ee.src.core.access.rbac import PlanRbacEntitlement
from oss.src.core.access.types import RbacEntitlementUnavailable


@pytest.mark.asyncio
async def test_a_failed_read_raises_and_is_not_kept(monkeypatch):
    answers = [ConnectionError("database is down"), (False, None, None)]
    calls = []

    async def _check(**kwargs):
        calls.append(kwargs)
        answer = answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(rbac_module, "_check_entitlements", _check)
    entitlement = PlanRbacEntitlement()
    organization_id = uuid4()

    with pytest.raises(RbacEntitlementUnavailable):
        await entitlement.is_entitled(organization_id=organization_id)

    # The next read asks the plan again and gets the real answer.
    assert await entitlement.is_entitled(organization_id=organization_id) is False
    assert len(calls) == 2
    # Then the answer is kept.
    assert await entitlement.is_entitled(organization_id=organization_id) is False
    assert len(calls) == 2
