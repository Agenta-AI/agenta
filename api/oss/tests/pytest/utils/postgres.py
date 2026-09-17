"""Which Postgres the integration layer runs against, and whether it is the right one.

Two questions, and the second one is the one that bites. The first is where the server is:
inside the compose network it is `postgres:5432`, which is what every container reads out of
the deployment's env file and is correct there, while on the host that same server is reached
through a **published** port, which `env.sh` allocates per worktree so two stacks can run
side by side, and which the stack's own env file records as `POSTGRES_PORT`. Those are
different numbers, and reading the in-network one as the host one is how a host-side run
dials nothing at all (D97). The mock-gateway addresses had the same two meanings and the same
defect (D76).

The second question is whose database answered. Opening a real connection proves a server is
listening; it proves nothing about which deployment it serves. The database name does not
settle it either: it separates licences and nothing else, so every EE stack on a box calls its
database `agenta_ee_core` while publishing it on a port of its own. A stale, guessed or unset
`POSTGRES_PORT` therefore reaches a real database with the expected name and the wrong owner,
and the seeding fixtures write this release's cases into a deployment nobody named (D128).

So the address is checked for identity as well as reachability: the API under test writes a
row through its own API, and the database this module dialled has to have that row. Nothing
else distinguishes two stacks that run the same schema. Both checks fail loudly, because the
layer that skipped what it could not find reported a green run in which 93 of 101 cases did
not execute (D97).
"""

import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from typing import Awaitable, Callable, Optional, Tuple, TypeVar
from urllib.parse import urlparse, urlunparse
from uuid import UUID, uuid4

import httpx

from oss.src.utils.env import env

# What the server listens on inside the compose network. Fixed, because the published port is
# remapped onto it, so it is never the value that moves.
_CONTAINER_PORT = 5432

_CONNECT_TIMEOUT = 2.0

# The endpoint every test layer already uses to mint ephemeral accounts, and the only write
# this module makes. It goes through the API under test, never into a database this module
# dialled: writing into an address whose owner is still unproven is the accident the identity
# check exists to prevent.
_ACCOUNTS_PATH = "/admin/simple/accounts/"
_ACCOUNTS_TIMEOUT = 30.0

_Result = TypeVar("_Result")


def _blocking(work: Callable[[], Awaitable[_Result]]) -> _Result:
    """Run one coroutine to completion, whether or not a loop is already running.

    These helpers are called from a synchronous fixture in one place and from inside an
    async fixture in another (`test_mcp_oauth_grant_rekey_migration`). `asyncio.run` refuses
    the second, and that refusal used to be answered by assuming the database was fine,
    which switched the guard off in the one caller that goes on to create a database. A
    private thread carries no loop, so both callers get a real answer.
    """
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(lambda: asyncio.run(work())).result()


def _dsn(uri: str) -> str:
    return uri.replace("postgresql+asyncpg://", "postgresql://")


async def _can_connect(dsn: str) -> bool:
    import asyncpg

    try:
        connection = await asyncio.wait_for(
            asyncpg.connect(dsn), timeout=_CONNECT_TIMEOUT
        )
    except (OSError, asyncio.TimeoutError, asyncpg.PostgresError):
        return False

    await connection.close()
    return True


def _connectable(uri: str) -> bool:
    return _blocking(lambda: _can_connect(_dsn(uri)))


def published_port() -> Optional[int]:
    """The host port compose published for this stack's Postgres, if its env file says.

    `None` means nothing declared one, which is a stack that predates the allocation and
    publishes on the container port. A malformed value is the operator's to see rather than
    something to fall back from: falling back silently is how a suite ends up dialling a port
    nobody asked for.
    """
    raw = (os.getenv("POSTGRES_PORT") or "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        raise AssertionError(f"POSTGRES_PORT is not a port number: {raw!r}") from None


def _on_loopback(uri: str) -> str:
    """The same server as the host reaches it: loopback, on the PUBLISHED port.

    Keeping the in-network port here was D97. `postgres:5432` became `127.0.0.1:5432`, which
    on a box running several stacks is whichever one happened to bind 5432, and on this one
    was an unrelated deployment.
    """
    parsed = urlparse(uri)
    userinfo = parsed.netloc.rsplit("@", 1)[0] if "@" in parsed.netloc else ""
    port = published_port() or parsed.port or _CONTAINER_PORT
    host = f"127.0.0.1:{port}"
    return urlunparse(
        parsed._replace(netloc=f"{userinfo}@{host}" if userinfo else host)
    )


def _reachable(uri: str) -> Optional[str]:
    """The URI as configured, else the same database on the published loopback port."""
    if _connectable(uri):
        return uri

    loopback = _on_loopback(uri)
    if loopback != uri and _connectable(loopback):
        return loopback

    return None


@lru_cache(maxsize=1)
def resolve_core_uri() -> Optional[str]:
    """The core database, where the deployment's tenants and their rows live.

    None means this deployment's Postgres is not reachable. Callers in the integration layer
    must not read that as "skip": see :func:`require_core_uri`.
    """
    return _reachable(env.postgres.uri_core)


@lru_cache(maxsize=1)
def resolve_tracing_uri() -> Optional[str]:
    """The tracing database, which the analytics engine reads and nothing else rewrites.

    One server publishes both, so this is the same address work with a different database
    name on the end. It is separate because a layer can need one and not the other: the
    gateway cases only ever touch core, and the sessions record cases build their DAOs on
    `get_analytics_engine()`, which reads `env.postgres.uri_tracing` and therefore kept the
    in-network host name while core was being rewritten around it.
    """
    return _reachable(env.postgres.uri_tracing)


def use_reachable_core_uri() -> Optional[str]:
    """Point the shared `env` at the resolved URI so engines built later use it."""
    resolved = resolve_core_uri()
    if resolved is not None:
        env.postgres.uri_core = resolved
    return resolved


def use_reachable_tracing_uri() -> Optional[str]:
    """The same, for the tracing database. Engines built later read the rewritten value."""
    resolved = resolve_tracing_uri()
    if resolved is not None:
        env.postgres.uri_tracing = resolved
    return resolved


def api_under_test() -> Tuple[str, str]:
    """The API these cases are about, and the key that lets the suite write through it.

    The deployment under test is named by its API, not by a database address: the database
    address is the value that goes stale. Absence is a failure for the same reason the
    absence of a database is one — a suite that cannot say which deployment it is testing
    has nothing to report.
    """
    api_url = (os.getenv("AGENTA_API_URL") or "").strip().rstrip("/")
    auth_key = (os.getenv("AGENTA_AUTH_KEY") or "").strip()
    if not api_url or not auth_key:
        raise AssertionError(
            "The integration layer cannot tell which deployment it is testing. "
            "AGENTA_API_URL names the API whose database these cases must run against, and "
            "AGENTA_AUTH_KEY lets the suite write one row through it to prove the database "
            f"is that API's (read {api_url or 'no API URL'} and "
            f"{'a key' if auth_key else 'no key'}). Both are in the stack's env file; "
            "`load-env <env-file>` exports them."
        )
    return api_url, auth_key


@lru_cache(maxsize=1)
def deployment_marker() -> Tuple[str, UUID]:
    """A row the API under test has just written into its own database, and that API's address.

    One ephemeral account per session, created through the sanctioned admin endpoint, the
    same way every other layer mints accounts. What makes it a marker is that no other
    deployment on the box can have it: the identifier is minted by the API under test, in
    the database the API under test uses.
    """
    api_url, auth_key = api_under_test()
    email = f"integration-identity-{uuid4().hex[:12]}@test.agenta.ai"

    try:
        response = httpx.post(
            f"{api_url}{_ACCOUNTS_PATH}",
            headers={"Authorization": f"Access {auth_key}"},
            json={
                "accounts": {
                    "user": {
                        "user": {"email": email},
                        "options": {"create_api_keys": False, "seed_defaults": False},
                    }
                }
            },
            timeout=_ACCOUNTS_TIMEOUT,
        )
    except httpx.HTTPError as failure:
        raise AssertionError(
            f"The integration layer could not reach the API under test at {api_url} to "
            f"identify its database ({failure.__class__.__name__}). AGENTA_API_URL has to "
            "name an API this host can reach."
        ) from None

    if response.status_code != 200:
        raise AssertionError(
            f"The API under test at {api_url} refused to mint the account that identifies "
            f"its database: {response.status_code}. AGENTA_AUTH_KEY has to be the key that "
            "deployment accepts."
        )

    accounts = response.json().get("accounts") or {}
    account = next(iter(accounts.values()), {})
    identifier = (account.get("user") or {}).get("id")
    if not identifier:
        raise AssertionError(
            f"The API under test at {api_url} answered the account endpoint without a user "
            "id, so there is no row to identify its database by."
        )

    return api_url, UUID(str(identifier))


async def _carries_user(dsn: str, identifier: UUID) -> bool:
    import asyncpg

    connection = await asyncio.wait_for(asyncpg.connect(dsn), timeout=_CONNECT_TIMEOUT)
    try:
        found = await connection.fetchval(
            "SELECT 1 FROM users WHERE id = $1", identifier
        )
    finally:
        await connection.close()
    return found is not None


@lru_cache(maxsize=1)
def confirm_deployment_under_test(uri: str) -> None:
    """Refuse an address that answers but belongs to somebody else.

    Reachability was already proven when this runs, so the failure here is not "no server".
    It is a server whose database does not carry the row the API under test just wrote,
    which on this box means another stack's database with the same name, reached through a
    port that moved. The cases downstream seed projects, so the refusal has to come before
    them and has to name both sides: the API that was asked, and the address that answered.
    """
    api_url, identifier = deployment_marker()

    detail = ""
    try:
        present = _blocking(lambda: _carries_user(_dsn(uri), identifier))
    except Exception as failure:
        # Any failure to read the marker leaves the owner unproven, which is the same
        # answer as a missing row. A database with no `users` table arrives here.
        present = False
        detail = f" Reading it back failed: {failure.__class__.__name__}."

    if present:
        return

    port = published_port()
    raise AssertionError(
        "The integration layer reached a Postgres that is not the deployment under test. "
        f"The API at {api_url} wrote user {identifier} into its own database, and "
        f"{_redacted(uri)} does not have that row, so it serves another deployment.{detail} "
        "Seeding would write this release's cases into somebody else's database. "
        f"POSTGRES_PORT was read as {port if port is not None else 'nowhere'}: point it at "
        "the stack under test, or point AGENTA_API_URL at the deployment this database "
        "belongs to."
    )


def require_core_uri() -> str:
    """The resolved URI of the deployment under test, or a failure that says what to do.

    The integration layer exists to run against a deployment's database. A layer that skips
    when it cannot find one reports a green run in which almost nothing executed: against the
    stack this was written for, 93 of 101 cases skipped and the process exited 0 (D97). A
    release gate reading the exit code, or the last line, is then told the suite passed.

    So the absence of a database is a failure here, and so is the presence of the wrong one
    (D128). Both sentences name the variables that fix them rather than the fact that
    something went wrong.
    """
    resolved = use_reachable_core_uri()
    if resolved is None:
        configured = env.postgres.uri_core
        port = published_port()
        raise AssertionError(
            "The integration layer could not reach this deployment's Postgres. It tried "
            f"{_redacted(configured)} and {_redacted(_on_loopback(configured))}. "
            "Point it at the stack under test: POSTGRES_URI_CORE for the database, or "
            "POSTGRES_PORT for the host port compose published "
            f"(read {'as ' + str(port) if port is not None else 'nowhere'}). "
            "Both are in the stack's env file; `load-env <env-file>` exports them."
        )

    confirm_deployment_under_test(resolved)
    return resolved


def _redacted(uri: str) -> str:
    """The address without the credentials, for a message that goes into a test log."""
    parsed = urlparse(uri)
    host = parsed.netloc.rsplit("@", 1)[-1]
    return urlunparse(parsed._replace(netloc=host))
