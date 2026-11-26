"""What the plan of the deployment under test offers.

Outside cloud, every organization takes the instance plan from the license key,
whatever plan a test pins on its account. An instance with no key is on the
community plan, which has no plan flags. A test that needs a flag asks here and
skips on such an instance, with a reason that names the plan and the flag. On cloud,
and on an instance with a paid key, the pinned plan has the flag and the test runs.
A test that needs a flag to be absent asks the other way and skips on a licensed
instance, where every organization gets the flags of the key.
"""

from typing import Dict, Tuple
from uuid import uuid4

import pytest

# Pinned plan -> (the plan the deployment applies, that plan's flags). One lookup per
# pinned plan and process.
_EFFECTIVE: Dict[str, Tuple[str, Dict[str, bool]]] = {}


def _effective_plan(admin_api, *, plan: str) -> Tuple[str, Dict[str, bool]]:
    if plan in _EFFECTIVE:
        return _EFFECTIVE[plan]

    email = f"plan-probe-{uuid4().hex[:12]}@test.agenta.ai"
    created = admin_api(
        "POST",
        "/admin/simple/accounts/",
        json={
            "accounts": {
                "u": {
                    "user": {"email": email},
                    "options": {
                        "create_api_keys": True,
                        "return_api_keys": True,
                        "seed_defaults": True,
                    },
                    "subscription": {"plan": plan},
                }
            }
        },
    )
    assert created.status_code == 200, created.text
    headers = {
        "Authorization": f"ApiKey {created.json()['accounts']['u']['api_keys']['key']}"
    }
    try:
        subscription = admin_api("GET", "/billing/subscription", headers=headers)
        if subscription.status_code == 404:
            # Cloud with Stripe: the admin endpoint stores the pinned plan with no
            # Stripe subscription, so this read has no status to return. On cloud
            # the pinned plan is the plan applied.
            applied = plan
        else:
            assert subscription.status_code == 200, subscription.text
            applied = subscription.json()["plan"]

        plans = admin_api("GET", "/access/plans", headers=headers)
        assert plans.status_code == 200, plans.text
        flags = (plans.json().get(applied) or {}).get("flags") or {}
    finally:
        admin_api(
            "DELETE",
            "/admin/simple/accounts/",
            json={"accounts": {"u": {"user": {"email": email}}}, "confirm": "delete"},
        )

    _EFFECTIVE[plan] = (applied, flags)
    return _EFFECTIVE[plan]


def plan_offers(admin_api, *, plan: str, flag: str) -> bool:
    """Whether an account pinned to `plan` gets `flag` on this deployment."""
    _, flags = _effective_plan(admin_api, plan=plan)
    return bool(flags.get(flag))


def skip_unless_plan_offers(admin_api, *, plan: str, flags: Tuple[str, ...]) -> None:
    """Skip the calling test when an account pinned to `plan` lacks any of `flags`."""
    applied, offered = _effective_plan(admin_api, plan=plan)
    missing = [flag for flag in flags if not offered.get(flag)]
    if missing:
        pytest.skip(
            f"the deployment applies plan {applied}, which does not offer "
            f"{', '.join(missing)}; an instance license key with "
            f"{'these flags' if len(missing) > 1 else 'this flag'} runs this test"
        )


def skip_if_plan_offers(admin_api, *, plan: str, flag: str) -> None:
    """Skip the calling test when an account pinned to `plan` gets `flag` anyway, as on
    an instance whose license key has it."""
    applied, offered = _effective_plan(admin_api, plan=plan)
    if offered.get(flag):
        pytest.skip(
            f"the deployment applies plan {applied}, which offers {flag}; this test "
            f"needs an organization without it"
        )
