"""The whole gateway -> wallet chain in one process, on real Postgres and Redis.

A request enters the real LLM gateway proxy on the `builtin/mock` endpoint (the mock
provider behind `env.mock_gateways.enabled`), is admitted by the real `WalletsService`,
answered by the in-process mock, measured by the real sink onto `streams:measurements`,
persisted and priced by `MeasurementWorker`, and settled by `DebitWorker` into the wallet
tables. Only the permission check and the audit publisher are stubbed.

This proves the charging path against the mock. It bills nothing real: `builtin` serves
no real provider yet.
"""

import asyncio
import json
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

import pytest
from alembic import command
from redis.asyncio import Redis
from sqlalchemy import select, text
from starlette.requests import Request

import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.apis.fastapi.gateways.llms.proxy import LLMGatewayProxy
from oss.src.core.gateways.llms.providers.mock.adapter import MockLLMAdapter
from oss.src.core.gateways.llms.registry import LLMUpstreamRegistry
from oss.src.core.gateways.llms.service import LLMGatewayService
from oss.src.core.gateways.policy import service as policy_service_module
from oss.src.core.gateways.policy.service import GatewayPolicyService
from oss.src.dbs.postgres.shared.engine import (
    AnalyticsEngine,
    get_transactions_engine,
)
from oss.src.utils.context import (
    AuthContext,
    AuthScope,
    SecretCredentials,
    reset_auth_context,
    set_auth_context,
)
from oss.src.utils.env import env

from ee.databases.postgres.migrations.core_ee.utils import alembic_cfg
from ee.src.core.measurements.charges import calculate_charge
from ee.src.core.measurements.sink import MeasurementUsageSink
from ee.src.core.wallets.admission import WalletSpendAdmission
from ee.src.core.wallets.contracts import STREAM_DEBITS, STREAM_MEASUREMENTS
from ee.src.core.wallets.service import WalletsService
from ee.src.core.wallets.streaming import deserialize_measurement_command
from ee.src.dbs.postgres.measurements.dao import MeasurementsDAO
from ee.src.dbs.postgres.measurements.dbes import MeasurementDBE, MeasurementValueDBE
from ee.src.dbs.postgres.wallets.dao import WalletsDAO
from ee.src.dbs.postgres.measurements.usage import MeasurementUsageDAO
from ee.src.dbs.postgres.wallets.dbes import WalletBalanceDBE, WalletDebitDBE
from ee.src.dbs.postgres.wallets.usage import WalletUsageDAO
from ee.src.core.wallets.usage.service import WalletUsageService
from ee.src.dbs.redis.wallets.streams import (
    RedisDebitPublisher,
    RedisMeasurementPublisher,
)
from ee.src.tasks.asyncio.measurements.worker import MeasurementWorker
from ee.src.tasks.asyncio.wallets.worker import DebitWorker
from ee.tests.pytest.utils.measurements.fakes import InMemoryOrganizationResolver

from oss.tests.pytest.unit.gateways.test_gateways_llm_service import (
    _MockLlmEndpointsDAO,
    _MockResolver,
    _secret,
)

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.integration,
    pytest.mark.xdist_group(name="wallets-integration"),
]

DOWN_REVISION = "ee0000000003"
SCHEMA_REVISION = "ee0000000004"

TEN_DOLLARS = 10_000_000


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
    await client.close()


@pytest.fixture
async def analytics_engine():
    engine = AnalyticsEngine()
    yield engine
    await engine.close()


@pytest.fixture(autouse=True)
def _gateway_switches(monkeypatch):
    monkeypatch.setattr(env.llm_gateway, "enabled", True)
    monkeypatch.setattr(env.mock_gateways, "enabled", True)

    async def _permitted(**_kwargs):
        return True

    async def _no_audit(**_kwargs):
        return None

    monkeypatch.setattr(policy_service_module, "check_action_access", _permitted)
    monkeypatch.setattr(policy_service_module, "publish_gateway_call", _no_audit)


class _CountingMockAdapter(MockLLMAdapter):
    def __init__(self) -> None:
        self.calls = 0

    async def relay_chat_completion(self, **kwargs):
        self.calls += 1
        return await super().relay_chat_completion(**kwargs)


class _Chain:
    """The composition `routers.py` builds with the wallet on, plus the two workers."""

    def __init__(self, *, redis_client, analytics_engine, wallet_on: bool = True):
        self.redis_client = redis_client
        self.wallets = WalletsService(
            wallets_dao=WalletsDAO(engine=get_transactions_engine())
        )
        self.checks = 0
        self.adapter = _CountingMockAdapter()
        resolver = _MockResolver(secret=_secret())
        policy = (
            GatewayPolicyService(
                resolver=resolver,
                spend_admission=WalletSpendAdmission(wallet=self._counting_wallet()),
                usage_sink=MeasurementUsageSink(
                    publisher=RedisMeasurementPublisher(redis_client=redis_client)
                ),
            )
            if wallet_on
            else GatewayPolicyService(resolver=resolver)
        )
        self.proxy = LLMGatewayProxy(
            llm_gateway_service=LLMGatewayService(
                llm_endpoints_dao=_MockLlmEndpointsDAO(),
                policy=policy,
                resolver=resolver,
                upstream_registry=LLMUpstreamRegistry(adapters={"mock": self.adapter}),
            )
        )
        self.analytics_engine = analytics_engine

    def _counting_wallet(self):
        chain = self

        class _Counting:
            async def check(self, *, organization_id):
                chain.checks += 1
                return await chain.wallets.check(organization_id=organization_id)

        return _Counting()

    async def start_workers(self):
        suffix = uuid4().hex
        for stream in (STREAM_MEASUREMENTS, STREAM_DEBITS):
            await self.redis_client.xgroup_create(
                name=stream, groupname=f"chain-{suffix}", id="$", mkstream=True
            )
        self.measurement_worker = MeasurementWorker(
            measurements_dao=MeasurementsDAO(engine=self.analytics_engine),
            organization_resolver=InMemoryOrganizationResolver(),
            debit_publisher=RedisDebitPublisher(redis_client=self.redis_client),
            redis_client=self.redis_client,
            stream_name=STREAM_MEASUREMENTS,
            consumer_group=f"chain-{suffix}",
            max_block_ms=200,
            max_delay_ms=10,
        )
        self.debit_worker = DebitWorker(
            settlement_port=self.wallets,
            redis_client=self.redis_client,
            stream_name=STREAM_DEBITS,
            consumer_group=f"chain-{suffix}",
            max_block_ms=200,
            max_delay_ms=10,
        )

    async def run_workers(self):
        """One pass of each worker, in order. Returns the measurement commands read."""
        batch = await self.measurement_worker.read_batch()
        _, acked = await self.measurement_worker.process_batch(batch)
        await self.measurement_worker.ack_and_delete(acked)
        debits = await self.debit_worker.read_batch()
        _, acked = await self.debit_worker.process_batch(debits)
        await self.debit_worker.ack_and_delete(acked)
        return [deserialize_measurement_command(data[b"data"]) for _, data in batch]


@contextmanager
def _caller(organization_id):
    scope = AuthScope(
        organization_id=organization_id,
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )
    token = set_auth_context(
        AuthContext(credentials=SecretCredentials(value="test-token"), scope=scope)
    )
    try:
        yield scope
    finally:
        reset_auth_context(token)


def _request(
    *,
    stream: bool = False,
    run_id: Optional[str] = None,
    run_labels: Optional[dict] = None,
) -> Request:
    body = json.dumps(
        {
            "model": "gpt-5.5",
            "messages": [{"role": "user", "content": "count these five words"}],
            "stream": stream,
        }
    ).encode()

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    request = Request(
        {"type": "http", "method": "POST", "path": "/", "headers": []}, receive
    )
    if run_id is not None:
        request.state.gateway_run_id = run_id
    if run_labels is not None:
        request.state.gateway_run_labels = run_labels
    return request


async def _call(chain, organization_id, *, namespace="builtin", **request_kwargs):
    relay = getattr(chain.proxy, f"chat_completions_{namespace}")
    with _caller(organization_id):
        response = await relay(_request(**request_kwargs), "mock")
        if hasattr(response, "body_iterator"):
            body = b"".join([chunk async for chunk in response.body_iterator])
        else:
            body = response.body
    return response, body


async def _fund(organization_id, amount_musd=TEN_DOLLARS):
    await WalletsDAO(engine=get_transactions_engine()).award_credit(
        organization_id=organization_id,
        idempotency_key=f"chain-test:{uuid4().hex}",
        credit_kind="purchase",
        amount_musd=amount_musd,
        priority=10,
        end_time=None,
        now=datetime.now(timezone.utc),
    )


async def _general_balance(organization_id) -> int:
    async with get_transactions_engine().session() as session:
        return (
            await session.execute(
                select(WalletBalanceDBE.balance_musd).where(
                    WalletBalanceDBE.organization_id == organization_id,
                    WalletBalanceDBE.wallet_credit_id.is_(None),
                )
            )
        ).scalar_one()


async def _debits(organization_id):
    async with get_transactions_engine().session() as session:
        return (
            (
                await session.execute(
                    select(WalletDebitDBE).where(
                        WalletDebitDBE.organization_id == organization_id
                    )
                )
            )
            .scalars()
            .all()
        )


async def _measurement_values(analytics_engine, measurement_id):
    async with analytics_engine.session() as session:
        rows = (
            (
                await session.execute(
                    select(MeasurementDBE).where(
                        MeasurementDBE.measurement_id == measurement_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        values = (
            (
                await session.execute(
                    select(MeasurementValueDBE).where(
                        MeasurementValueDBE.measurement_id == rows[0].id
                    )
                )
            )
            .scalars()
            .all()
        )
        return rows[0], {value.key: value.value for value in values}


async def _cleanup(organization_id):
    async with get_transactions_engine().session() as session:
        for table in ("wallet_debits", "wallet_balances", "wallet_credits"):
            await session.execute(
                text(f"DELETE FROM {table} WHERE organization_id = :organization_id"),
                {"organization_id": organization_id},
            )


@pytest.mark.parametrize("stream", [False, True], ids=["non-streaming", "streaming"])
async def test_a_builtin_call_is_measured_priced_and_settled_exactly_once(
    wallet_schema, redis_client, analytics_engine, stream
):
    organization_id = uuid4()
    await _fund(organization_id)
    chain = _Chain(redis_client=redis_client, analytics_engine=analytics_engine)
    await chain.start_workers()
    before = await _general_balance(organization_id)

    response, body = await _call(chain, organization_id, stream=stream, run_id="run-9")
    [measurement] = await chain.run_workers()

    assert response.status_code == 200 and body
    assert chain.checks == 1
    assert chain.adapter.calls == 1
    row, values = await _measurement_values(
        analytics_engine, measurement.measurement_id
    )
    assert row.endpoint_kind == "builtin"
    assert row.resource_key == "llm:mock:gpt-5.5"
    assert row.data["references"] == {"workflow": {"gateway_run_id": "run-9"}}
    assert values["request_count"] == 1
    assert values["input_tokens"] > 0 and values["output_tokens"] > 0
    amount, version = calculate_charge(command=measurement)
    assert row.data["charge"]["amount_musd"] == amount
    [debit] = await _debits(organization_id)
    assert debit.idempotency_key == f"measurement:{measurement.measurement_id}"
    assert debit.amount_musd == amount
    assert debit.pricing_version == version
    assert await _general_balance(organization_id) == before - amount

    await _cleanup(organization_id)


async def test_a_redelivered_measurement_has_no_second_financial_effect(
    wallet_schema, redis_client, analytics_engine
):
    organization_id = uuid4()
    await _fund(organization_id)
    chain = _Chain(redis_client=redis_client, analytics_engine=analytics_engine)
    await chain.start_workers()
    before = await _general_balance(organization_id)

    await _call(chain, organization_id)
    batch = await chain.measurement_worker.read_batch()
    # Processed twice before its ACK, as a crash between the two would redeliver it.
    await chain.measurement_worker.process_batch(batch)
    _, acked = await chain.measurement_worker.process_batch(batch)
    await chain.measurement_worker.ack_and_delete(acked)
    debits = await chain.debit_worker.read_batch()
    _, acked = await chain.debit_worker.process_batch(debits)
    await chain.debit_worker.ack_and_delete(acked)

    assert len(debits) == 2  # the same debit, published twice
    [debit] = await _debits(organization_id)
    assert await _general_balance(organization_id) == before - debit.amount_musd

    await _cleanup(organization_id)


async def test_two_calls_are_two_charges(wallet_schema, redis_client, analytics_engine):
    organization_id = uuid4()
    await _fund(organization_id)
    chain = _Chain(redis_client=redis_client, analytics_engine=analytics_engine)
    await chain.start_workers()
    before = await _general_balance(organization_id)

    await _call(chain, organization_id)
    await _call(chain, organization_id)
    measurements = await chain.run_workers()

    assert len({m.measurement_id for m in measurements}) == 2
    debits = await _debits(organization_id)
    assert len(debits) == 2
    assert await _general_balance(organization_id) == before - sum(
        d.amount_musd for d in debits
    )

    await _cleanup(organization_id)


async def test_an_organization_at_its_floor_is_refused_before_the_provider(
    wallet_schema, redis_client, analytics_engine
):
    organization_id = uuid4()  # never funded: provisioned at its floor by `check`
    chain = _Chain(redis_client=redis_client, analytics_engine=analytics_engine)
    await chain.start_workers()

    response, body = await _call(chain, organization_id)

    assert response.status_code == 403
    assert json.loads(body)["error"]["code"] == "policy_denied"
    assert chain.adapter.calls == 0
    assert await chain.run_workers() == []
    assert await _debits(organization_id) == []

    await _cleanup(organization_id)


async def test_the_same_spent_organization_still_calls_on_its_own_credential(
    wallet_schema, redis_client, analytics_engine
):
    """`standard/mock` spends the customer's credential: never admitted, never charged."""
    organization_id = uuid4()
    chain = _Chain(redis_client=redis_client, analytics_engine=analytics_engine)
    await chain.start_workers()

    response, _ = await _call(chain, organization_id, namespace="standard")

    assert response.status_code == 200
    assert chain.checks == 0
    assert chain.adapter.calls == 1
    assert await chain.run_workers() == []

    await _cleanup(organization_id)


async def test_a_direct_call_carries_no_run_reference(
    wallet_schema, redis_client, analytics_engine
):
    organization_id = uuid4()
    await _fund(organization_id)
    chain = _Chain(redis_client=redis_client, analytics_engine=analytics_engine)
    await chain.start_workers()

    await _call(chain, organization_id)
    [measurement] = await chain.run_workers()

    row, _ = await _measurement_values(analytics_engine, measurement.measurement_id)
    assert row.data["references"] == {}

    await _cleanup(organization_id)


async def test_a_stream_the_client_abandons_is_not_charged(
    wallet_schema, redis_client, analytics_engine
):
    """The accepted Wave 2 loss, recorded: an adapter learns a call's usage when its body
    ends, so a client that disconnects first leaves no usage and the call is free. A real
    `builtin` provider must close this before it launches."""
    organization_id = uuid4()
    await _fund(organization_id)
    chain = _Chain(redis_client=redis_client, analytics_engine=analytics_engine)
    await chain.start_workers()
    before = await _general_balance(organization_id)

    with _caller(organization_id):
        response = await chain.proxy.chat_completions_builtin(
            _request(stream=True), "mock"
        )
        await anext(response.body_iterator)
        await response.body_iterator.aclose()

    assert chain.adapter.calls == 1
    assert await chain.run_workers() == []
    assert await _debits(organization_id) == []
    assert await _general_balance(organization_id) == before

    await _cleanup(organization_id)


async def test_with_the_wallet_off_nothing_is_checked_or_measured(
    wallet_schema, redis_client, analytics_engine
):
    """What `routers.py` builds with `AGENTA_WALLETS_ENABLED` off: the null ports. An
    organization the wallet would refuse is served, and nothing reaches the stream."""
    organization_id = uuid4()
    chain = _Chain(
        redis_client=redis_client, analytics_engine=analytics_engine, wallet_on=False
    )
    await chain.start_workers()

    response, _ = await _call(chain, organization_id)

    assert response.status_code == 200
    assert chain.checks == 0
    assert await chain.run_workers() == []
    assert await _debits(organization_id) == []


async def test_the_usage_view_reads_a_labelled_charge_back_by_session(
    wallet_schema, redis_client, analytics_engine
):
    organization_id = uuid4()
    agent_id = uuid4()
    await _fund(organization_id)
    chain = _Chain(redis_client=redis_client, analytics_engine=analytics_engine)
    await chain.start_workers()
    labels = {"session_id": "session-7", "agent_id": str(agent_id)}

    await _call(chain, organization_id, run_labels=labels)
    await _call(chain, organization_id, run_labels=labels)
    measurements = await chain.run_workers()

    service = WalletUsageService(
        wallets_dao=WalletsDAO(engine=get_transactions_engine()),
        usage_dao=WalletUsageDAO(engine=get_transactions_engine()),
        measurements_dao=MeasurementUsageDAO(engine=analytics_engine),
    )
    usage = await service.usage(organization_id=organization_id)
    summary = await service.summary(organization_id=organization_id)

    debits = await _debits(organization_id)
    spent = sum(debit.amount_musd for debit in debits)
    [session] = usage.sessions
    assert session.session_id == "session-7"
    assert session.agent_id == agent_id
    assert session.charge_count == 2
    assert session.amount_musd == spent
    assert {charge.measurement_id for charge in session.charges} == {
        m.measurement_id for m in measurements
    }
    assert all(
        charge.input_tokens and charge.output_tokens for charge in session.charges
    )
    [day] = usage.days
    assert (day.category, day.amount_musd, day.charge_count) == (
        "Model calls",
        spent,
        2,
    )
    assert summary.spendable_musd == TEN_DOLLARS - spent
    assert summary.active_credit_total_musd == TEN_DOLLARS
    [credit] = summary.credits
    assert credit.remaining_musd == TEN_DOLLARS - spent

    await _cleanup(organization_id)
