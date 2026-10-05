"""Managed tool actions through the whole wallet chain, on real Postgres and Redis.

A `tools/call` enters the real MCP gateway relay on `builtin/managed`, runs through the real
executor and the two mock providers (REST in process, MCP in process), is admitted by the
real `WalletsService` against the action's worst-case price, published by the real Redis
publisher, persisted and priced by `MeasurementWorker`, and settled by `DebitWorker`. Only the
permission check and the audit publisher are stubbed (the relay's test policy).
"""

import asyncio
import json
from uuid import uuid4

import pytest
from alembic import command
from redis.asyncio import Redis
from sqlalchemy import update

import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.mcps.dtos import MCPCallContext
from oss.src.core.gateways.mcps.providers.managed.adapter import ManagedMCPAdapter
from oss.src.core.managed_tools.mock.actions import MOCK_ACTIONS
from oss.src.core.managed_tools.mock.providers import build_mock_providers
from oss.src.core.managed_tools.registry import ManagedActionRegistry
from oss.src.core.managed_tools.service import ManagedToolsService
from oss.src.dbs.postgres.shared.engine import AnalyticsEngine, get_transactions_engine
from oss.src.utils.context import AuthScope
from oss.src.utils.env import env
from starlette.requests import Request

from ee.databases.postgres.migrations.core_ee.utils import alembic_cfg
from ee.src.core.measurements.tools import WalletManagedActionBilling
from ee.src.core.wallets.contracts import STREAM_MEASUREMENTS
from ee.src.core.wallets.streaming import serialize_measurement_command
from ee.src.core.wallets.usage.service import WalletUsageService
from ee.src.dbs.postgres.measurements.usage import MeasurementUsageDAO
from ee.src.dbs.postgres.wallets.dao import WalletsDAO
from ee.src.dbs.postgres.wallets.dbes import WalletBalanceDBE
from ee.src.dbs.postgres.wallets.usage import WalletUsageDAO
from ee.src.dbs.redis.wallets.streams import RedisMeasurementPublisher
from ee.tests.pytest.integration.wallets.test_wallets_gateway_chain_postgres import (
    DOWN_REVISION,
    SCHEMA_REVISION,
    _Chain,
    _cleanup,
    _debits,
    _fund,
    _general_balance,
    _measurement_values,
)
from oss.tests.pytest.unit.gateways.test_gateways_mcp_service import _relay_service

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.integration,
    pytest.mark.xdist_group(name="wallets-integration"),
]


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def wallet_schema():
    await asyncio.to_thread(command.upgrade, alembic_cfg, SCHEMA_REVISION)
    try:
        yield
    finally:
        await asyncio.to_thread(command.downgrade, alembic_cfg, DOWN_REVISION)


@pytest.fixture
async def redis_client():
    client = Redis.from_url(env.redis.uri_durable, decode_responses=False)
    yield client
    await client.aclose()


@pytest.fixture
async def analytics_engine():
    engine = AnalyticsEngine()
    yield engine
    await engine.close()


class _Counting:
    """Counts what reaches each upstream: a refused call must reach none."""

    def __init__(self, provider):
        self.provider = provider
        self.name = provider.name
        self.rate_limit = None
        self.calls = 0

    async def invoke(self, **kwargs):
        self.calls += 1
        return await self.provider.invoke(**kwargs)


def _gateway(chain, redis_client):
    providers = [_Counting(provider) for provider in build_mock_providers()]
    service = _relay_service(adapters={})
    service.managed_tools = ManagedMCPAdapter(
        managed_tools=ManagedToolsService(
            registry=ManagedActionRegistry(actions=MOCK_ACTIONS, providers=providers),
            billing=WalletManagedActionBilling(
                wallet=chain.wallets,
                publisher=RedisMeasurementPublisher(redis_client=redis_client),
            ),
        )
    )
    return service, {p.name: p for p in providers}


async def _call(service, scope, tool, arguments, session="session-tools"):
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "headers": [],
            "state": {
                "gateway_run_id": "run-tools",
                "gateway_run_labels": {"session_id": session},
            },
        }
    )
    result = await service.relay(
        scope=scope,
        namespace=GatewayEndpointNamespace.BUILTIN,
        provider="managed",
        name="managed",
        context=MCPCallContext(method="tools/call", target=tool),
        body=json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": tool, "arguments": arguments},
            }
        ).encode(),
        headers={},
        request=request,
    )
    return json.loads(result.body)["result"]


def _scope(organization_id) -> AuthScope:
    return AuthScope(
        organization_id=organization_id,
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )


async def _set_balance(organization_id, balance_musd):
    async with get_transactions_engine().session() as session:
        await session.execute(
            update(WalletBalanceDBE)
            .where(WalletBalanceDBE.organization_id == organization_id)
            .values(balance_musd=balance_musd)
        )
        await session.commit()


async def test_each_execution_is_charged_once_at_its_price_shape(
    wallet_schema, redis_client, analytics_engine
):
    organization_id = uuid4()
    await _fund(organization_id)
    chain = _Chain(redis_client=redis_client, analytics_engine=analytics_engine)
    await chain.start_workers()
    service, providers = _gateway(chain, redis_client)
    scope = _scope(organization_id)
    before = await _general_balance(organization_id)

    enriched = await _call(
        service, scope, "mock_enrich_person", {"email": "jane.doe@acme.com"}
    )
    searched = await _call(
        service, scope, "mock_search_companies", {"query": "robots", "limit": 25}
    )
    missed = await _call(
        service, scope, "mock_enrich_person", {"email": "nobody@acme.com"}
    )
    commands = await chain.run_workers()

    assert enriched["isError"] is False and searched["isError"] is False
    assert len(searched["structuredContent"]["companies"]) == 25
    assert missed["isError"] is True
    assert providers["mock_rest"].calls == 2 and providers["mock_mcp"].calls == 1
    assert len(commands) == 3

    by_action = {
        c.resource_locator["action"]: c for c in commands if c.components[0].value
    }
    search = by_action["mock.search_companies"]
    row, values = await _measurement_values(analytics_engine, search.measurement_id)
    assert row.resource_key == "tool:mock.search_companies"
    assert row.endpoint_kind == "builtin" and row.gateway_kind == "tool"
    assert values == {"action_results": 25}

    # 1 call x 20_000, and 25 results capped at 10 x 2_000. The miss is not charged.
    debits = await _debits(organization_id)
    assert sorted(d.amount_musd for d in debits) == [20_000, 20_000]
    assert await _general_balance(organization_id) == before - 40_000

    # A redelivered measurement is stored and settled once.
    await redis_client.xadd(
        STREAM_MEASUREMENTS, {"data": serialize_measurement_command(search)}
    )
    await chain.run_workers()
    assert len(await _debits(organization_id)) == 2
    assert await _general_balance(organization_id) == before - 40_000

    usage = await WalletUsageService(
        wallets_dao=WalletsDAO(engine=get_transactions_engine()),
        usage_dao=WalletUsageDAO(engine=get_transactions_engine()),
        measurements_dao=MeasurementUsageDAO(engine=analytics_engine),
    ).usage(organization_id=organization_id)
    [session] = usage.sessions
    assert session.session_id == "session-tools"
    assert sorted(
        (c.category, c.action, c.unit, c.quantity, c.amount_musd)
        for c in session.charges
    ) == [
        ("Tools", "mock.enrich_person", "calls", 1, 20_000),
        ("Tools", "mock.search_companies", "results", 25, 20_000),
    ]

    await _cleanup(organization_id)


async def test_an_organization_that_cannot_pay_the_worst_case_is_never_dispatched(
    wallet_schema, redis_client, analytics_engine
):
    organization_id = uuid4()
    await _fund(organization_id)
    chain = _Chain(redis_client=redis_client, analytics_engine=analytics_engine)
    await chain.start_workers()
    service, providers = _gateway(chain, redis_client)
    scope = _scope(organization_id)

    # Above the floor, but below the 20_000 musd a search can cost at worst.
    await _set_balance(organization_id, 19_999)
    above_floor = await _call(
        service, scope, "mock_search_companies", {"query": "x", "limit": 1}
    )
    await _set_balance(organization_id, 0)
    at_floor = await _call(service, scope, "mock_enrich_person", {"email": "a@b.co"})
    commands = await chain.run_workers()

    for result in (above_floor, at_floor):
        assert result["isError"] is True
        assert (
            result["structuredContent"]["error"]["code"] == "wallet_balance_exhausted"
        )
    assert providers["mock_rest"].calls == 0 and providers["mock_mcp"].calls == 0
    assert commands == []
    assert await _debits(organization_id) == []

    await _cleanup(organization_id)
