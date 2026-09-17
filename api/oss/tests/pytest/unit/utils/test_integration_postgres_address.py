"""Where the integration layer looks for its database, whose database it accepts, and what it
does when it finds neither.

D97 was the first two halves. The loopback fallback kept the IN-NETWORK port when rewriting the
host, so a host-side run dialled `127.0.0.1:5432` — on a box running several stacks, whichever
one happened to bind that port, and against the stack this release was QA'd on, nothing at all.
And the layer SKIPPED what it could not reach, so 93 of 101 cases skipped and the process exited
0, which a release gate reads as green.

D128 is the third. A published port that opens a connection proves a server is listening and
nothing more, and every EE stack on a box names its database `agenta_ee_core`, so a stale port
reached a real database with the expected name and the wrong owner and the seeding fixtures went
in. The cases below pin the identity check that closes it: the deployment is the one whose API
wrote the marker row, and any other answering database is a failure naming both sides.
"""

from __future__ import annotations

from uuid import UUID

import pytest

from oss.tests.pytest.utils import deployment, postgres as helper

_IN_NETWORK = "postgresql+asyncpg://username:password@postgres:5432/agenta_ee_core"
_LOOPBACK = "postgresql+asyncpg://username:password@127.0.0.1:5452/agenta_ee_core"
_MARKER = UUID("01a0ad38-a128-7bd3-ba7e-eda5735f114e")
_API = "https://api.under.test/api"


# Bound at import, before any case replaces the module attributes: the cached objects are
# what hold the answers, so they are what has to be cleared even while a stub stands in front
# of one of them.
_CACHED = (
    helper.resolve_core_uri,
    helper.resolve_tracing_uri,
    helper.confirm_deployment_under_test,
)


@pytest.fixture(autouse=True)
def _forget_the_cached_answers():
    """These answers are cached for the session; every case here changes their inputs."""
    for cached in _CACHED:
        cached.cache_clear()
    yield
    for cached in _CACHED:
        cached.cache_clear()


@pytest.fixture
def marker_row(monkeypatch, tmp_path):
    """The marker as if the API under test had minted it, without a deployment to mint it.

    The removal is recorded rather than performed, because a case about what the check
    decides is also a case about the check taking its own row back out.
    """
    monkeypatch.setenv("AGENTA_API_URL", _API)
    monkeypatch.setenv("AGENTA_AUTH_KEY", "the-key")
    monkeypatch.setattr(helper, "tempfile", _TempDir(tmp_path))
    monkeypatch.setattr(helper, "mint_deployment_marker", lambda _api, _key: _MARKER)
    monkeypatch.setattr(
        helper,
        "remove_deployment_marker",
        lambda api_url, _key, identifier: removed.append((api_url, identifier)),
    )
    removed: list = []
    return removed


class _TempDir:
    """Stands in for the `tempfile` module, so a verdict file lands in this case's own dir."""

    def __init__(self, path):
        self._path = path

    def gettempdir(self):
        return str(self._path)


def _answers_with(carried: set[UUID]):
    async def _carries_user(dsn, identifier):  # noqa: ANN001 — stub for the real probe
        return identifier in carried

    return _carries_user


def test_the_loopback_address_uses_the_published_port(monkeypatch):
    monkeypatch.setenv("POSTGRES_PORT", "5452")

    assert (
        helper._on_loopback(_IN_NETWORK)
        == "postgresql+asyncpg://username:password@127.0.0.1:5452/agenta_ee_core"
    )


def test_a_stack_that_published_no_port_keeps_the_container_port(monkeypatch):
    """Every stack allocated before the per-worktree ports publishes on 5432, and this is
    the only case in which dialling it is the right answer."""
    monkeypatch.delenv("POSTGRES_PORT", raising=False)

    assert helper._on_loopback(_IN_NETWORK).endswith("@127.0.0.1:5432/agenta_ee_core")


def test_a_malformed_published_port_is_the_operators_to_see(monkeypatch):
    monkeypatch.setenv("POSTGRES_PORT", "not-a-port")

    with pytest.raises(AssertionError, match="POSTGRES_PORT"):
        helper.published_port()


def test_an_unreachable_database_fails_the_run(monkeypatch):
    """The whole point. A skip here reported a green run in which nothing executed."""
    monkeypatch.setattr(helper, "_connectable", lambda _uri: False)
    monkeypatch.setenv("POSTGRES_PORT", "5452")

    with pytest.raises(AssertionError) as refusal:
        helper.require_core_uri()

    message = str(refusal.value)
    # The sentence has to name what to change, because the reader of it is someone who
    # pointed a suite at the wrong stack.
    assert "POSTGRES_URI_CORE" in message
    assert "POSTGRES_PORT" in message
    # Both addresses it tried, so the reader can see which stack it went looking for.
    assert "postgres:5432" in message
    assert "127.0.0.1:5452" in message
    # And not the credentials, because this lands in a test log.
    assert "password" not in message


def test_an_unreachable_database_still_fails_when_nothing_declared_its_absence(
    monkeypatch,
):
    """The declaration has to be made, not inferred. Absent it, the refusal stands."""
    monkeypatch.delenv("AGENTA_TEST_NO_DATABASE", raising=False)
    monkeypatch.setattr(helper, "_connectable", lambda _uri: False)

    assert deployment.declares_no_database() is False
    with pytest.raises(AssertionError):
        deployment.guard_the_deployment_under_test(databases=("core",))


@pytest.mark.parametrize("declared", ["1", "true", "yes", "anything"])
def test_a_declared_absence_skips_by_name_rather_than_failing(monkeypatch, declared):
    """A deployment that publishes no database says so, and the skip names the declaration.

    The Railway job tests a deployed stack over HTTP and has no route to its Postgres. Before
    this the layer refused, which is right wherever the absence is an accident; there it is a
    fact about the environment. The reason is spelled out so the skip is visible in the run's
    own output rather than being a silent green (D97, and the reason that rule exists).
    """
    monkeypatch.setenv("AGENTA_TEST_NO_DATABASE", declared)
    monkeypatch.setattr(helper, "_connectable", lambda _uri: False)

    assert deployment.declares_no_database() is True
    # `pytest.skip` raises through `BaseException`, so a plain `Exception` never catches it
    # and the skip would land on this case instead of being asserted about.
    with pytest.raises(pytest.skip.Exception) as outcome:
        deployment.guard_the_deployment_under_test(databases=("core",))

    assert "declares no database access" in str(outcome.value)
    assert "AGENTA_TEST_NO_DATABASE" in str(outcome.value)


@pytest.mark.parametrize("off", ["", "0", "false", "no"])
def test_a_variable_turned_off_is_not_a_declaration(monkeypatch, off):
    """Set-and-empty is how a workflow turns one of these off, so it must not read as set."""
    monkeypatch.setenv("AGENTA_TEST_NO_DATABASE", off)

    assert deployment.declares_no_database() is False


def test_a_reachable_database_is_returned_and_installed(monkeypatch, marker_row):
    """Confirmed, and the marker account is taken back out whatever the verdict.

    Through the guard, because that is what the layers run. These two cases used to call
    `require_core_uri`, which no layer reaches any more: it is the helper one migration case
    builds its own database with, so a case named for what the layers do was covering a path
    they do not take (D163).
    """
    monkeypatch.setenv("AGENTA_LICENSE", "ee")
    monkeypatch.setattr(helper, "_connectable", lambda uri: "127.0.0.1" in uri)
    monkeypatch.setattr(helper, "_carries_user", _answers_with({_MARKER}))
    monkeypatch.setenv("POSTGRES_PORT", "5452")
    monkeypatch.setattr(helper.env.postgres, "uri_core", _IN_NETWORK)

    deployment.guard_the_deployment_under_test(databases=("core",))

    # Installed on the shared `env`, so an engine built later dials the same server.
    assert helper.env.postgres.uri_core.endswith("@127.0.0.1:5452/agenta_ee_core")
    assert marker_row == [(_API, _MARKER)]


def test_another_deployments_database_fails_before_anything_is_seeded(
    monkeypatch, marker_row
):
    """D128. It answers, it is called `agenta_ee_core`, and it is not this deployment's."""
    monkeypatch.setattr(helper, "_connectable", lambda _uri: True)
    monkeypatch.setattr(helper, "_carries_user", _answers_with(set()))
    monkeypatch.setenv("POSTGRES_PORT", "5447")
    monkeypatch.setattr(helper.env.postgres, "uri_core", _LOOPBACK)
    monkeypatch.setenv("AGENTA_LICENSE", "ee")

    with pytest.raises(AssertionError) as refusal:
        deployment.guard_the_deployment_under_test(databases=("core",))

    # A refusing run leaves nothing behind either: the row goes out before the refusal.
    assert marker_row == [(_API, _MARKER)]

    message = str(refusal.value)
    # Both sides, because the reader has to see which two things disagree.
    assert _API in message
    assert str(_MARKER) in message
    assert "127.0.0.1:5452" in message
    # And what to change, and never the credentials.
    assert "POSTGRES_PORT" in message
    assert "5447" in message
    assert "password" not in message


def test_a_database_the_marker_cannot_be_read_from_is_refused(monkeypatch, marker_row):
    """A database with no `users` table is somebody else's too, not an inconclusive answer."""

    async def _explodes(dsn, identifier):  # noqa: ANN001 — stub for the real probe
        raise RuntimeError('relation "users" does not exist')

    monkeypatch.setattr(helper, "_connectable", lambda _uri: True)
    monkeypatch.setattr(helper, "_carries_user", _explodes)
    monkeypatch.setattr(helper.env.postgres, "uri_core", _LOOPBACK)

    with pytest.raises(AssertionError, match="RuntimeError"):
        helper.require_core_uri()


def test_a_suite_that_cannot_name_the_api_under_test_fails(monkeypatch):
    """Identity needs a deployment to ask. Not knowing which one is a failure, not a skip."""
    monkeypatch.delenv("AGENTA_API_URL", raising=False)
    monkeypatch.setenv("AGENTA_AUTH_KEY", "any-key")

    with pytest.raises(AssertionError) as refusal:
        helper.api_under_test()

    message = str(refusal.value)
    assert "AGENTA_API_URL" in message
    assert "AGENTA_AUTH_KEY" in message
    assert "any-key" not in message


def test_the_marker_is_minted_by_the_api_under_test(monkeypatch):
    """The row has to be written through the API, never into a database this module dialled."""
    sent = {}

    class _Answer:
        status_code = 200

        @staticmethod
        def json():
            return {"accounts": {"user": {"user": {"id": str(_MARKER)}}}}

    def _post(url, **kwargs):
        sent["url"] = url
        sent["headers"] = kwargs["headers"]
        return _Answer()

    monkeypatch.setattr(helper.httpx, "post", _post)

    identifier = helper.mint_deployment_marker(_API, "the-key")

    assert identifier == _MARKER
    assert sent["url"] == f"{_API}/admin/simple/accounts/"
    assert sent["headers"]["Authorization"] == "Access the-key"


def test_one_marker_is_minted_however_many_workers_ask(monkeypatch, tmp_path):
    """The check writes to the deployment, so it is worth one account per run, not per worker.

    Twenty workers of one run read the same verdict file, and only the first to claim the
    lock mints anything. Standing in for the workers with repeated calls is enough: what is
    being pinned is that the decision is published and reused, not that processes race.
    """
    minted: list = []
    monkeypatch.setenv("AGENTA_API_URL", _API)
    monkeypatch.setenv("AGENTA_AUTH_KEY", "the-key")
    monkeypatch.setenv("PYTEST_XDIST_TESTRUNUID", "one-run")
    monkeypatch.setattr(helper, "tempfile", _TempDir(tmp_path))
    monkeypatch.setattr(
        helper,
        "mint_deployment_marker",
        lambda _api, _key: minted.append(_MARKER) or _MARKER,
    )
    monkeypatch.setattr(helper, "remove_deployment_marker", lambda *_args: None)
    monkeypatch.setattr(helper, "_carries_user", _answers_with({_MARKER}))

    for _ in range(20):
        helper.confirm_deployment_under_test.cache_clear()
        helper.confirm_deployment_under_test(_LOOPBACK)

    assert len(minted) == 1


def test_the_tracing_database_is_resolved_on_its_own(monkeypatch):
    """The sessions record cases read this one, and only core used to be resolved.

    One server publishes both, so the address work is identical and the database name is all
    that differs. Nothing rewrote this one, so those cases dialled the in-network host name
    from the host and ended in a name-resolution error that read as a broken shell.
    """
    monkeypatch.setattr(helper, "_connectable", lambda uri: "127.0.0.1" in uri)
    monkeypatch.setenv("POSTGRES_PORT", "5452")
    monkeypatch.setattr(helper.env.postgres, "uri_core", _IN_NETWORK)
    monkeypatch.setattr(
        helper.env.postgres,
        "uri_tracing",
        "postgresql+asyncpg://username:password@postgres:5432/agenta_ee_tracing",
    )

    assert helper.use_reachable_tracing_uri().endswith(
        "@127.0.0.1:5452/agenta_ee_tracing"
    )
    # Installed, because the analytics engine is built after this and reads it off `env`.
    assert helper.env.postgres.uri_tracing.endswith("@127.0.0.1:5452/agenta_ee_tracing")
    # And separate: resolving one says nothing about the other.
    assert helper.env.postgres.uri_core == _IN_NETWORK


def test_an_unreachable_tracing_database_resolves_to_nothing(monkeypatch):
    monkeypatch.setattr(helper, "_connectable", lambda _uri: False)
    monkeypatch.setattr(
        helper.env.postgres,
        "uri_tracing",
        "postgresql+asyncpg://username:password@postgres:5432/agenta_ee_tracing",
    )

    assert helper.use_reachable_tracing_uri() is None


class TestASecondDatabaseIsOnTheServerThatWasIdentified:
    """D141. The marker row lives in the core database, so it speaks for that database and
    the server carrying it, and for nothing else. A layer that reads a second database has
    to be told the second one is on the same server, or it is writing somewhere no evidence
    covers — which is what a tracing address pointed at another stack did."""

    _IDENTIFIED = "postgresql+asyncpg://username:password@127.0.0.1:5452/agenta_ee_core"

    def test_the_same_server_under_its_other_name_is_accepted(self):
        helper.confirm_same_server(
            self._IDENTIFIED,
            "postgresql+asyncpg://username:password@localhost:5452/agenta_ee_tracing",
            database="tracing",
        )

    def test_another_server_is_refused_naming_both(self):
        with pytest.raises(AssertionError) as refusal:
            helper.confirm_same_server(
                self._IDENTIFIED,
                "postgresql+asyncpg://username:password@127.0.0.1:5437/agenta_ee_tracing",
                database="tracing",
            )

        message = str(refusal.value)
        assert "127.0.0.1:5452" in message
        assert "127.0.0.1:5437" in message
        assert "POSTGRES_URI_TRACING" in message
        assert "password" not in message


class TestNothingGlobalChangesUntilTheAddressIsProven:
    """Installing points the shared `env` at an address, and every engine built afterwards
    in the process reads it. A refusal that had already installed would leave the process
    pointed at a stranger's database for whatever ran next."""

    @pytest.fixture(autouse=True)
    def _a_deployment_that_answers(self, monkeypatch, marker_row):
        # Stated, because a run that does not say what the deployment calls its databases is
        # refused before any of this (D146).
        monkeypatch.setenv("AGENTA_LICENSE", "ee")
        monkeypatch.setattr(helper, "_connectable", lambda _uri: True)
        monkeypatch.setenv("POSTGRES_PORT", "5452")
        monkeypatch.setattr(helper.env.postgres, "uri_core", _LOOPBACK)
        monkeypatch.setattr(
            helper.env.postgres,
            "uri_tracing",
            "postgresql+asyncpg://username:password@127.0.0.1:5437/agenta_ee_tracing",
        )

    def test_a_refused_second_address_installs_neither(self, monkeypatch):
        monkeypatch.setattr(helper, "_carries_user", _answers_with({_MARKER}))

        with pytest.raises(AssertionError, match="not on the server it identified"):
            deployment.guard_the_deployment_under_test(databases=("core", "tracing"))

        assert helper.env.postgres.uri_core == _LOOPBACK
        assert helper.env.postgres.uri_tracing.endswith(
            "@127.0.0.1:5437/agenta_ee_tracing"
        )

    def test_a_refused_identity_installs_nothing(self, monkeypatch):
        monkeypatch.setattr(helper, "_carries_user", _answers_with(set()))

        with pytest.raises(AssertionError, match="not the deployment under test"):
            deployment.guard_the_deployment_under_test(databases=("core",))

        assert helper.env.postgres.uri_core == _LOOPBACK


class TestARunThatCannotNameTheDatabasesFails:
    """D146. The names are composed from the licence, unset reads as OSS, and a layer that
    skips what it cannot reach then reports a green run of nothing against an EE stack."""

    def test_an_unstated_licence_fails_naming_the_variable(self, monkeypatch):
        for variable in ("AGENTA_LICENSE", "POSTGRES_DB_PREFIX", "POSTGRES_URI_CORE"):
            monkeypatch.delenv(variable, raising=False)

        with pytest.raises(AssertionError) as refusal:
            helper.confirm_the_deployment_names_its_databases()

        message = str(refusal.value)
        assert "AGENTA_LICENSE" in message
        # And the two other ways of saying it, so the reader is not sent to the only one.
        assert "POSTGRES_DB_PREFIX" in message
        assert "POSTGRES_URI_CORE" in message

    @pytest.mark.parametrize(
        "variable, value",
        [
            ("AGENTA_LICENSE", "ee"),
            ("POSTGRES_DB_PREFIX", "agenta_oss"),
            ("POSTGRES_URI_CORE", _IN_NETWORK),
        ],
    )
    def test_any_of_the_three_ways_of_saying_it_is_enough(
        self, monkeypatch, variable, value
    ):
        for name in ("AGENTA_LICENSE", "POSTGRES_DB_PREFIX", "POSTGRES_URI_CORE"):
            monkeypatch.delenv(name, raising=False)
        monkeypatch.setenv(variable, value)

        helper.confirm_the_deployment_names_its_databases()


def test_an_unreachable_database_fails_every_layer(monkeypatch):
    """D148. The sessions layer skipped what it could not reach and reported 18 skipped and
    exit 0, which is a green run of nothing against a deployment it never touched. There is
    no layer for which that is the right answer, so there is no longer a way to ask for it."""
    monkeypatch.setenv("AGENTA_LICENSE", "ee")
    monkeypatch.setattr(helper, "_connectable", lambda _uri: False)

    with pytest.raises(AssertionError, match="could not reach this deployment's core"):
        deployment.guard_the_deployment_under_test(databases=("core", "tracing"))


def test_the_migration_helper_still_refuses_another_deployment(monkeypatch, marker_row):
    """`require_core_uri` has one caller left, and it creates a database of its own.

    `test_mcp_oauth_grant_rekey_migration` builds a scratch database on whatever server this
    returns, so the helper keeps its own case rather than riding on the layers', which no
    longer go through it.
    """
    monkeypatch.setenv("AGENTA_LICENSE", "ee")
    monkeypatch.setattr(helper, "_connectable", lambda _uri: True)
    monkeypatch.setattr(helper, "_carries_user", _answers_with(set()))
    monkeypatch.setattr(helper.env.postgres, "uri_core", _LOOPBACK)

    with pytest.raises(AssertionError, match="not the deployment under test"):
        helper.require_core_uri()
