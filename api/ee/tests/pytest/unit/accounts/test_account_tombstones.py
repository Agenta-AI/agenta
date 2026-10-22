"""Unit tests for the account tombstone: written by the self-service deletion
(``oss.src.core.accounts.service.PlatformAdminAccountsService.delete_own_account``) and
read by the signup hook (``ee.src.core.organizations.service.provision_signup_subscription``)
so a deleted email that returns gets no free credits."""

import hashlib
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import List, Optional
from uuid import UUID

import pytest
import uuid_utils.compat as uuid_utils

import ee.src.core.accounts.service as tombstones_module
import ee.src.core.fraud.service as fraud_service_module
import ee.src.core.organizations.service as organizations_service_module
import oss.src.core.accounts.service as accounts_service_module
from ee.src.core.accounts.service import AccountTombstonesService
from ee.src.core.fraud.service import FraudService
from ee.src.core.accounts.types import (
    AccountTombstone,
    AccountTombstoneCreate,
    AccountTombstonesDAOInterface,
    WalletTotals,
    email_hash,
    normalize_email,
)
from ee.src.core.fraud.types import (
    BillingFacts,
    FraudCheckpoint,
    FraudDAOInterface,
)
from ee.src.core.organizations.service import REFUSED_EMAIL_FLOOR_MUSD
from ee.src.core.wallets.grants import (
    DAILY_FREE_ACTIVITY,
    DAILY_FREE_CREDITS_MUSD,
    daily_free_reference,
)
from ee.src.core.wallets.service import WalletsService
from ee.tests.pytest.utils.wallets.fakes import FakeWalletsDAO
from oss.src.core.accounts.dtos import AdminAccountsDelete, AdminAccountsDeleteTarget
from oss.src.core.accounts.errors import AccountTombstoneError
from oss.src.core.accounts.service import PlatformAdminAccountsService
from oss.src.utils.env import env

USER_ID = UUID("00000000-0000-0000-0000-0000000000a1")
ORG_A = UUID("00000000-0000-0000-0000-00000000aaaa")
ORG_B = UUID("00000000-0000-0000-0000-00000000bbbb")
NEW_ORG = UUID("00000000-0000-0000-0000-00000000cccc")
EMAIL = "Person@Example.test"


class FakeTombstonesDAO(AccountTombstonesDAOInterface):
    def __init__(self):
        self.totals = {}
        self.rows: List[AccountTombstone] = []
        self.create_error: Optional[Exception] = None
        self.find_error: Optional[Exception] = None

    async def read_wallet_totals(self, *, organization_ids):
        granted = sum(self.totals.get(oid, (0, 0))[0] for oid in organization_ids)
        spent = sum(self.totals.get(oid, (0, 0))[1] for oid in organization_ids)
        return WalletTotals(granted_musd=granted, spent_musd=spent)

    async def create(self, *, tombstone: AccountTombstoneCreate):
        if self.create_error is not None:
            raise self.create_error
        row = AccountTombstone(id=uuid_utils.uuid7(), **tombstone.model_dump())
        self.rows.append(row)
        return row

    async def delete(self, *, tombstone_ids):
        self.rows = [row for row in self.rows if row.id not in tombstone_ids]

    async def find_newest(self, *, email_hash, deleted_since):
        if self.find_error is not None:
            raise self.find_error
        matches = [
            row
            for row in self.rows
            if row.email_hash == email_hash and row.account_deleted_at >= deleted_since
        ]
        return max(matches, key=lambda row: row.account_deleted_at, default=None)


class FakeFraudDAO(FraudDAOInterface):
    def __init__(self):
        self.marks = []
        self.marked_owners = set()

    async def read_api_key_signals(self, *, user_id, project_id, now):
        return None

    async def mark_no_grants(self, *, organization_id, checkpoint, score, now):
        self.marks.append((organization_id, checkpoint, score))

    async def grants_blocked(self, *, organization_id):
        return any(mark[0] == organization_id for mark in self.marks)

    async def owner_grants_blocked(self, *, owner_id):
        return owner_id in self.marked_owners

    async def read_billing_facts(self, *, organization_id):
        return BillingFacts()


@pytest.fixture
def daos(monkeypatch):
    tombstones = FakeTombstonesDAO()
    fraud = FakeFraudDAO()
    monkeypatch.setattr(
        tombstones_module,
        "_account_tombstones_service",
        AccountTombstonesService(tombstones_dao=tombstones, fraud_dao=fraud),
    )
    return tombstones, fraud


def _tombstone(days_ago: int) -> AccountTombstone:
    return AccountTombstone(
        id=uuid_utils.uuid7(),
        email_hash=email_hash(EMAIL),
        account_deleted_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
        organization_ids=[ORG_A],
        credits_granted_musd=5_000_000,
        credits_spent_musd=4_990_000,
    )


def test_email_hash_normalizes_case_and_whitespace():
    assert email_hash("  Person@Example.TEST ") == email_hash("person@example.test")
    assert len(email_hash(EMAIL)) == 64
    assert "person" not in email_hash(EMAIL)


@pytest.mark.parametrize(
    "variant",
    [
        "user+b@gmail.com",
        "us.er@gmail.com",
        "U.s.e.r+promo@GoogleMail.com",
        "user@googlemail.com",
    ],
)
def test_email_hash_folds_provider_variants(variant):
    assert normalize_email("user+a@gmail.com") == "user@gmail.com"
    assert normalize_email(variant) == "user@gmail.com"
    assert email_hash(variant) == email_hash("user@gmail.com")


def test_googlemail_and_dotted_plus_gmail_hash_the_same():
    assert email_hash("user@googlemail.com") == email_hash("us.er+x@gmail.com")


def test_email_hash_drops_the_plus_tag_for_every_domain_but_keeps_dots():
    assert normalize_email("first.last+tag@acme.test") == "first.last@acme.test"
    assert email_hash("first.last+tag@acme.test") == email_hash("first.last@acme.test")
    assert email_hash("firstlast@acme.test") != email_hash("first.last@acme.test")


def test_email_hash_is_keyed_by_the_crypt_key(monkeypatch):
    monkeypatch.setattr(env.agenta, "crypt_key", "key-one")
    one = email_hash(EMAIL)
    monkeypatch.setattr(env.agenta, "crypt_key", "key-two")
    assert email_hash(EMAIL) != one
    assert one != hashlib.sha256(normalize_email(EMAIL).encode()).hexdigest()


# ---------------------------------------------------------------------------
# Deletion writes the tombstone
# ---------------------------------------------------------------------------


@pytest.fixture
def deletion(monkeypatch, daos):
    """The accounts service with every collaborator below the tombstone stubbed.
    `calls` records the destructive steps in order."""
    tombstones, fraud = daos
    tombstones.totals = {ORG_A: (5_000_000, 4_990_000), ORG_B: (750_000, 0)}
    calls = []
    m = accounts_service_module

    async def _user(uid):
        return SimpleNamespace(id=uid, uid="st-user", email=EMAIL)

    async def _orgs(uid):
        return [
            SimpleNamespace(id=ORG_A, name="a"),
            SimpleNamespace(id=ORG_B, name="b"),
        ]

    async def _one_member(organization_id):
        return 1

    async def _cancel(*, organization_id):
        calls.append(("cancel", organization_id))

    async def _loops(email):
        calls.append(("loops",))

    async def _delete_supertokens_user(self, *, uid, email):
        calls.append(("supertokens", uid))

    async def _memberships(uid):
        calls.append(("memberships", uid))

    async def _cascade(uid):
        calls.append(("cascade", uid))
        return [ORG_A, ORG_B]

    async def _batch(*, org_ids, workspace_ids, project_ids, user_ids):
        calls.append(("batch", list(user_ids)))

    monkeypatch.setattr(m, "is_ee", lambda: True)
    monkeypatch.setattr(m, "_db_get_user_by_id", _user)
    monkeypatch.setattr(m, "_db_get_orgs_owned_by_user", _orgs)
    monkeypatch.setattr(m, "_ee_count_organization_members", _one_member)
    monkeypatch.setattr(
        m, "_ee_subscription_service", SimpleNamespace(cancel_subscription=_cancel)
    )
    monkeypatch.setattr(m, "_delete_loops_contact", _loops)
    monkeypatch.setattr(m, "_ee_delete_user_memberships", _memberships)
    monkeypatch.setattr(m, "_db_delete_user_with_cascade", _cascade)
    monkeypatch.setattr(m, "_db_delete_accounts_batch", _batch)

    # The deletions clear the access caches of the deleted users; no database here.
    async def _no_organizations(**kwargs):
        return []

    async def _no_invalidation(**kwargs):
        return None

    monkeypatch.setattr(m, "_member_organization_ids", _no_organizations)
    monkeypatch.setattr(m, "_invalidate_memberships", _no_invalidation)
    monkeypatch.setattr(
        PlatformAdminAccountsService,
        "_delete_supertokens_user",
        _delete_supertokens_user,
    )
    return tombstones, calls


def _assert_tombstone(row: AccountTombstone) -> None:
    assert row.email_hash == email_hash("person@example.test")
    assert row.organization_ids == [ORG_A, ORG_B]
    assert row.credits_granted_musd == 5_750_000
    assert row.credits_spent_musd == 4_990_000
    assert row.account_deleted_at <= datetime.now(timezone.utc)
    assert EMAIL not in row.model_dump_json()


async def test_self_service_deletion_writes_the_tombstone_before_the_rows_go(
    deletion,
):
    tombstones, calls = deletion

    await PlatformAdminAccountsService().delete_own_account(user_id=str(USER_ID))

    assert len(tombstones.rows) == 1
    _assert_tombstone(tombstones.rows[0])
    assert [call[0] for call in calls] == [
        "cancel",
        "cancel",
        "supertokens",
        "memberships",
        "cascade",
        "loops",
    ]


async def test_self_service_deletion_writes_the_tombstone_before_billing_and_login(
    deletion,
):
    tombstones, calls = deletion
    seen = []

    async def _create(*, tombstone):
        seen.append(list(calls))
        row = AccountTombstone(id=uuid_utils.uuid7(), **tombstone.model_dump())
        tombstones.rows.append(row)
        return row

    tombstones.create = _create

    await PlatformAdminAccountsService().delete_own_account(user_id=str(USER_ID))

    # Written exactly once, and before any destructive step ran.
    assert seen == [[]]
    assert len(tombstones.rows) == 1


async def test_admin_deletion_discards_the_tombstone_when_the_cascade_fails(
    deletion, monkeypatch
):
    tombstones, calls = deletion

    async def _broken_cascade(uid):
        raise RuntimeError("database down")

    monkeypatch.setattr(
        accounts_service_module, "_db_delete_user_with_cascade", _broken_cascade
    )

    with pytest.raises(RuntimeError):
        await PlatformAdminAccountsService().delete_user(user_id=str(USER_ID))

    assert tombstones.rows == []


async def test_self_service_deletion_discards_the_tombstone_when_the_login_survives(
    deletion, monkeypatch
):
    tombstones, calls = deletion

    async def _broken_supertokens(self, *, uid, email):
        raise RuntimeError("auth provider down")

    monkeypatch.setattr(
        PlatformAdminAccountsService, "_delete_supertokens_user", _broken_supertokens
    )

    with pytest.raises(RuntimeError):
        await PlatformAdminAccountsService().delete_own_account(user_id=str(USER_ID))

    # The user can still sign in, so the email must not count as deleted.
    assert tombstones.rows == []


async def test_self_service_deletion_keeps_the_tombstone_once_the_login_is_gone(
    deletion, monkeypatch
):
    tombstones, calls = deletion

    async def _broken_cascade(uid):
        raise RuntimeError("database down")

    monkeypatch.setattr(
        accounts_service_module, "_db_delete_user_with_cascade", _broken_cascade
    )

    with pytest.raises(RuntimeError):
        await PlatformAdminAccountsService().delete_own_account(user_id=str(USER_ID))

    assert len(tombstones.rows) == 1


async def test_admin_deletion_writes_the_tombstone_before_the_cascade(deletion):
    tombstones, calls = deletion

    result = await PlatformAdminAccountsService().delete_user(user_id=str(USER_ID))

    assert len(tombstones.rows) == 1
    _assert_tombstone(tombstones.rows[0])
    assert [call[0] for call in calls] == ["memberships", "cascade"]
    assert [org.id for org in result.deleted.organizations] == [
        str(ORG_A),
        str(ORG_B),
    ]


async def test_admin_batch_deletion_writes_one_tombstone_per_user(deletion):
    tombstones, calls = deletion

    await PlatformAdminAccountsService().delete_accounts(
        dto=AdminAccountsDelete(
            target=AdminAccountsDeleteTarget(user_ids=[str(USER_ID)]), dry_run=False
        )
    )

    assert len(tombstones.rows) == 1
    _assert_tombstone(tombstones.rows[0])
    assert calls == [("batch", [USER_ID])]


async def test_batch_deletion_discards_the_tombstones_when_a_later_write_fails(
    deletion,
):
    tombstones, calls = deletion
    other = UUID("00000000-0000-0000-0000-0000000000a2")

    async def _create(*, tombstone):
        if len(tombstones.rows) == 1:
            raise RuntimeError("database down")
        row = AccountTombstone(id=uuid_utils.uuid7(), **tombstone.model_dump())
        tombstones.rows.append(row)
        return row

    tombstones.create = _create

    with pytest.raises(AccountTombstoneError):
        await PlatformAdminAccountsService().delete_accounts(
            dto=AdminAccountsDelete(
                target=AdminAccountsDeleteTarget(user_ids=[str(USER_ID), str(other)]),
                dry_run=False,
            )
        )

    assert tombstones.rows == []
    assert calls == []


async def test_batch_deletion_discards_the_tombstones_when_the_batch_fails(
    deletion, monkeypatch
):
    tombstones, calls = deletion

    async def _broken_batch(**kwargs):
        raise RuntimeError("database down")

    monkeypatch.setattr(
        accounts_service_module, "_db_delete_accounts_batch", _broken_batch
    )

    with pytest.raises(RuntimeError):
        await PlatformAdminAccountsService().delete_accounts(
            dto=AdminAccountsDelete(
                target=AdminAccountsDeleteTarget(user_ids=[str(USER_ID)]),
                dry_run=False,
            )
        )

    assert tombstones.rows == []


async def test_admin_deletion_aborts_when_the_tombstone_write_fails(deletion):
    tombstones, calls = deletion
    tombstones.create_error = RuntimeError("database down")

    with pytest.raises(AccountTombstoneError):
        await PlatformAdminAccountsService().delete_user(user_id=str(USER_ID))
    with pytest.raises(AccountTombstoneError):
        await PlatformAdminAccountsService().delete_accounts(
            dto=AdminAccountsDelete(
                target=AdminAccountsDeleteTarget(user_ids=[str(USER_ID)]),
                dry_run=False,
            )
        )

    assert tombstones.rows == []
    assert calls == []


async def test_self_service_deletion_aborts_when_the_tombstone_write_fails(deletion):
    tombstones, calls = deletion
    tombstones.create_error = RuntimeError("database down")

    with pytest.raises(AccountTombstoneError) as excinfo:
        await PlatformAdminAccountsService().delete_own_account(user_id=str(USER_ID))

    assert excinfo.value.code == "account_tombstone_failed"
    assert tombstones.rows == []
    # Billing, the login and the rows are untouched: the user still exists.
    assert calls == []


async def test_deletion_aborts_when_no_service_is_registered(deletion, monkeypatch):
    tombstones, calls = deletion
    monkeypatch.setattr(tombstones_module, "_account_tombstones_service", None)

    with pytest.raises(AccountTombstoneError):
        await PlatformAdminAccountsService().delete_own_account(user_id=str(USER_ID))

    assert calls == []


# ---------------------------------------------------------------------------
# Signup reads the tombstone
# ---------------------------------------------------------------------------


@pytest.fixture
def signup(monkeypatch, daos):
    """`provision_signup_subscription` with the mint policy allowing, the fraud check
    clean, and the wallet hooks recorded in `calls`."""
    tombstones, fraud = daos
    monkeypatch.setattr(env.wallets, "enabled", True)
    calls = []

    async def _allowed(organization_email):
        return True, False

    async def _not_fraud(*, organization_id, email):
        return False

    async def _provision(*, organization_id, plan, floor_musd=None):
        calls.append(("provision", floor_musd))

    async def _award(*, organization_id):
        calls.append(("award", organization_id))

    async def _no_entitlements(*, key, delta, scope):
        return None

    class _FakeSubscriptionService:
        async def provision_subscription(self, **kwargs):
            return SimpleNamespace(plan="cloud_v0_hobby")

    m = organizations_service_module
    monkeypatch.setattr(m, "_free_credits_check", _allowed)
    monkeypatch.setattr(m, "signup_is_fraud", _not_fraud)
    monkeypatch.setattr(m, "_provision_wallet_general_balance", _provision)
    monkeypatch.setattr(m, "_award_signup_grant", _award)
    monkeypatch.setattr(m, "_subscription_service", _FakeSubscriptionService())
    monkeypatch.setattr(m, "check_entitlements", _no_entitlements)

    async def _run(email=EMAIL):
        await m.provision_signup_subscription(
            SimpleNamespace(id=NEW_ORG, name="acme"), organization_email=email
        )
        return calls

    return tombstones, fraud, _run


async def test_a_returning_email_inside_the_window_gets_no_credits(signup):
    tombstones, fraud, run = signup
    tombstones.rows.append(_tombstone(days_ago=30))

    calls = await run("  person@EXAMPLE.test ")

    assert calls == [("provision", REFUSED_EMAIL_FLOOR_MUSD)]
    assert fraud.marks == [(NEW_ORG, FraudCheckpoint.RETURNING_ACCOUNT, None)]
    assert await fraud.grants_blocked(organization_id=NEW_ORG)


async def test_a_returning_email_outside_the_window_takes_the_normal_path(
    signup, monkeypatch
):
    tombstones, fraud, run = signup
    monkeypatch.setattr(env.agenta.accounts, "tombstone_days", 365)
    tombstones.rows.append(_tombstone(days_ago=366))

    calls = await run()

    assert calls == [("provision", None), ("award", NEW_ORG)]
    assert fraud.marks == []


async def test_the_window_comes_from_the_setting(signup, monkeypatch):
    tombstones, fraud, run = signup
    monkeypatch.setattr(env.agenta.accounts, "tombstone_days", 7)
    tombstones.rows.append(_tombstone(days_ago=30))

    calls = await run()

    assert calls == [("provision", None), ("award", NEW_ORG)]


async def test_a_new_email_takes_the_normal_path(signup):
    tombstones, fraud, run = signup
    tombstones.rows.append(_tombstone(days_ago=1))

    calls = await run("someone-else@example.test")

    assert calls == [("provision", None), ("award", NEW_ORG)]
    assert fraud.marks == []


async def test_a_lookup_failure_fails_open(signup):
    tombstones, fraud, run = signup
    tombstones.rows.append(_tombstone(days_ago=1))
    tombstones.find_error = RuntimeError("database down")

    calls = await run()

    assert calls == [("provision", None), ("award", NEW_ORG)]
    assert fraud.marks == []


async def test_a_missing_service_fails_open(signup, monkeypatch):
    tombstones, fraud, run = signup
    monkeypatch.setattr(tombstones_module, "_account_tombstones_service", None)

    calls = await run()

    assert calls == [("provision", None), ("award", NEW_ORG)]


async def test_a_marker_write_is_retried_once(signup, monkeypatch):
    tombstones, fraud, run = signup
    tombstones.rows.append(_tombstone(days_ago=1))
    attempts = []
    real_mark = fraud.mark_no_grants

    async def _flaky(**kwargs):
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError("row lock")
        await real_mark(**kwargs)

    monkeypatch.setattr(fraud, "mark_no_grants", _flaky)

    calls = await run()

    assert calls == [("provision", REFUSED_EMAIL_FLOOR_MUSD)]
    assert len(attempts) == 2
    assert fraud.marks == [(NEW_ORG, FraudCheckpoint.RETURNING_ACCOUNT, None)]


async def test_a_marker_write_failure_still_withholds_the_credits(signup, monkeypatch):
    tombstones, fraud, run = signup
    tombstones.rows.append(_tombstone(days_ago=1))
    attempts = []

    async def _broken(**kwargs):
        attempts.append(1)
        raise RuntimeError("row lock")

    monkeypatch.setattr(fraud, "mark_no_grants", _broken)

    calls = await run()

    assert calls == [("provision", REFUSED_EMAIL_FLOOR_MUSD)]
    assert len(attempts) == 2
    assert fraud.marks == []


async def test_a_returning_account_without_the_marker_still_cannot_spend():
    """The floor is the real guard: with no marker the daily grant is minted, but it
    sits below the raised floor and `check()` refuses."""
    wallets = WalletsService(wallets_dao=FakeWalletsDAO())
    await wallets.provision_general_balance(
        organization_id=NEW_ORG,
        plan="cloud_v0_hobby",
        floor_musd=REFUSED_EMAIL_FLOOR_MUSD,
    )
    now = datetime.now(timezone.utc)
    credit = await wallets.award(
        organization_id=NEW_ORG,
        activity_code=DAILY_FREE_ACTIVITY,
        reference=daily_free_reference(day=now.date()),
        now=now,
    )

    assert credit.amount_musd == DAILY_FREE_CREDITS_MUSD
    assert DAILY_FREE_CREDITS_MUSD < REFUSED_EMAIL_FLOOR_MUSD
    assert not await wallets.check(organization_id=NEW_ORG)


async def test_a_flagged_signup_makes_no_tombstone_lookup(signup, monkeypatch):
    """The fraud check already marked the organization; a second mark would
    overwrite the Jev verdict in the flags."""
    tombstones, fraud, run = signup
    tombstones.rows.append(_tombstone(days_ago=1))
    tombstones.find_error = AssertionError("tombstone lookup must not run")

    async def _fraud(*, organization_id, email):
        return True

    monkeypatch.setattr(organizations_service_module, "signup_is_fraud", _fraud)

    calls = await run()

    assert calls == [("provision", None)]
    assert fraud.marks == []


# ---------------------------------------------------------------------------
# A second organization of an existing user reads the tombstone and the marker
# ---------------------------------------------------------------------------


@pytest.fixture
def second_organization(monkeypatch, daos):
    """`provision_user_subscription` (POST /organizations/) with the email rules
    allowing and the floor recorded in `floors`."""
    tombstones, fraud = daos
    monkeypatch.setattr(env.wallets, "enabled", True)
    monkeypatch.setattr(
        fraud_service_module,
        "_fraud_service",
        FraudService(
            fraud_dao=fraud,
            wallets_service=WalletsService(wallets_dao=FakeWalletsDAO()),
        ),
    )
    floors = []

    async def _allowed(organization_email):
        return False

    async def _provision(*, organization_id, plan, floor_musd=None):
        floors.append(floor_musd)

    async def _no_entitlements(*, key, delta, scope):
        return None

    class _FakeSubscriptionService:
        async def start_plan(self, **kwargs):
            return None

    m = organizations_service_module
    monkeypatch.setattr(m, "_email_rules_refuse", _allowed)
    monkeypatch.setattr(m, "_provision_wallet_general_balance", _provision)
    monkeypatch.setattr(m, "_subscription_service", _FakeSubscriptionService())
    monkeypatch.setattr(m, "check_entitlements", _no_entitlements)

    async def _run():
        await m.provision_user_subscription(
            SimpleNamespace(id=NEW_ORG, name="second", owner_id=USER_ID),
            organization_email=EMAIL,
        )
        return floors

    return tombstones, fraud, _run


async def test_a_second_organization_of_a_returning_email_gets_the_raised_floor(
    second_organization,
):
    tombstones, fraud, run = second_organization
    tombstones.rows.append(_tombstone(days_ago=1))

    floors = await run()

    assert floors == [REFUSED_EMAIL_FLOOR_MUSD]
    assert fraud.marks == [(NEW_ORG, FraudCheckpoint.RETURNING_ACCOUNT, None)]


async def test_a_second_organization_of_a_flagged_owner_inherits_the_marker(
    second_organization,
):
    tombstones, fraud, run = second_organization
    fraud.marked_owners.add(USER_ID)

    floors = await run()

    assert floors == [REFUSED_EMAIL_FLOOR_MUSD]
    assert fraud.marks == [(NEW_ORG, FraudCheckpoint.OWNER_ORGANIZATION, None)]


async def test_a_second_organization_of_a_clean_owner_gets_the_plan_floor(
    second_organization,
):
    tombstones, fraud, run = second_organization

    floors = await run()

    assert floors == [None]
    assert fraud.marks == []


async def test_a_second_organization_of_a_returning_email_keeps_the_returning_cause(
    second_organization,
):
    tombstones, fraud, run = second_organization
    tombstones.rows.append(_tombstone(days_ago=1))
    fraud.marked_owners.add(USER_ID)

    floors = await run()

    assert floors == [REFUSED_EMAIL_FLOOR_MUSD]
    assert fraud.marks == [(NEW_ORG, FraudCheckpoint.RETURNING_ACCOUNT, None)]


async def test_a_flagged_owner_marker_write_failure_still_raises_the_floor(
    second_organization,
):
    tombstones, fraud, run = second_organization
    fraud.marked_owners.add(USER_ID)

    async def _broken_mark(**kwargs):
        raise RuntimeError("database down")

    fraud.mark_no_grants = _broken_mark

    floors = await run()

    assert floors == [REFUSED_EMAIL_FLOOR_MUSD]
