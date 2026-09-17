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
- `deployment_absence`, what an unreachable database means for it;
- `deployment_applies`, whether a given case touches the deployment at all.

Identity is always settled on the core database, whichever addresses a layer lists, and always
before the layer's other addresses are resolved. The marker row it reads is a `users` row, so
it can speak for the core database and for the server carrying it, and for no other database
by itself: every further address the layer reads is therefore required to be on that same
server. Identity failure is never a skip: a layer that cannot prove whose database it has must
not write to it.
"""

import pytest

from oss.tests.pytest.utils.postgres import (
    confirm_deployment_under_test,
    confirm_same_server,
    confirm_the_deployment_names_its_databases,
    resolve_core_uri,
    resolve_tracing_uri,
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


@pytest.fixture
def deployment_databases():
    """Which of the deployment's databases this layer's cases read."""
    return ("core",)


@pytest.fixture
def deployment_absence():
    """What an unreachable database means here: `fail`, or `skip` for a layer not yet moved."""
    return "fail"


@pytest.fixture
def deployment_applies():
    """Whether this case touches the deployment at all. Layers with a mixed directory override."""
    return True


def _absent(database: str, absence: str):
    if absence == "skip":
        pytest.skip(
            f"the {database} database of the deployment under test is not reachable"
        )
    raise unreachable(database)


def guard_the_deployment_under_test(*, databases, absence: str) -> None:
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
    confirm_the_deployment_names_its_databases()

    core = _RESOLVERS["core"]()
    if core is None:
        _absent("core", absence)

    confirm_deployment_under_test(core)

    for database in databases:
        if database == "core":
            continue
        address = _RESOLVERS[database]()
        if address is None:
            _absent(database, absence)
        confirm_same_server(core, address, database=database)

    for database in ("core", *databases):
        _INSTALLERS[database]()


@pytest.fixture(autouse=True)
def the_deployment_under_test(
    deployment_applies,
    deployment_databases,
    deployment_absence,
):
    """The guard above, run before every case of a layer that reads a deployment's database."""
    if not deployment_applies:
        return

    guard_the_deployment_under_test(
        databases=deployment_databases,
        absence=deployment_absence,
    )
