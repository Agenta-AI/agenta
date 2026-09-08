"""The subscription login state machine, over a fake runner and a fake vault row.

Two flows meet on the same row. A browser starts, polls, and cancels a device login. A run
pushes a refreshed login back, or reports that its login stopped working. The fake DAO
below stores through the real postgres mappings, so the JSON round trip is exercised too.
"""

import asyncio
from datetime import datetime, timedelta, timezone
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

LOGIN = {
    "type": "oauth",
    "access": "access-1",
    "refresh": "refresh-1",
    "expires": 1_000,
    "accountId": "acct-1",
}


def _later(minutes: int = 10) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


class _FakeSecretsDAO:
    """Stores rows the way the postgres DAO does: mapped, encrypted-shaped, JSON."""

    def __init__(self):
        self.rows: dict = {}

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
            update_secret_dto = resolve_update(
                map_secrets_dbe_to_dto(secrets_dbe=dbe),
                update_secret_dto,
            )

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
        self.raises: Optional[Exception] = None
        self.deleted: list = []
        self.reads = 0
        # Set it to hold a poll inside the runner call, so the test can move the row on
        # underneath a poll that is already in flight.
        self.read_gate: Optional[asyncio.Event] = None

    async def start_attempt(self, *, provider):
        if self.raises is not None:
            raise self.raises
        return self.next_start or self.next_attempt

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
    return await vault.create_secret(
        project_id=PROJECT_ID,
        create_secret_dto=CreateSecretDTO.model_validate(
            {
                "header": {"name": "ChatGPT"},
                "secret": {"kind": "subscription_provider", "data": data or {}},
            }
        ),
    )


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
        assert stored.data.login.access == "access-1"
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
        assert stored.data.login_attempt.id == "att-1"

    async def test_a_failed_attempt_clears_the_attempt_and_records_the_reason(
        self, vault, runner, service
    ):
        secret = await _make_secret(
            vault,
            {"login_attempt": {"id": "att-1", "expires_at": _later()}},
        )
        runner.next_attempt = RunnerLoginAttempt(
            attempt_id="att-1", state="failed", error="access_denied"
        )

        view = await service.read_attempt(
            project_id=PROJECT_ID, secret_id=secret.id, attempt_id="att-1"
        )

        assert view.state == "failed"
        stored = await _read(vault, secret.id)
        assert stored.data.login_attempt is None
        assert stored.data.login_error == "access_denied"

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
            "access": "access-2",
            "refresh": "refresh-2",
            "expires": 2_000,
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
            login={**LOGIN, "expires": 5_000},
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
            login={**LOGIN, "refresh": "refresh-0", "expires": 500},
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
            login={**LOGIN, "refresh": "refresh-old", "expires": 9_000},
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
            login={**LOGIN, "refresh": "refresh-2", "expires": 9_000},
            version=3,
            generation=9,
        )

        assert result.updated is False
        assert result.stale is False
        assert result.login is None

    async def test_a_login_for_another_account_is_refused(self, vault, service):
        secret = await self._ready(vault)
        other = {
            **LOGIN,
            "accountId": "acct-2",
            "refresh": "refresh-2",
            "expires": 9_000,
        }

        result = await service.push_login(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            login=other,
            version=3,
            generation=1,
        )

        assert result.updated is False
        assert (await _read(vault, secret.id)).data.login.accountId == "acct-1"

    async def test_a_push_to_a_connection_with_no_login_is_refused(
        self, vault, service
    ):
        secret = await _make_secret(vault)

        result = await service.push_login(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            login={**LOGIN, "expires": 9_000},
            version=0,
            generation=0,
        )

        assert result.updated is False
        assert (await _read(vault, secret.id)).data.login is None

    async def test_a_stored_error_is_cleared_when_a_refresh_lands(self, vault, service):
        secret = await self._ready(
            vault, login_state="needs_login", login_error="refresh_rejected"
        )

        await service.push_login(
            project_id=PROJECT_ID,
            secret_id=secret.id,
            login={**LOGIN, "refresh": "refresh-2", "expires": 2_000},
            version=3,
            generation=1,
        )

        stored = await _read(vault, secret.id)
        assert stored.data.login_state == SubscriptionLoginState.READY
        assert stored.data.login_error is None


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
