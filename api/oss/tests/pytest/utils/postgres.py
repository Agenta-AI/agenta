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
import json
import os
import tempfile
import time
import warnings
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from typing import Awaitable, Callable, Dict, Optional, Tuple, TypeVar
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

# How long a worker waits for whichever worker holds the lock to publish the verdict. Long
# enough for an account round trip on a slow deployment, short enough to say so rather than
# hang a suite behind a worker that died holding it.
_VERDICT_WAIT = 60.0
_VERDICT_POLL = 0.1

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


def mint_deployment_marker(api_url: str, auth_key: str) -> UUID:
    """A row the API under test writes into its own database, and hands back the id of.

    Identity, not reachability: an address that opens a connection proves a server is
    listening, and the database name proves only a licence (D97, D128). Every EE stack on
    this box publishes `agenta_ee_core` on a port of its own, so a stale POSTGRES_PORT
    reaches a real database with the right name and the wrong owner. What no other
    deployment has is a row this API wrote a moment ago.

    One ephemeral account, created through the sanctioned admin endpoint the way every other
    layer mints accounts, and removed again by :func:`remove_deployment_marker` as soon as the
    verdict is in.
    """
    email = f"integration-identity-{uuid4().hex[:12]}@test.agenta.ai"

    try:
        response = httpx.post(
            f"{api_url}{_ACCOUNTS_PATH}",
            headers={"Authorization": f"Access {auth_key}"},
            json={
                "accounts": {
                    "marker": {
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

    return UUID(str(identifier))


def remove_deployment_marker(api_url: str, auth_key: str, identifier: UUID) -> None:
    """Take the marker account back out, through the same API that created it.

    Called whatever the verdict was, including a refusal: the account is in the deployment
    under test either way, and a check that leaves rows behind is a check nobody runs twice.
    A failure to remove it is a warning rather than an error — the suite's answer is already
    decided, and failing a run over its own housekeeping helps nobody.
    """
    try:
        response = httpx.request(
            "DELETE",
            f"{api_url}{_ACCOUNTS_PATH}",
            headers={"Authorization": f"Access {auth_key}"},
            json={"accounts": {"marker": {"user": {"id": str(identifier)}}}},
            timeout=_ACCOUNTS_TIMEOUT,
        )
    except httpx.HTTPError as failure:
        warnings.warn(
            f"The identity marker {identifier} could not be removed from {api_url}: "
            f"{failure.__class__.__name__}. It is an empty ephemeral account.",
            stacklevel=2,
        )
        return

    if response.status_code != 204:
        warnings.warn(
            f"The identity marker {identifier} was not removed from {api_url}: "
            f"{response.status_code}. It is an empty ephemeral account.",
            stacklevel=2,
        )


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


def _run_id() -> str:
    """One name for this pytest run, shared by its workers.

    pytest-xdist puts the run's own id in every worker's environment, which is what makes a
    verdict reached in one worker readable by the other nineteen. A serial run has one
    process and can key on it.
    """
    return os.getenv("PYTEST_XDIST_TESTRUNUID") or f"pid-{os.getpid()}"


def _verdict_path(api_url: str, uri: str) -> Path:
    """Where this run records what it decided about one API and one database address."""
    subject = sha256(f"{api_url}|{uri}".encode()).hexdigest()[:12]
    return Path(tempfile.gettempdir()) / f"agenta-deployment-{_run_id()}-{subject}.json"


def _read_verdict(path: Path) -> Optional[Dict[str, object]]:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def _write_verdict(path: Path, verdict: Dict[str, object]) -> None:
    # Written beside the target and renamed, because a reader polling for the file must never
    # see half of it.
    interim = path.with_suffix(f".{os.getpid()}.partial")
    interim.write_text(json.dumps(verdict))
    interim.replace(path)


def _decide(uri: str, api_url: str, auth_key: str) -> Dict[str, object]:
    """Mint one marker, look for it, take it back out, and say what that proved."""
    identifier = mint_deployment_marker(api_url, auth_key)

    detail = ""
    try:
        try:
            present = _blocking(lambda: _carries_user(_dsn(uri), identifier))
        except Exception as failure:
            # Any failure to read the marker leaves the owner unproven, which is the same
            # answer as a missing row. A database with no `users` table arrives here.
            present = False
            detail = f" Reading it back failed: {failure.__class__.__name__}."
    finally:
        remove_deployment_marker(api_url, auth_key, identifier)

    if present:
        return {"confirmed": True}

    port = published_port()
    return {
        "confirmed": False,
        "message": (
            "The integration layer reached a Postgres that is not the deployment under "
            f"test. The API at {api_url} wrote user {identifier} into its own database, and "
            f"{_redacted(uri)} does not have that row, so it serves another deployment."
            f"{detail} Seeding would write this release's cases into somebody else's "
            "database. POSTGRES_PORT was read as "
            f"{port if port is not None else 'nowhere'}: point it at the stack under test, "
            "or point AGENTA_API_URL at the deployment this database belongs to."
        ),
    }


def _verdict_for(uri: str, api_url: str, auth_key: str) -> Dict[str, object]:
    """This run's verdict, decided once however many workers ask for it.

    The check writes to the deployment, so it is worth exactly one account per run rather
    than one per worker. The first worker to claim the lock decides and publishes; the rest
    read what it published. The lock is an exclusive create, which is atomic on every
    filesystem this runs on, and its name carries the run id so a lock left by a dead run
    never blocks a live one.
    """
    path = _verdict_path(api_url, uri)
    published = _read_verdict(path)
    if published is not None:
        return published

    lock = path.with_suffix(".lock")
    deadline = time.monotonic() + _VERDICT_WAIT
    while True:
        try:
            handle = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            published = _read_verdict(path)
            if published is not None:
                return published
            if time.monotonic() > deadline:
                raise AssertionError(
                    "The integration layer waited for another worker to identify the "
                    f"deployment under test and it never did. Remove {lock} and run again."
                ) from None
            time.sleep(_VERDICT_POLL)
            continue

        try:
            published = _read_verdict(path)
            if published is None:
                published = _decide(uri, api_url, auth_key)
                _write_verdict(path, published)
            return published
        finally:
            os.close(handle)
            lock.unlink(missing_ok=True)


@lru_cache(maxsize=1)
def confirm_deployment_under_test(uri: str) -> None:
    """Refuse an address that answers but belongs to somebody else.

    Reachability was already proven when this runs, so the failure here is not "no server".
    It is a server whose database does not carry the row the API under test just wrote,
    which on this box means another stack's database with the same name, reached through a
    port that moved. The cases downstream seed projects, so the refusal has to come before
    them and has to name both sides: the API that was asked, and the address that answered.

    The API is read from the environment first, so a run that cannot say which deployment it
    is testing ends before anything is written anywhere.
    """
    api_url, auth_key = api_under_test()
    verdict = _verdict_for(uri, api_url, auth_key)
    if verdict.get("confirmed"):
        return

    raise AssertionError(str(verdict.get("message")))


def confirm_the_deployment_names_its_databases() -> None:
    """Refuse a run that is guessing at the deployment's database names.

    The names are composed from the licence: an EE stack's databases are `agenta_ee_*` and
    an OSS stack's are `agenta_oss_*`, and `AGENTA_LICENSE` unset means `oss`, quietly. Run
    against an EE deployment with no licence exported and the suite dials a database that
    does not exist there, finds nothing, and a layer that skips what it cannot reach reports
    18 skipped and exit 0 — a green run of nothing, which is the shape D97 was (D146).

    Unset is always a mistake here, never a plain OSS run: every deployment env file in this
    repository states the licence, so an unset one means no env file was loaded. The other
    two ways of stating the names are honoured, because an operator who set either has said
    which databases they mean.
    """
    for variable in ("AGENTA_LICENSE", "POSTGRES_DB_PREFIX", "POSTGRES_URI_CORE"):
        if (os.getenv(variable) or "").strip():
            return

    raise AssertionError(
        "The integration layer does not know what this deployment calls its databases. "
        "AGENTA_LICENSE picks the prefix, agenta_ee for an EE stack and agenta_oss for an "
        "OSS one, and unset reads as OSS — so against an EE deployment the suite dials a "
        "database that is not there and reports a green run of nothing. Export "
        "AGENTA_LICENSE from the stack's env file; `load-env <env-file>` does it. "
        "POSTGRES_DB_PREFIX or POSTGRES_URI_CORE say it directly and are honoured instead."
    )


def _server_of(uri: str) -> Tuple[str, int]:
    """The host and port an address names, with loopback's two spellings read as one."""
    parsed = urlparse(uri)
    host = (parsed.hostname or "").lower()
    if host == "localhost":
        host = "127.0.0.1"
    return host, parsed.port or _CONTAINER_PORT


def confirm_same_server(identified: str, other: str, *, database: str) -> None:
    """Refuse a second address that is not on the server identity was proven on.

    The marker row the identity check reads is a `users` row, which only the core database
    has, so a second database cannot be identified the same way and there is no endpoint
    that writes a row into the tracing database for the suite to name. What can be settled
    exactly is the server: one Postgres server carries every database a deployment uses, and
    the core address on it has just been proven to be this deployment's. So a second address
    on the same host and published port is on the identified server, and one anywhere else is
    not covered by anything and must not be written to (D141).

    What this does not claim: that the database NAME on that server is the deployment's. That
    comes from the deployment's own configuration, the same value its containers read.
    """
    if _server_of(identified) == _server_of(other):
        return

    host, port = _server_of(other)
    raise AssertionError(
        f"The integration layer's {database} database is not on the server it identified. "
        f"The deployment under test answered on {_redacted(identified)}, and {database} "
        f"resolved to {host}:{port}, which nothing has shown to be this deployment's. "
        f"Unset POSTGRES_URI_{database.upper()} to let it resolve beside the core database, "
        "or point both at the same stack."
    )


def unreachable(database: str = "core") -> AssertionError:
    """The failure for a database this layer cannot reach, naming what to change.

    An integration layer exists to run against a deployment's database. A layer that skips
    when it cannot find one reports a green run in which almost nothing executed: against the
    stack this was written for, 93 of 101 cases skipped and the process exited 0 (D97). A
    release gate reading the exit code, or the last line, is then told the suite passed.

    So this is a failure rather than a skip wherever the layer can say so, and the sentence
    names the variables that fix it rather than the fact that something went wrong.
    """
    configured = getattr(env.postgres, f"uri_{database}")
    port = published_port()
    return AssertionError(
        f"The integration layer could not reach this deployment's {database} database. It "
        f"tried {_redacted(configured)} and {_redacted(_on_loopback(configured))}. "
        f"Point it at the stack under test: POSTGRES_URI_{database.upper()} for the database, "
        "or POSTGRES_PORT for the host port compose published "
        f"(read {'as ' + str(port) if port is not None else 'nowhere'}). "
        "Both are in the stack's env file; `load-env <env-file>` exports them."
    )


def require_core_uri() -> str:
    """The resolved core URI of the deployment under test, or a failure saying what to do.

    The absence of a database is a failure here, and so is the presence of the wrong one
    (D128, D141).
    """
    resolved = use_reachable_core_uri()
    if resolved is None:
        raise unreachable("core")

    confirm_deployment_under_test(resolved)
    return resolved


def _redacted(uri: str) -> str:
    """The address without the credentials, for a message that goes into a test log."""
    parsed = urlparse(uri)
    host = parsed.netloc.rsplit("@", 1)[-1]
    return urlunparse(parsed._replace(netloc=host))
