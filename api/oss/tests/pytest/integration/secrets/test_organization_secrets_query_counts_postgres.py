"""Pins the hot-path counts of M5 organization credentials (the latency gate).

Owner rule: zero added Postgres statements and Redis round trips per request on every
existing hot path, in every cache mode. Each row of the plan's latency table runs through
the real services built as `entrypoints/routers.py` builds them (both resolver planes),
on the deployment's Postgres and a real Redis, inside a request context (the M2 request
memo), in five cache modes: warm, cold leader, cold follower, cache disabled and Redis
failing. Every statement and every Redis command is counted, lock and fill included.

`BEFORE` holds the counts of `origin/main` e90fcbed85 measured with the same harness
(private evidence `~/agenta-m5-qa/before/query-counts.json`, OSS and EE equal). Every
existing row must stay at or below it. A failing count is a latency blocker: fix the
path, never loosen the test.

Needs a reachable Redis (`REDIS_URI_VOLATILE`); the stack's Redis is not published, so run
with a throwaway one (see `api/AGENTS.md`).
"""

from contextlib import asynccontextmanager, contextmanager
from typing import Dict, List
from uuid import uuid4

import pytest
import redis.asyncio as aioredis

import oss.src.core.secrets.services as services_module
import oss.src.utils.caching as caching
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.registrar import LLMEndpointRegistrar
from oss.src.core.gateways.llms.registry import LLMUpstreamRegistry
from oss.src.core.gateways.llms.service import LLMGatewayService
from oss.src.core.gateways.llms.types import LLMEndpointNotFoundError
from oss.src.core.gateways.policy.dtos import (
    BoundSecretRef,
    GatewayPlane,
    ProviderKeyRef,
    SecretMode,
)
from oss.src.core.gateways.policy.resolution import SecretsResolver
from oss.src.core.gateways.policy.service import GatewayPolicyService
from oss.src.core.secrets.dtos import CreateSecretDTO, UpdateSecretDTO
from oss.src.core.secrets.limits import NoProjectLimits
from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.gateways.llms.dao import LLMEndpointsDAO
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.dbs.redis.shared.engine import get_cache_engine
from oss.src.utils.env import env
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    seed_organization,
)
from oss.tests.pytest.utils.organization_secrets import make_auth_scope
from oss.tests.pytest.utils.principals import bearer_request_access
from oss.tests.pytest.utils.redis_calls import count_redis_calls
from oss.tests.pytest.utils.statements import count_statements


pytestmark = pytest.mark.integration

MODES = ["warm", "cold_leader", "cold_follower", "cache_disabled", "redis_failing"]

# The cost of ONE entry read, per mode: (statements, Redis commands). The same before and
# after M5 (one `get_cache` on one key, filled by one statement).
ENTRY = {
    "warm": (0, 1),  # GET
    "cold_leader": (1, 4),  # GET, SET NX, the fill, SET, DEL
    "cold_follower": (0, 3),  # GET, SET NX refused, GET after the leader filled
    "cache_disabled": (1, 0),
    "redis_failing": (1, 2),  # the failed GET, the fill, the failed SET
}

# (other statements, entry reads) per row after M5. The request memo makes a second read
# of the same project's entry in one request free.
AFTER = {
    "A": (0, 1),  # relay, standard by provider family
    "B": (1, 1),  # relay, standard by a project slug (+ the id read)
    "C": (0, 1),  # relay, standard by an organization slug (the id read uses the memo)
    "D": (2, 0),  # relay, custom project endpoint row (lookup + bound secret)
    "E": (1, 0),  # relay, inherited custom provider (the lookup carries the row)
    "E2": (1, 0),  # relay, unknown custom slug
    "F": (0, 0),  # resolve, provider only
    "G": (1, 0),  # resolve, project custom slug
    "H": (1, 1),  # resolve, project standard slug
    "H2": (1, 0),  # resolve, provider-family slug, project with a key
    "H2_nokey": (1, 0),  # resolve, provider-family slug, project without a key
    "I": (1, 1),  # resolve, organization provider_key slug
    "I2": (1, 0),  # resolve, inherited custom slug
    "I3": (1, 1),  # resolve, unknown slug
    "J": (0, 1),  # GET /secrets/
    "K": (0, 1),  # GET /secrets/?include_inherited=true
    "L": (1, 1),  # GET /gateways/llms/endpoints
    "M1": (0, 1),  # MCP endpoint list (available_provider_keys)
    "M2": (0, 1),  # MCP relay, standard
    "M3": (1, 0),  # MCP relay, bound secret
}

# origin/main e90fcbed85, same harness, OSS == EE.
BEFORE = {
    "A": {
        "cache_disabled": (1, 0),
        "cold_follower": (0, 3),
        "cold_leader": (1, 4),
        "redis_failing": (1, 2),
        "warm": (0, 1),
    },
    "B": {
        "cache_disabled": (2, 0),
        "cold_follower": (1, 3),
        "cold_leader": (2, 4),
        "redis_failing": (2, 2),
        "warm": (1, 1),
    },
    "C": {
        "cache_disabled": (1, 0),
        "cold_follower": (0, 3),
        "cold_leader": (1, 4),
        "redis_failing": (1, 2),
        "warm": (0, 1),
    },
    "D": {
        "cache_disabled": (2, 0),
        "cold_follower": (2, 0),
        "cold_leader": (2, 0),
        "redis_failing": (2, 0),
        "warm": (2, 0),
    },
    "E": {
        "cache_disabled": (1, 0),
        "cold_follower": (1, 0),
        "cold_leader": (1, 0),
        "redis_failing": (1, 0),
        "warm": (1, 0),
    },
    "E2": {
        "cache_disabled": (1, 0),
        "cold_follower": (1, 0),
        "cold_leader": (1, 0),
        "redis_failing": (1, 0),
        "warm": (1, 0),
    },
    "F": {
        "cache_disabled": (0, 0),
        "cold_follower": (0, 0),
        "cold_leader": (0, 0),
        "redis_failing": (0, 0),
        "warm": (0, 0),
    },
    "G": {
        "cache_disabled": (2, 0),
        "cold_follower": (2, 0),
        "cold_leader": (2, 0),
        "redis_failing": (2, 0),
        "warm": (2, 0),
    },
    "H": {
        "cache_disabled": (3, 0),
        "cold_follower": (1, 4),
        "cold_leader": (2, 5),
        "redis_failing": (3, 4),
        "warm": (1, 2),
    },
    "H2": {
        "cache_disabled": (1, 0),
        "cold_follower": (1, 0),
        "cold_leader": (1, 0),
        "redis_failing": (1, 0),
        "warm": (1, 0),
    },
    "H2_nokey": {
        "cache_disabled": (1, 0),
        "cold_follower": (1, 0),
        "cold_leader": (1, 0),
        "redis_failing": (1, 0),
        "warm": (1, 0),
    },
    "I": {
        "cache_disabled": (3, 0),
        "cold_follower": (2, 3),
        "cold_leader": (3, 4),
        "redis_failing": (3, 2),
        "warm": (2, 1),
    },
    "I2": {
        "cache_disabled": (3, 0),
        "cold_follower": (2, 3),
        "cold_leader": (3, 4),
        "redis_failing": (3, 2),
        "warm": (2, 1),
    },
    "I3": {
        "cache_disabled": (3, 0),
        "cold_follower": (2, 3),
        "cold_leader": (3, 4),
        "redis_failing": (3, 2),
        "warm": (2, 1),
    },
    "J": {
        "cache_disabled": (1, 0),
        "cold_follower": (0, 3),
        "cold_leader": (1, 4),
        "redis_failing": (1, 2),
        "warm": (0, 1),
    },
    "K": {
        "cache_disabled": (1, 0),
        "cold_follower": (0, 3),
        "cold_leader": (1, 4),
        "redis_failing": (1, 2),
        "warm": (0, 1),
    },
    "L": {
        "cache_disabled": (2, 0),
        "cold_follower": (1, 3),
        "cold_leader": (2, 4),
        "redis_failing": (2, 2),
        "warm": (1, 1),
    },
    "M1": {
        "cache_disabled": (1, 0),
        "cold_follower": (0, 3),
        "cold_leader": (1, 4),
        "redis_failing": (1, 2),
        "warm": (0, 1),
    },
    "M2": {
        "cache_disabled": (1, 0),
        "cold_follower": (0, 3),
        "cold_leader": (1, 4),
        "redis_failing": (1, 2),
        "warm": (0, 1),
    },
    "M3": {
        "cache_disabled": (1, 0),
        "cold_follower": (1, 0),
        "cold_leader": (1, 0),
        "redis_failing": (1, 0),
        "warm": (1, 0),
    },
    "P1": {
        "cache_disabled": (5, 0),
        "cold_follower": (5, 1),
        "cold_leader": (5, 1),
        "redis_failing": (5, 1),
        "warm": (5, 1),
    },
    "P2": {
        "cache_disabled": (1, 0),
        "cold_follower": (1, 1),
        "cold_leader": (1, 1),
        "redis_failing": (1, 1),
        "warm": (1, 1),
    },
    "P3": {
        "cache_disabled": (3, 0),
        "cold_follower": (3, 1),
        "cold_leader": (3, 1),
        "redis_failing": (3, 1),
        "warm": (3, 1),
    },
}


# Rows that answer "not found" (an unknown slug). Every other row succeeds.
NOT_FOUND = {"E2", "I3"}


def _expected(row: str, mode: str):
    other, reads = AFTER[row]
    statements, redis = ENTRY[mode]
    return other + reads * statements, reads * redis


@pytest.fixture(autouse=True)
async def _fresh_redis_client():
    get_cache_engine()._r = None
    yield
    client = get_cache_engine()._r
    if client is not None:
        await client.aclose()
    get_cache_engine()._r = None


@pytest.fixture(autouse=True)
def _no_events(monkeypatch):
    async def no_publish(**kwargs):
        return None

    monkeypatch.setattr(services_module, "_safe_publish", no_publish)


@pytest.fixture
async def redis_reachable():
    client = aioredis.from_url(env.redis.uri_volatile)
    try:
        await client.ping()
    except Exception:  # noqa: BLE001
        pytest.skip("no reachable Redis for the count tests (REDIS_URI_VOLATILE)")
    finally:
        await client.aclose()


def _build():
    """The services as `entrypoints/routers.py` builds them."""
    engine = get_transactions_engine()
    endpoints_dao = LLMEndpointsDAO(engine=engine)
    vault = VaultService(
        secrets_dao=SecretsDAO(engine=engine),
        llm_endpoint_registrar=LLMEndpointRegistrar(llm_endpoints_dao=endpoints_dao),
        project_limits=NoProjectLimits(),
    )
    llm_resolver = SecretsResolver(vault_service=vault, plane=GatewayPlane.LLM)
    mcp_resolver = SecretsResolver(vault_service=vault, plane=GatewayPlane.MCP)
    llm = LLMGatewayService(
        llm_endpoints_dao=endpoints_dao,
        policy=GatewayPolicyService(resolver=mcp_resolver),
        resolver=llm_resolver,
        upstream_registry=LLMUpstreamRegistry(adapters={}),
    )
    return vault, llm_resolver, mcp_resolver, llm


def _key(kind: str, slug: str, key: str) -> CreateSecretDTO:
    return CreateSecretDTO.model_validate(
        {
            "slug": slug,
            "header": {"name": slug},
            "secret": {
                "kind": "provider_key",
                "data": {"kind": kind, "provider": {"key": key}},
            },
        }
    )


def _custom(name: str, slug=None) -> CreateSecretDTO:
    body = {
        "header": {"name": name},
        "secret": {
            "kind": "custom_provider",
            "data": {
                "kind": "custom",
                "provider": {
                    "url": "https://llm.example.com/v1",
                    "key": "sk-custom-12345678",
                },
                "models": [{"slug": "gpt-4o-mini"}],
            },
        },
    }
    if slug:
        body["slug"] = slug
    return CreateSecretDTO.model_validate(body)


@pytest.fixture
async def world(redis_reachable):
    seeded = await seed_organization(
        members={"owner": "owner"}, projects_per_workspace=2
    )
    vault, llm_resolver, mcp_resolver, llm = _build()
    p1, p2 = seeded.project_ids
    org = seeded.organization_id
    user = seeded.owner_id
    tag = uuid4().hex[:8]
    openai = await vault.create_secret(
        project_id=p1,
        create_secret_dto=_key("openai", f"openai-sales-{tag}", "sk-proj-openai-1234"),
        user_id=user,
    )
    await vault.create_secret(
        project_id=p1,
        create_secret_dto=_key("mock", f"mock-{tag}", "sk-proj-mock-1234"),
        user_id=user,
    )
    custom = await vault.create_secret(
        project_id=p1, create_secret_dto=_custom("Project Azure"), user_id=user
    )
    org_slug = f"openai-company-{tag}"
    inherited_custom = f"azure-company-{tag}"
    await vault.create_organization_secret(
        organization_id=org,
        create_secret_dto=_key("anthropic", org_slug, "sk-org-anthropic-1234"),
        user_id=user,
    )
    await vault.create_organization_secret(
        organization_id=org,
        create_secret_dto=_custom("Company Azure", slug=inherited_custom),
        user_id=user,
    )
    yield dict(
        seeded=seeded,
        vault=vault,
        mcp=mcp_resolver,
        llm=llm,
        p1=p1,
        p2=p2,
        user=user,
        openai=openai,
        custom=custom,
        org_slug=org_slug,
        inherited_custom=inherited_custom,
        s1=make_auth_scope(organization_id=org, project_id=p1, user_id=user),
        s2=make_auth_scope(organization_id=org, project_id=p2, user_id=user),
    )
    await delete_seeded_organization(seeded)


def _rows(w) -> Dict[str, tuple]:
    llm, s1, s2 = w["llm"], w["s1"], w["s2"]
    STD, CUS = GatewayEndpointNamespace.STANDARD, GatewayEndpointNamespace.CUSTOM

    async def relay(scope, namespace, name):
        target = await llm._resolve_target(scope=scope, namespace=namespace, name=name)
        if target.resolved_secret is not None:
            return
        ref = target.secret_ref()
        if ref is not None:
            await llm.resolver.resolve(
                scope=scope, ref=ref, mode=SecretMode.PROJECT_ONLY
            )

    def resolve(scope, **kw):
        return llm.resolve_agent_connection(
            scope=scope,
            model="gpt-4o-mini",
            provider_key=kw.get("provider_key"),
            connection_slug=kw.get("slug"),
        )

    async def include_inherited():
        await w["vault"].list_project_and_inherited_secrets(
            organization_id=s1.organization_id, project_id=w["p1"]
        )

    return {
        "A": (lambda: relay(s1, STD, "openai"), [w["p1"]]),
        "B": (lambda: relay(s1, STD, w["openai"].slug), [w["p1"]]),
        "C": (lambda: relay(s1, STD, w["org_slug"]), [w["p1"]]),
        "D": (lambda: relay(s1, CUS, w["custom"].slug), [w["p1"]]),
        "E": (lambda: relay(s1, CUS, w["inherited_custom"]), [w["p1"]]),
        "E2": (lambda: relay(s2, CUS, "unknown-custom-slug"), [w["p2"]]),
        "F": (lambda: resolve(s1, provider_key="openai"), [w["p1"]]),
        "G": (lambda: resolve(s1, slug=w["custom"].slug), [w["p1"]]),
        "H": (lambda: resolve(s1, slug=w["openai"].slug), [w["p1"]]),
        "H2": (lambda: resolve(s1, slug="openai"), [w["p1"]]),
        "H2_nokey": (lambda: resolve(s2, slug="openai"), [w["p2"]]),
        "I": (lambda: resolve(s1, slug=w["org_slug"]), [w["p1"]]),
        "I2": (lambda: resolve(s1, slug=w["inherited_custom"]), [w["p1"]]),
        "I3": (lambda: resolve(s2, slug="unknown-slug"), [w["p2"]]),
        "J": (lambda: w["vault"].list_secrets(project_id=w["p1"]), [w["p1"]]),
        "K": (include_inherited, [w["p1"]]),
        "L": (lambda: llm.list_endpoints(scope=s1), [w["p1"]]),
        "M1": (lambda: w["mcp"].available_provider_keys(scope=s1), [w["p1"]]),
        "M2": (
            lambda: w["mcp"].resolve(
                scope=s1,
                ref=ProviderKeyRef(provider_key="mock"),
                mode=SecretMode.PROJECT_ONLY,
            ),
            [w["p1"]],
        ),
        "M3": (
            lambda: w["mcp"].resolve(
                scope=s1,
                ref=BoundSecretRef(secret_id=w["openai"].id),
                mode=SecretMode.PROJECT_ONLY,
            ),
            [w["p1"]],
        ),
    }


@contextmanager
def _failing_redis():
    client = get_cache_engine()._client()

    async def _down(*args, **kwargs):
        raise ConnectionError("redis is failing (test)")

    client.execute_command = _down
    try:
        yield
    finally:
        client.__dict__.pop("execute_command", None)


@asynccontextmanager
async def _mode(mode: str, project_ids, monkeypatch):
    side = aioredis.from_url(env.redis.uri_volatile)
    try:
        if mode in ("cold_leader", "cold_follower"):
            stash: Dict[bytes, bytes] = {}
            for project_id in project_ids:
                pattern = caching._pack(project_id=str(project_id), pattern=True)
                async for name in side.scan_iter(match=pattern):
                    stash[name] = await side.get(name)
                    await side.delete(name)
            if mode == "cold_follower":
                for name in stash:
                    await side.set(b"lock::" + name, b"1", px=5000)

                async def _leader_fills(*args, **kwargs):
                    for name, raw in stash.items():
                        if raw is not None:
                            await side.set(name, raw, px=300000)

                monkeypatch.setattr(caching, "_delay", _leader_fills)
        if mode == "cache_disabled":
            monkeypatch.setattr(env.agenta.api.caching, "enabled", False)
        yield
    finally:
        await side.aclose()


async def _measure(call, mode, project_ids, user, monkeypatch):
    monkeypatch.setattr(caching, "random", lambda: 0.99)  # no early leak
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True)
    with bearer_request_access(user):
        try:
            await call()  # warm up
        except Exception:  # noqa: BLE001 - a row may answer "not found"
            pass
    async with _mode(mode, project_ids, monkeypatch):
        if mode == "redis_failing":
            failing = _failing_redis()
            failing.__enter__()
        try:
            with bearer_request_access(user):
                with count_statements(get_transactions_engine()) as statements:
                    with count_redis_calls() as calls:
                        outcome = "ok"
                        try:
                            await call()
                        except LLMEndpointNotFoundError:
                            outcome = "not_found"
        finally:
            if mode == "redis_failing":
                failing.__exit__(None, None, None)
    return len(statements), len(calls), statements, outcome


@pytest.mark.parametrize("mode", MODES)
@pytest.mark.parametrize("row", list(AFTER))
async def test_existing_and_new_paths_cost_no_more_than_before(
    row, mode, world, monkeypatch
):
    call, project_ids = _rows(world)[row]
    statements, redis, _, outcome = await _measure(
        call, mode, project_ids, world["user"], monkeypatch
    )
    # Every row answers as intended; any other error fails the test.
    assert outcome == ("not_found" if row in NOT_FOUND else "ok"), (row, mode)
    assert (statements, redis) == _expected(row, mode), (row, mode)
    before = BEFORE[row][mode]
    assert statements <= before[0] and redis <= before[1], (row, mode, before)


@pytest.mark.parametrize("mode", MODES)
async def test_project_writes_keep_their_statements(mode, world, monkeypatch):
    vault, p2 = world["vault"], world["p2"]
    counter: List[int] = [0]

    async def p1_derived_slug():
        counter[0] += 1
        await vault.create_secret(
            project_id=p2,
            create_secret_dto=_custom(f"Derived {counter[0]} {uuid4().hex[:6]}"),
            user_id=world["user"],
        )

    async def p2_caller_slug():
        await vault.create_secret(
            project_id=p2,
            create_secret_dto=_key(
                "openai", f"explicit-{uuid4().hex[:10]}", "sk-explicit-1234"
            ),
            user_id=world["user"],
        )

    async def p3_user_update():
        await vault.update_secret(
            secret_id=world["openai"].id,
            update_secret_dto=UpdateSecretDTO.model_validate(
                {"header": {"name": f"renamed-{uuid4().hex[:6]}"}}
            ),
            project_id=world["p1"],
            user_id=world["user"],
        )

    for row, call, projects in (
        ("P1", p1_derived_slug, [p2]),
        ("P2", p2_caller_slug, [p2]),
        ("P3", p3_user_update, [world["p1"]]),
    ):
        statements, redis, sql, outcome = await _measure(
            call, mode, projects, world["user"], monkeypatch
        )
        assert outcome == "ok", (row, mode)
        before = BEFORE[row][mode]
        # The same statements and commands as before M5, exactly.
        assert (statements, redis) == before, (row, mode, statements, redis, before)
        if row == "P2":
            # The shadow check is folded into the one insert; SERIALIZABLE rides the BEGIN.
            assert len(sql) == 1 and sql[0].lstrip().upper().startswith(
                "INSERT INTO SECRETS"
            )


async def test_organization_routes_cost_one_decision_and_their_own_statements(
    world, monkeypatch
):
    """Row O (new path): a write adds one statement (the organization's project list)
    and one batched DEL after the commit; a list is one statement."""
    vault = world["vault"]
    org = world["s1"].organization_id
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True)
    with count_statements(get_transactions_engine()) as statements:
        with count_redis_calls() as calls:
            await vault.list_organization_secrets(organization_id=org)
    assert len(statements) == 1 and len(calls) == 0
    with count_statements(get_transactions_engine()) as statements:
        with count_redis_calls() as calls:
            await vault.create_organization_secret(
                organization_id=org,
                create_secret_dto=_key(
                    "openai", f"o-{uuid4().hex[:8]}", "sk-org-openai-12345"
                ),
                user_id=world["user"],
            )
    # conflict check + insert + project list
    assert len(statements) == 3, statements
    assert [c.command for c in calls] == ["DEL"]
