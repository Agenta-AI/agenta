"""One guard for every integration layer that runs against a deployment's database.

A layer that reaches a database has two questions to settle before any of its cases mean
anything: whether it found one, and whether the one it found belongs to the deployment under
test. The second is the dangerous one. Every EE stack on a box publishes a database called
`agenta_ee_core` on a port of its own, so a stale `POSTGRES_PORT` opens a real connection to a
real database with the expected name and the wrong owner, and the cases seed into it (D128).

The gateway layer had that guard and the sessions layer did not, so the same stale port that
made one refuse made the other run to completion against somebody else's rows (D141). The
guard lives here once, and each layer states its own three things by overriding the fixtures
below rather than by restating the guard:

- `deployment_databases`, the addresses its cases actually read;
- `deployment_applies`, whether a given case touches the deployment at all.

An unreachable database is a failure for every layer, with no knob to soften it. A layer that
skips what it cannot reach reports a green run of nothing, which is what D97 was and what the
sessions layer still did until D148: 18 skipped, exit 0, against a deployment it never
touched.

There is one declared exception, and it is a statement of fact rather than a knob:
`AGENTA_TEST_NO_DATABASE`. Some deployments publish no database at all to the runner of these
tests — the Railway job in `44-railway-tests.yml` tests a remote deployment over HTTP and has
no route to its Postgres. Before D97 those cases skipped silently and the job read green,
which is exactly the failure D97 closed. Setting the variable makes that environment say so:
every database-bound case then skips with a reason naming the declaration, so the skip is
visible in the run's own output. Absent the declaration an unreachable database still fails
hard. The difference is whether the environment declared it, not whether the database
answered.

Identity is always settled on the core database, whichever addresses a layer lists, and always
before the layer's other addresses are resolved. The marker row it reads is a `users` row, so
it can speak for the core database and for the server carrying it, and for no other database
by itself: every further address the layer reads is therefore required to be on that same
server. Identity failure is never a skip: a layer that cannot prove whose database it has must
not write to it.
"""

import pytest

from oss.src.utils.env import env
from oss.tests.pytest.utils.postgres import (
    confirm_deployment_under_test,
    confirm_same_server,
    confirm_the_deployment_names_its_databases,
    resolve_core_uri,
    resolve_tracing_uri,
    declares_no_database,
    skip_for_declared_absence,
    unreachable,
    use_reachable_core_uri,
    use_reachable_tracing_uri,
)

# Finding an address and installing it on the shared `env` are two steps here, because
# installing is global: every engine built afterwards in this process reads what was
# installed. Nothing is installed until the address has been proven to be this deployment's.
_RESOLVERS = {
    "core": resolve_core_uri,
    "tracing": resolve_tracing_uri,
}

_INSTALLERS = {
    "core": use_reachable_core_uri,
    "tracing": use_reachable_tracing_uri,
}


GUARD = "the_deployment_under_test"


def assert_the_guard_is_installed(request) -> None:
    """Fail if this layer is not running the guard on every one of its cases.

    The guard reaches a layer by one import in its conftest, carrying a lint suppression
    because nothing in that file uses the name. Delete the import and every case in the layer
    still passes, while nothing stands between the suite and another deployment's database;
    `ruff --fix` would delete it as unused (D163). So each layer asserts it is there.

    Autouse is what is being checked, not merely registration: `request.fixturenames` lists
    what this case was given, and the caller does not ask for the guard, so its presence means
    the layer applies it to everything.
    """
    assert GUARD in request.fixturenames, (
        f"this layer is not running the deployment guard: no fixture named {GUARD} reached "
        "this case. Its conftest imports the guard from oss/tests/pytest/utils/deployment.py, "
        "and that import is the whole of the wiring — without it nothing checks which "
        "deployment's database the layer is about to write to (D163)."
    )


@pytest.fixture
def deployment_databases():
    """Which of the deployment's databases this layer's cases read."""
    return ("core",)


@pytest.fixture
def deployment_applies():
    """Whether this case touches the deployment at all. Layers with a mixed directory override."""
    return True


def guard_the_deployment_under_test(*, databases) -> None:
    """Find the deployment, prove it is the right one, then let anything global change.

    The order is the guard. What the deployment calls its databases is settled before any of
    them is dialled, because a name composed from a licence nobody stated sends the layer
    looking for a database that does not exist and, where absence is a skip, reports that as
    green. Core is resolved first after that, because a layer with no database to reach
    must end before the identity check asks the deployment for anything, so an unreachable
    run writes nothing anywhere. Identity is settled next, before any other address, because
    a server that is not this deployment's is a refusal and must never become a skip on the
    way there. Every other address the layer reads has to be on that same server, since the
    marker row that settles identity lives in the core database and cannot speak for another.

    Installing comes last, and only once every address has passed, because installing is
    global: a refusal that had already pointed the shared `env` at a stranger's database
    would leave it pointed there for whatever ran next in the process.

    A plain function, because the ordering above is the whole point of it and a fixture is
    hard to hold still long enough to check that.
    """
    if declares_no_database():
        skip_for_declared_absence()

    confirm_the_deployment_names_its_databases()

    core = _RESOLVERS["core"]()
    if core is None:
        raise unreachable("core")

    confirm_deployment_under_test(core)

    for database in databases:
        if database == "core":
            continue
        address = _RESOLVERS[database]()
        if address is None:
            raise unreachable(database)
        confirm_same_server(core, address, database=database)

    for database in ("core", *databases):
        _INSTALLERS[database]()


_ADDRESSES = ("core", "tracing")


@pytest.fixture(autouse=True)
def the_deployment_under_test(deployment_applies, deployment_databases):
    """The guard above, run before every case, with the addresses it installs given back after.

    Installing points the shared settings object at a host address, and that object outlives
    the layer: it is one singleton for the process. Left installed, it turned a later unit
    directory in the same worker into a different suite — `unit/sessions` skips its DAO cases
    when the configured core database is unreachable, and after an integration file had run,
    the address it left behind was reachable, so 142 cases that had skipped ran instead. What
    a case does then depended on what ran before it in that worker, which under `-n auto` is
    not the same twice (D152).
    """
    if not deployment_applies:
        yield
        return

    installed = {name: getattr(env.postgres, f"uri_{name}") for name in _ADDRESSES}
    try:
        guard_the_deployment_under_test(databases=deployment_databases)
        yield
    finally:
        for name, address in installed.items():
            setattr(env.postgres, f"uri_{name}", address)
