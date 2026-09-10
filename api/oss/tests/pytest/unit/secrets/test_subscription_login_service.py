"""The subscription login state machine, over a fake runner and a fake vault row.

Two flows meet on the same row. A browser starts, polls, and cancels a device login. A run
pushes a refreshed login back, or reports that its login stopped working. The fake DAO
below stores through the real postgres mappings, so the JSON round trip is exercised too.
"""

import asyncio
from base64 import urlsafe_b64encode
from datetime import datetime, timedelta, timezone
from json import dumps as json_dumps, loads as json_loads
from typing import Optional
from uuid import uuid4

import pytest

from oss.src.core.secrets.dtos import CreateSecretDTO
from oss.src.core.secrets.enums import SubscriptionLoginState
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.subscription_login import RunnerLoginAttempt
from oss.src.core.secrets.subscription_service import SubscriptionLoginService
from oss.src.core.secrets.types import (
    SubscriptionLoginAttemptNotFound,
    SubscriptionLoginRunnerNotConfigured,
    SubscriptionLoginRunnerUnavailable,
    SubscriptionProviderConflict,
    SubscriptionSecretNotFound,
)
from oss.src.dbs.postgres.secrets.mappings import (
    map_secrets_dbe_to_dto,
    map_secrets_dto_to_dbe,
    map_secrets_dto_to_dbe_update,
)


PROJECT_ID = uuid4()
USER_ID = uuid4()

_HOUR_MS = 3_600_000


def _segment(payload: dict) -> str:
    return urlsafe_b64encode(json_dumps(payload).encode()).decode().rstrip("=")


def _access_token(account_id: str = "acct-1") -> str:
    """An access token shaped like Codex's: three segments, the account in the claim.

    The signature is filler. Nothing on this side of the wire verifies it, and nothing
    could: the platform is not the audience.
    """
    header = _segment({"alg": "RS256", "typ": "JWT"})
    payload = _segment(
        {"https://api.openai.com/auth": {"chatgpt_account_id": account_id}}
    )
    return f"{header}.{payload}.c2lnbmF0dXJl"


def _expires_in(hours: float) -> int:
    """An absolute expiry in epoch milliseconds, the unit Pi writes."""
    return int(datetime.now(timezone.utc).timestamp() * 1000) + int(hours * _HOUR_MS)


LOGIN = {
    "type": "oauth",
    "access": _access_token(),
    "refresh": "refresh-1",
    "expires": _expires_in(1),
    "accountId": "acct-1",
}


def _later(minutes: int = 10) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


class _FakeSecretsDAO:
    """Stores rows the way the postgres DAO does: mapped, encrypted-shaped, JSON."""

    def __init__(self):
        self.rows: dict = {}
        # Counts the updates that actually reached the row, so a test can prove a poll
        # wrote nothing.
        self.writes = 0

    async def create(
        self, project_id, organization_id, create_secret_dto, management=None
    ):
        dbe = map_secrets_dto_to_dbe(
            project_id=project_id,
            organization_id=organization_id,
            secret_dto=create_secret_dto,
        )
        dbe.id = uuid4()
        self.rows[str(dbe.id)] = dbe
        return map_secrets_dbe_to_dto(secrets_dbe=dbe)

    async def list(self, project_id, organization_id):
        return [map_secrets_dbe_to_dto(secrets_dbe=dbe) for dbe in self.rows.values()]

    async def get_by_id(self, secret_id, project_id, organization_id):
        dbe = self.rows.get(str(secret_id))
        return map_secrets_dbe_to_dto(secrets_dbe=dbe) if dbe else None

    async def get_by_slug(self, secret_slug, project_id, organization_id):
        for dbe in self.rows.values():
            if dbe.slug == secret_slug:
                return map_secrets_dbe_to_dto(secrets_dbe=dbe)
        return None

    async def update(
        self,
        secret_id,
        update_secret_dto,
        project_id,
        organization_id,
        user_id=None,
        resolve_update=None,
    ):
        dbe = self.rows.get(str(secret_id))
        if dbe is None:
            return None

        # Production resolves against the locked row at exactly this point.
        if resolve_update is not None:
            resolved = resolve_update(
                map_secrets_dbe_to_dto(secrets_dbe=dbe),
                update_secret_dto,
            )
            # None means nothing to change: production returns before it maps or commits.
            if resolved is None:
                return map_secrets_dbe_to_dto(secrets_dbe=dbe)
            update_secret_dto = resolved

        self.writes += 1
        map_secrets_dto_to_dbe_update(
            secrets_dbe=dbe,
            update_secret_dto=update_secret_dto,
            user_id=user_id,
        )
        return map_secrets_dbe_to_dto(secrets_dbe=dbe)

    async def delete(
        self, secret_id, project_id, organization_id, authorize_delete=None
    ):
        self.rows.pop(str(secret_id), None)


class _FakeRunner:
    """Answers the runner routes from a script the test sets."""

    def __init__(self, *, configured: bool = True):
        self.configured = configured
        self.next_attempt: Optional[RunnerLoginAttempt] = None
        self.next_start: Optional[RunnerLoginAttempt] = None
        # One entry per start, taken in order, for the tests that start twice at once.
        self.starts: list = []
        self.raises: Optional[Exception] = None
        self.deleted: list = []
        self.reads = 0
        self.started = 0
        # Set it to hold both starts inside the runner call, so two tabs reach the row
        # with an attempt each.
        self.start_gate: Optional[asyncio.Event] = None
        # Set it to hold a poll inside the runner call, so the test can move the row on
        # underneath a poll that is already in flight.
        self.read_gate: Optional[asyncio.Event] = None

    async def start_attempt(self, *, provider):
        self.started += 1
        if self.raises is not None:
            raise self.raises
        answer = self.starts.pop(0) if self.starts else None
        if self.start_gate is not None:
            await self.start_gate.wait()
        return answer or self.next_start or self.next_attempt

    async def read_attempt(self, *, attempt_id):
        self.reads += 1
        if self.raises is not None:
            raise self.raises
        answer = self.next_attempt
        if self.read_gate is not None:
            await self.read_gate.wait()
        return answer

    async def delete_attempt(self, *, attempt_id):
        self.deleted.append(attempt_id)
        return True


@pytest.fixture(name="vault")
def _vault():
    return VaultService(_FakeSecretsDAO())


@pytest.fixture(name="runner")
def _runner():
    return _FakeRunner()


@pytest.fixture(name="service")
def _service(vault, runner):
    return SubscriptionLoginService(vault_service=vault, runner_client=runner)


async def _make_secret(vault: VaultService, data: dict | None = None):
    secret = await vault.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=CreateSecretDTO.model_validate(
            {
                "header": {"name": "ChatGPT"},
                "secret": {"kind": "subscription_provider", "data": {}},
            }
        ),
    )
    return _seed(vault, secret.id, data) if data else secret


def _seed(vault: VaultService, secret_id, data: dict):
    """Put server-owned login state straight on the stored row.

    Create and update refuse these fields now, so a test that needs a signed-in connection
    writes the row itself instead of posting a state the API would reject.
    """
    dbe = vault.secrets_dao.rows[str(secret_id)]
    stored = json_loads(dbe.data)
    stored.update(data)
    dbe.data = json_dumps(stored)
    return map_secrets_dbe_to_dto(secrets_dbe=dbe)


async def _read(vault: VaultService, secret_id):
    return await vault.get_secret_by_id(secret_id=secret_id, project_id=PROJECT_ID)


async def _wait_for_the_poll(runner: "_FakeRunner") -> None:
    """Let a polling task run until it is parked inside the gated runner call."""
    for _ in range(100):
        if runner.reads:
            return
        await asyncio.sleep(0)
    raise AssertionError("the poll never reached the runner")


class TestCreateRules:
    async def test_a_new_connection_is_named_and_slugged(self, vault):
        secret = await _make_secret(vault)

        assert secret.slug == "chatgpt"
        assert secret.header.name == "ChatGPT"
        assert secret.data.provider_slug == "chatgpt"

    async def test_a_second_chatgpt_connection_is_a_conflict(self, vault):
        await _make_secret(vault)

        with pytest.raises(SubscriptionProviderConflict):
            await _make_secret(vault)


class TestAttemptLifecycle:
    async def test_start_stores_the_attempt_and_hides_the_code_from_the_row_reader(
        self, vault, runner, service
    ):
        secret = await _make_secret(vault)
        runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1",
            state="pending",
            user_code="ABCD-EFGH",
            verification_uri="https://example.test/device",
            expires_at=_later(),
            poll_after_ms=5000,
        )

        view = await service.start_attempt(
            project_id=PROJECT_ID, secret_id=secret.id, user_id=USER_ID
        )

        assert view.attempt_id == "att-1"
        assert view.state == "pending"
        assert view.user_code == "ABCD-EFGH"
        assert view.poll_after_ms == 5000

        stored = await _read(vault, secret.id)
        assert stored.data.login_attempt.id == "att-1"
        assert (
            stored.data.login_attempt.verification_uri == "https://example.test/device"
        )

    async def test_start_is_idempotent_while_an_attempt_is_live(
        self, vault, runner, service
    ):
        secret = await _make_secret(
            vault,
            {
                "login_attempt": {
                    "id": "att-live",
                    "expires_at": _later(),
                    "user_code": "LIVE-CODE",
                    "poll_after_ms": 3000,
                }
            },
        )
        runner.raises = AssertionError("the runner must not be asked for a new attempt")

        view = await service.start_attempt(project_id=PROJECT_ID, secret_id=secret.id)

        assert view.attempt_id == "att-live"
        assert view.user_code == "LIVE-CODE"

    async def test_start_replaces_an_expired_attempt(self, vault, runner, service):
        secret = await _make_secret(
            vault,
            {"login_attempt": {"id": "att-old", "expires_at": _later(-10)}},
        )
        runner.next_attempt = RunnerLoginAttempt(attempt_id="att-new", state="pending")

        view = await service.start_attempt(project_id=PROJECT_ID, secret_id=secret.id)

        assert view.attempt_id == "att-new"

    async def test_a_succeeded_attempt_stores_the_login_and_bumps_both_counters(
        self, vault, runner, service
    ):
        secret = await _make_secret(
            vault,
            {"login_attempt": {"id": "att-1", "expires_at": _later()}},
        )
        runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1", state="succeeded", login=LOGIN
        )

        view = await service.read_attempt(
            project_id=PROJECT_ID, secret_id=secret.id, attempt_id="att-1"
        )

        assert view.state == "succeeded"
        assert runner.deleted == ["att-1"]

        stored = await _read(vault, secret.id)
        assert stored.data.login.access == LOGIN["access"]
        assert stored.data.login_version == 1
        assert stored.data.login_generation == 1
        assert stored.data.login_state == SubscriptionLoginState.READY
        assert stored.data.login_attempt is None

    async def test_a_second_poll_of_the_same_success_does_not_bump_again(
        self, vault, runner, service
    ):
        secret = await _make_secret(
            vault,
            {"login_attempt": {"id": "att-1", "expires_at": _later()}},
        )
        runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1", state="succeeded", login=LOGIN
        )

        await service.read_attempt(
            project_id=PROJECT_ID, secret_id=secret.id, attempt_id="att-1"
        )
        # The runner keeps handing the login out until the DELETE lands, so replay the
        # same store the way a second concurrent poll would.
        await service._store_new_login(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            user_id=None,
            attempt_id="att-1",
            login=LOGIN,
        )

        stored = await _read(vault, secret.id)
        assert stored.data.login_version == 1
        assert stored.data.login_generation == 1

    async def test_the_same_login_is_not_stored_twice_for_a_live_attempt(
        self, vault, service
    ):
        # The refresh token is the second guard, behind the attempt id. It holds even on a
        # row that still carries the attempt the login came from.
        secret = await _make_secret(
            vault,
            {
                "login": LOGIN,
                "login_version": 1,
                "login_generation": 1,
                "login_state": "ready",
                "login_attempt": {"id": "att-1", "expires_at": _later()},
            },
        )

        bound = await service._store_new_login(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            user_id=None,
            attempt_id="att-1",
            login=LOGIN,
        )

        # The row still belongs to this attempt, so the login IS installed and the poll
        # reports the success. Only a binding that moved answers otherwise.
        assert bound is True
        stored = await _read(vault, secret.id)
        assert stored.data.login_version == 1
        assert stored.data.login_generation == 1
        assert stored.data.login_attempt.id == "att-1"

    async def test_a_failed_attempt_reports_its_reason_without_touching_the_row(
        self, vault, runner, service
    ):
        """The attempt's error belongs to the attempt, not to the stored login.

        `login_error` says why the login a run held stopped working. A sign-in the user did
        not finish says nothing about that, so it must not overwrite it.
        """
        secret = await _make_secret(
            vault,
            {
                "login_attempt": {"id": "att-1", "expires_at": _later()},
                "login_state": "needs_login",
                "login_error": "refresh_rejected",
            },
        )
        runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1", state="failed", error="access_denied"
        )

        view = await service.read_attempt(
            project_id=PROJECT_ID, secret_id=secret.id, attempt_id="att-1"
        )

        assert view.state == "failed"
        assert view.error == "access_denied"
        stored = await _read(vault, secret.id)
        assert stored.data.login_attempt is None
        assert stored.data.login_error == "refresh_rejected"

    async def test_an_attempt_the_runner_forgot_reads_as_failed(
        self, vault, runner, service
    ):
        secret = await _make_secret(
            vault,
            {"login_attempt": {"id": "att-1", "expires_at": _later()}},
        )
        runner.raises = SubscriptionLoginAttemptNotFound()

        view = await service.read_attempt(
            project_id=PROJECT_ID, secret_id=secret.id, attempt_id="att-1"
        )

        assert view.state == "failed"
        assert view.error == "attempt not found; try again"
        assert (await _read(vault, secret.id)).data.login_attempt is None

    async def test_polling_another_connections_attempt_id_is_refused(
        self, vault, runner, service
    ):
        secret = await _make_secret(
            vault,
            {"login_attempt": {"id": "att-mine", "expires_at": _later()}},
        )
        runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-theirs", state="succeeded", login=LOGIN
        )

        with pytest.raises(SubscriptionLoginAttemptNotFound):
            await service.read_attempt(
                project_id=PROJECT_ID, secret_id=secret.id, attempt_id="att-theirs"
            )

        assert runner.reads == 0

    async def test_a_pending_poll_does_not_rewrite_an_unchanged_attempt(
        self, vault, runner, service
    ):
        expires_at = _later()
        secret = await _make_secret(
            vault,
            {
                "login_attempt": {
                    "id": "att-1",
                    "expires_at": expires_at,
                    "user_code": "ABCD",
                    "verification_uri": "https://example.test/device",
                    "poll_after_ms": 5000,
                }
            },
        )
        runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1",
            state="pending",
            user_code="ABCD",
            verification_uri="https://example.test/device",
            expires_at=expires_at,
            poll_after_ms=5000,
        )
        before = (await _read(vault, secret.id)).data.model_dump(mode="json")

        view = await service.read_attempt(
            project_id=PROJECT_ID, secret_id=secret.id, attempt_id="att-1"
        )

        assert view.state == "pending"
        assert (await _read(vault, secret.id)).data.model_dump(mode="json") == before

    async def test_cancel_clears_the_attempt_and_purges_the_runner(
        self, vault, runner, service
    ):
        secret = await _make_secret(
            vault,
            {"login_attempt": {"id": "att-1", "expires_at": _later()}},
        )

        view = await service.cancel_attempt(
            project_id=PROJECT_ID, secret_id=secret.id, attempt_id="att-1"
        )

        assert view.state == "cancelled"
        assert runner.deleted == ["att-1"]
        assert (await _read(vault, secret.id)).data.login_attempt is None

    async def test_a_missing_connection_is_not_found(self, service):
        with pytest.raises(SubscriptionSecretNotFound):
            await service.start_attempt(project_id=PROJECT_ID, secret_id=uuid4())

    async def test_an_unconfigured_runner_surfaces_as_its_own_failure(
        self, vault, runner, service
    ):
        secret = await _make_secret(vault)
        runner.raises = SubscriptionLoginRunnerNotConfigured()

        with pytest.raises(SubscriptionLoginRunnerNotConfigured):
            await service.start_attempt(project_id=PROJECT_ID, secret_id=secret.id)

    async def test_a_dead_runner_surfaces_as_unavailable(self, vault, runner, service):
        secret = await _make_secret(vault)
        runner.raises = SubscriptionLoginRunnerUnavailable()

        with pytest.raises(SubscriptionLoginRunnerUnavailable):
            await service.start_attempt(project_id=PROJECT_ID, secret_id=secret.id)

    async def test_a_pending_poll_writes_nothing(self, vault, runner, service):
        """A browser polls every couple of seconds for up to fifteen minutes.

        Nothing about the attempt changes while it is pending, so a poll that learns
        nothing must not touch the row: the write would move the lifecycle columns and
        evict the project's vault cache on every tick.
        """
        secret = await _make_secret(
            vault,
            {
                "login_attempt": {
                    "id": "att-1",
                    "expires_at": _later(),
                    "user_code": "ABCD-EFGH",
                    "verification_uri": "https://example.test/device",
                    "poll_after_ms": 5000,
                }
            },
        )
        runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1",
            state="pending",
            user_code="ABCD-EFGH",
            verification_uri="https://example.test/device",
            expires_at=_later(),
            poll_after_ms=5000,
        )
        vault.secrets_dao.writes = 0

        for _ in range(3):
            view = await service.read_attempt(
                project_id=PROJECT_ID, secret_id=secret.id, attempt_id="att-1"
            )

        assert vault.secrets_dao.writes == 0
        assert view.state == "pending"
        assert view.user_code == "ABCD-EFGH"
        assert view.verification_uri == "https://example.test/device"
        assert view.poll_after_ms == 5000


class TestTwoTabsStartAtOnce:
    """Both tabs reach the runner. Only one code can be redeemed, so both are shown it.

    The row binds one attempt at a time. Before the recheck under the lock, the second
    start overwrote the binding and left the first browser showing a code that could
    never complete.
    """

    async def test_the_second_start_keeps_the_bound_attempt_and_cancels_its_own(
        self, vault, runner, service
    ):
        secret = await _make_secret(vault)
        runner.start_gate = asyncio.Event()
        runner.starts = [
            RunnerLoginAttempt(
                attempt_id="att-first",
                state="pending",
                user_code="FIRST-CODE",
                expires_at=_later(),
            ),
            RunnerLoginAttempt(
                attempt_id="att-second",
                state="pending",
                user_code="SECOND-CODE",
                expires_at=_later(),
            ),
        ]

        first = asyncio.create_task(
            service.start_attempt(project_id=PROJECT_ID, secret_id=secret.id)
        )
        second = asyncio.create_task(
            service.start_attempt(project_id=PROJECT_ID, secret_id=secret.id)
        )
        for _ in range(100):
            if runner.started == 2:
                break
            await asyncio.sleep(0)
        assert runner.started == 2, "both starts must reach the runner"
        runner.start_gate.set()

        views = [await first, await second]

        # Both callers hold the one attempt the row is bound to.
        assert views[0].attempt_id == views[1].attempt_id
        assert views[0].user_code == views[1].user_code
        stored = await _read(vault, secret.id)
        assert stored.data.login_attempt.id == views[0].attempt_id

        # The redundant attempt is cancelled on the runner rather than left to expire.
        loser = "att-second" if views[0].attempt_id == "att-first" else "att-first"
        assert runner.deleted == [loser]


class TestTheRunsReasonSurvivesAnAttempt:
    """`login_error` says why the STORED login died. Only a run writes it.

    The card turns it into a sentence: `refresh_rejected` reads "no longer valid", anything
    else reads "needs to be renewed". A sign-in the user starts and abandons must not change
    that sentence, because it answers a different question.
    """

    async def _dead_login(self, vault):
        return await _make_secret(
            vault,
            {
                "login": LOGIN,
                "login_version": 2,
                "login_generation": 1,
                "login_state": "needs_login",
                "login_error": "refresh_rejected",
            },
        )

    async def test_a_cancelled_attempt_leaves_the_runs_reason_in_place(
        self, vault, runner, service
    ):
        secret = await self._dead_login(vault)
        runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1",
            state="pending",
            user_code="ABCD-EFGH",
            expires_at=_later(),
        )

        started = await service.start_attempt(
            project_id=PROJECT_ID, secret_id=secret.id, user_id=USER_ID
        )
        # Starting the sign-in does not answer why the old login died either.
        assert (await _read(vault, secret.id)).data.login_error == "refresh_rejected"

        await service.cancel_attempt(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            attempt_id=started.attempt_id,
            user_id=USER_ID,
        )

        stored = (await _read(vault, secret.id)).data
        assert stored.login_attempt is None
        assert stored.login_state == SubscriptionLoginState.NEEDS_LOGIN
        assert stored.login_error == "refresh_rejected"

    async def test_the_sign_in_that_lands_is_what_clears_it(
        self, vault, runner, service
    ):
        secret = await self._dead_login(vault)
        runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1", state="pending", expires_at=_later()
        )
        started = await service.start_attempt(
            project_id=PROJECT_ID, secret_id=secret.id, user_id=USER_ID
        )

        runner.next_attempt = RunnerLoginAttempt(
            attempt_id=started.attempt_id,
            state="succeeded",
            login={**LOGIN, "refresh": "refresh-2"},
        )
        await service.read_attempt(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            attempt_id=started.attempt_id,
            user_id=USER_ID,
        )

        stored = (await _read(vault, secret.id)).data
        assert stored.login_state == SubscriptionLoginState.READY
        assert stored.login_error is None


class TestAPollThatOutlivesItsAttempt:
    """A poll is in flight when the user cancels and starts another login.

    The old runner answer arrives after the row already carries the replacement. It must
    change nothing: not the stored login, not the new attempt, not the stored error.
    """

    async def _cancel_then_restart(self, vault, runner, service, secret):
        await service.cancel_attempt(
            project_id=PROJECT_ID, secret_id=secret.id, attempt_id="att-1"
        )
        runner.next_start = RunnerLoginAttempt(
            attempt_id="att-2",
            state="pending",
            user_code="NEW-CODE",
            verification_uri="https://example.test/device",
            expires_at=_later(),
            poll_after_ms=4000,
        )
        await service.start_attempt(project_id=PROJECT_ID, secret_id=secret.id)

    async def _live_attempt(self, vault):
        return await _make_secret(
            vault,
            {"login_attempt": {"id": "att-1", "expires_at": _later()}},
        )

    async def test_a_late_success_does_not_install_the_cancelled_login(
        self, vault, runner, service
    ):
        secret = await self._live_attempt(vault)
        runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1", state="succeeded", login=LOGIN
        )
        runner.read_gate = asyncio.Event()

        poll = asyncio.create_task(
            service.read_attempt(
                project_id=PROJECT_ID, secret_id=secret.id, attempt_id="att-1"
            )
        )
        await _wait_for_the_poll(runner)

        await self._cancel_then_restart(vault, runner, service, secret)
        runner.read_gate.set()

        # It answers the way a poll of an attempt the row never held answers. Reporting
        # `succeeded` would show the old tab a sign-in that was never installed.
        with pytest.raises(SubscriptionLoginAttemptNotFound):
            await poll

        stored = await _read(vault, secret.id)
        assert stored.data.login is None
        assert stored.data.login_version == 0
        assert stored.data.login_generation == 0
        assert stored.data.login_attempt.id == "att-2"
        assert stored.data.login_attempt.user_code == "NEW-CODE"
        assert stored.data.login_error is None

    async def test_a_late_failure_does_not_clear_the_replacement_attempt(
        self, vault, runner, service
    ):
        secret = await self._live_attempt(vault)
        runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1", state="failed", error="access_denied"
        )
        runner.read_gate = asyncio.Event()

        poll = asyncio.create_task(
            service.read_attempt(
                project_id=PROJECT_ID, secret_id=secret.id, attempt_id="att-1"
            )
        )
        await _wait_for_the_poll(runner)

        await self._cancel_then_restart(vault, runner, service, secret)
        runner.read_gate.set()
        await poll

        stored = await _read(vault, secret.id)
        assert stored.data.login_attempt.id == "att-2"
        assert stored.data.login_error is None


class TestPushedLogin:
    async def _ready(self, vault, **overrides):
        data = {
            "login": LOGIN,
            "login_version": 3,
            "login_generation": 1,
            "login_state": "ready",
        }
        data.update(overrides)
        return await _make_secret(vault, data)

    async def test_a_refreshed_login_is_stored_and_bumps_only_the_version(
        self, vault, service
    ):
        secret = await self._ready(vault)
        newer = {
            **LOGIN,
            "access": _access_token(),
            "refresh": "refresh-2",
            "expires": _expires_in(2),
        }

        result = await service.push_login(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            login=newer,
            version=3,
            generation=1,
        )

        assert result.updated is True
        assert result.stale is False
        assert result.version == 4
        assert result.generation == 1
        assert result.login is None

        stored = await _read(vault, secret.id)
        assert stored.data.login.refresh == "refresh-2"
        assert stored.data.login_version == 4
        assert stored.data.login_generation == 1
        assert stored.data.login_state == SubscriptionLoginState.READY

    async def test_the_same_refresh_token_is_an_idempotent_no_op(self, vault, service):
        # A5: the runner returns the login on every poll until the DELETE, so the same
        # credential arrives more than once and must not bump the version twice.
        secret = await self._ready(vault)

        first = await service.push_login(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            login={**LOGIN, "expires": _expires_in(5)},
            version=3,
            generation=1,
        )

        assert first.updated is False
        assert first.stale is False
        assert first.version == 3
        assert (await _read(vault, secret.id)).data.login_version == 3

    async def test_an_equal_expiry_with_a_new_refresh_token_still_wins(
        self, vault, service
    ):
        secret = await self._ready(vault)

        result = await service.push_login(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            login={**LOGIN, "refresh": "refresh-2"},
            version=3,
            generation=1,
        )

        assert result.updated is True
        assert (await _read(vault, secret.id)).data.login.refresh == "refresh-2"

    async def test_an_older_expiry_never_downgrades_the_stored_login(
        self, vault, service
    ):
        secret = await self._ready(vault)

        result = await service.push_login(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            login={**LOGIN, "refresh": "refresh-0", "expires": _expires_in(0.5)},
            version=3,
            generation=1,
        )

        assert result.updated is False
        assert result.stale is False
        assert (await _read(vault, secret.id)).data.login.refresh == "refresh-1"

    async def test_an_older_generation_is_stale_and_gets_the_current_login_back(
        self, vault, service
    ):
        secret = await self._ready(vault, login_generation=3)

        result = await service.push_login(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            login={**LOGIN, "refresh": "refresh-old", "expires": _expires_in(9)},
            version=3,
            generation=1,
        )

        assert result.stale is True
        assert result.updated is False
        assert result.generation == 3
        assert result.login["refresh"] == "refresh-1"
        assert (await _read(vault, secret.id)).data.login.refresh == "refresh-1"

    async def test_an_unknown_newer_generation_is_refused_without_a_login(
        self, vault, service
    ):
        secret = await self._ready(vault)

        result = await service.push_login(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            login={**LOGIN, "refresh": "refresh-2", "expires": _expires_in(9)},
            version=3,
            generation=9,
        )

        assert result.updated is False
        assert result.stale is False
        assert result.login is None

    async def test_a_login_for_another_account_is_refused(self, vault, service):
        secret = await self._ready(vault)
        # Self-consistent, so it clears the shape check and meets the account rule.
        other = {
            **LOGIN,
            "access": _access_token("acct-2"),
            "accountId": "acct-2",
            "refresh": "refresh-2",
            "expires": _expires_in(9),
        }

        result = await service.push_login(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            login=other,
            version=3,
            generation=1,
        )

        assert result.updated is False
        assert result.reason == "other_account"
        assert (await _read(vault, secret.id)).data.login.accountId == "acct-1"

    async def test_a_push_to_a_connection_with_no_login_is_refused(
        self, vault, service
    ):
        secret = await _make_secret(vault)

        result = await service.push_login(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            login={**LOGIN, "expires": _expires_in(9)},
            version=0,
            generation=0,
        )

        assert result.updated is False
        assert result.reason == "no_login"
        assert (await _read(vault, secret.id)).data.login is None

    async def test_a_real_shaped_token_for_this_account_is_accepted(
        self, vault, service
    ):
        secret = await self._ready(vault)
        refreshed = {
            **LOGIN,
            "access": _access_token("acct-1"),
            "refresh": "refresh-2",
            "expires": _expires_in(9),
        }

        result = await service.push_login(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            login=refreshed,
            version=3,
            generation=1,
        )

        assert result.updated is True
        assert result.reason is None
        assert (await _read(vault, secret.id)).data.login.refresh == "refresh-2"

    async def test_a_stored_error_is_cleared_when_a_refresh_lands(self, vault, service):
        secret = await self._ready(
            vault, login_state="needs_login", login_error="refresh_rejected"
        )

        await service.push_login(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            login={**LOGIN, "refresh": "refresh-2", "expires": _expires_in(2)},
            version=3,
            generation=1,
        )

        stored = await _read(vault, secret.id)
        assert stored.data.login_state == SubscriptionLoginState.READY
        assert stored.data.login_error is None


class TestAnUnusablePushedLogin:
    """A run whose own refresh went wrong still pushes whatever the auth file holds.

    Seen live: garbage strings with a later expiry, which every ordering rule then ranked
    above the working stored login. The shape check runs before those rules, so none of
    these can reach the row.
    """

    async def _ready(self, vault, login=None):
        return await _make_secret(
            vault,
            {
                "login": login or LOGIN,
                "login_version": 3,
                "login_generation": 1,
                "login_state": "ready",
            },
        )

    async def _push(self, service, secret, **overrides):
        return await service.push_login(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            login={
                **LOGIN,
                "refresh": "refresh-2",
                "expires": _expires_in(9),
                **overrides,
            },
            version=3,
            generation=1,
        )

    async def _assert_refused(self, vault, secret, result):
        assert result.updated is False
        assert result.stale is False
        assert result.reason == "invalid_login"
        assert result.version == 3
        assert result.generation == 1

        stored = (await _read(vault, secret.id)).data
        assert stored.login.refresh == "refresh-1"
        assert stored.login_version == 3
        assert stored.login_generation == 1
        assert stored.login_state == SubscriptionLoginState.READY

    async def test_a_garbage_access_token_is_refused(self, vault, service):
        secret = await self._ready(vault)

        result = await self._push(service, secret, access="not-a-jwt")

        await self._assert_refused(vault, secret, result)

    async def test_a_token_whose_middle_segment_is_not_json_is_refused(
        self, vault, service
    ):
        secret = await self._ready(vault)

        result = await self._push(service, secret, access="aaa.bbbb.cccc")

        await self._assert_refused(vault, secret, result)

    async def test_a_token_for_another_account_is_refused(self, vault, service):
        secret = await self._ready(vault)

        result = await self._push(service, secret, access=_access_token("acct-9"))

        await self._assert_refused(vault, secret, result)

    async def test_an_empty_refresh_token_is_refused(self, vault, service):
        secret = await self._ready(vault)

        result = await self._push(service, secret, refresh="")

        await self._assert_refused(vault, secret, result)

    async def test_an_expiry_already_in_the_past_is_refused(self, vault, service):
        secret = await self._ready(vault)

        result = await self._push(service, secret, expires=_expires_in(-1))

        await self._assert_refused(vault, secret, result)

    async def test_an_expiry_that_is_not_an_integer_is_refused(self, vault, service):
        secret = await self._ready(vault)

        result = await self._push(service, secret, expires="9999999999999")

        await self._assert_refused(vault, secret, result)

    async def test_a_token_with_no_account_claim_is_refused(self, vault, service):
        secret = await self._ready(vault)
        no_claim = f"{_segment({'alg': 'RS256'})}.{_segment({'sub': 'x'})}.c2ln"

        result = await self._push(service, secret, access=no_claim)

        await self._assert_refused(vault, secret, result)

    async def test_a_login_without_an_account_id_field_is_stored_on_its_claim(
        self, vault, service
    ):
        """`accountId` is optional, so the claim is what both sides compare.

        The runner's own gate accepts a login that omits the field, and the two must agree.
        Reading the field instead made every such refresh look like another account's, so a
        harness that stopped writing it could never refresh a connection again.
        """
        secret = await self._ready(vault)
        login = {**LOGIN, "refresh": "refresh-2", "expires": _expires_in(9)}
        login.pop("accountId")

        result = await service.push_login(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            login=login,
            version=3,
            generation=1,
        )

        assert result.updated is True
        assert result.reason is None
        assert (await _read(vault, secret.id)).data.login.refresh == "refresh-2"

    async def test_a_stored_login_without_the_field_still_refuses_another_account(
        self, vault, service
    ):
        """The guard holds from the other side too: the stored claim names the account."""
        stored = {k: v for k, v in LOGIN.items() if k != "accountId"}
        secret = await self._ready(vault, login=stored)
        other = {
            **LOGIN,
            "access": _access_token("acct-2"),
            "accountId": "acct-2",
            "refresh": "refresh-2",
            "expires": _expires_in(9),
        }

        result = await service.push_login(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            login=other,
            version=3,
            generation=1,
        )

        assert result.updated is False
        assert result.reason == "other_account"


class TestAnUnusableDeviceLogin:
    async def test_a_device_login_that_hands_back_garbage_fails_the_attempt(
        self, vault, runner, service
    ):
        secret = await _make_secret(
            vault, {"login_attempt": {"id": "att-1", "expires_at": _later()}}
        )
        runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1",
            state="succeeded",
            login={**LOGIN, "access": "not-a-jwt"},
        )

        view = await service.read_attempt(
            project_id=PROJECT_ID, secret_id=secret.id, attempt_id="att-1"
        )

        assert view.state == "failed"
        assert view.error == "invalid_login"
        assert runner.deleted == ["att-1"]

        stored = (await _read(vault, secret.id)).data
        assert stored.login is None
        assert stored.login_version == 0
        assert stored.login_generation == 0
        assert stored.login_attempt is None
        # The refusal is the attempt's, so it is reported on the attempt and nowhere else.
        assert stored.login_error is None


class TestAConnectionRemovedMidWrite:
    """The row is deleted between the load and the locked write.

    Reachable: a user disconnects the connection while a run is pushing, or while a device
    login poll is in flight. The write finds nothing to lock, so the callback that fills in
    every caller's answer never runs. Each caller must say the connection is gone rather
    than answer from an empty result.
    """

    async def _vanishing(self, vault, data: dict):
        """A row that deletes itself the moment the atomic update takes the lock."""
        secret = await _make_secret(vault, data)
        original = vault.secrets_dao.update

        async def delete_then_update(*args, **kwargs):
            vault.secrets_dao.rows.pop(str(secret.id), None)
            return await original(*args, **kwargs)

        vault.secrets_dao.update = delete_then_update
        return secret

    async def test_a_push_answers_not_found_instead_of_an_empty_result(
        self, vault, service
    ):
        secret = await self._vanishing(
            vault,
            {"login": LOGIN, "login_version": 3, "login_generation": 1},
        )

        with pytest.raises(SubscriptionSecretNotFound):
            await service.push_login(
                project_id=PROJECT_ID,
                secret_id=secret.id,
                login={**LOGIN, "refresh": "refresh-2", "expires": _expires_in(9)},
                version=3,
                generation=1,
            )

    async def test_a_failure_report_answers_not_found(self, vault, service):
        secret = await self._vanishing(
            vault,
            {"login": LOGIN, "login_version": 3, "login_generation": 1},
        )

        with pytest.raises(SubscriptionSecretNotFound):
            await service.report_login_failure(
                project_id=PROJECT_ID,
                secret_id=secret.id,
                version=3,
                generation=1,
                reason="refresh_rejected",
            )

    async def test_a_device_login_is_not_reported_as_stored(
        self, vault, runner, service
    ):
        """The worst of the three: the browser would show a sign-in that never landed."""
        secret = await self._vanishing(
            vault,
            {"login_attempt": {"id": "att-1", "expires_at": _later()}},
        )
        runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1", state="succeeded", login=LOGIN
        )

        with pytest.raises(SubscriptionSecretNotFound):
            await service.read_attempt(
                project_id=PROJECT_ID, secret_id=secret.id, attempt_id="att-1"
            )


class TestReportedFailure:
    async def test_a_failure_on_the_current_lineage_marks_the_login_dead(
        self, vault, service
    ):
        secret = await _make_secret(
            vault,
            {
                "login": LOGIN,
                "login_version": 3,
                "login_generation": 1,
                "login_state": "ready",
            },
        )

        result = await service.report_login_failure(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            version=3,
            generation=1,
            reason="refresh_rejected",
        )

        assert result.stale is False
        assert result.version == 3
        assert result.generation == 1
        assert result.login is None

        stored = await _read(vault, secret.id)
        assert stored.data.login_state == SubscriptionLoginState.NEEDS_LOGIN
        assert stored.data.login_error == "refresh_rejected"

    async def test_a_newer_stored_version_is_stale_and_returns_the_login(
        self, vault, service
    ):
        secret = await _make_secret(
            vault,
            {
                "login": LOGIN,
                "login_version": 5,
                "login_generation": 1,
                "login_state": "ready",
            },
        )

        result = await service.report_login_failure(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            version=3,
            generation=1,
            reason="refresh_rejected",
        )

        assert result.stale is True
        assert result.version == 5
        assert result.generation == 1
        assert result.login["refresh"] == "refresh-1"

        stored = await _read(vault, secret.id)
        assert stored.data.login_state == SubscriptionLoginState.READY
        assert stored.data.login_error is None

    async def test_a_newer_stored_generation_is_stale(self, vault, service):
        secret = await _make_secret(
            vault,
            {
                "login": LOGIN,
                "login_version": 1,
                "login_generation": 4,
                "login_state": "ready",
            },
        )

        result = await service.report_login_failure(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            version=1,
            generation=2,
            reason="refresh_rejected",
        )

        assert result.stale is True
        assert result.generation == 4
        assert result.login is not None
        assert (
            await _read(vault, secret.id)
        ).data.login_state == SubscriptionLoginState.READY

    async def test_a_long_reason_is_clipped(self, vault, service):
        secret = await _make_secret(vault, {"login": LOGIN, "login_version": 1})

        await service.report_login_failure(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            version=1,
            generation=0,
            reason="x" * 500,
        )

        assert len((await _read(vault, secret.id)).data.login_error) == 200
