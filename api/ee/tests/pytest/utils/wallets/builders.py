"""Test builders for the Wave 1 wallet stream contracts.

Each builder returns a fully-populated default instance; pass keyword overrides to change
one field at a time, following the style of `oss/tests/pytest/utils/accounts.py`.
"""

from datetime import datetime, timezone
from uuid import UUID, uuid4

from ee.src.core.wallets.contracts import (
    DebitCommandV1,
    DebitKind,
    GatewayKind,
    MeasurementCommandV1,
    MeasurementComponentV1,
)
from ee.src.core.wallets.types import (
    CreditCandidateDTO,
    WalletBalanceDTO,
    WalletCreditDTO,
)

DEFAULT_CREATED_AT = datetime(2026, 8, 13, 16, 13, 4, tzinfo=timezone.utc)
DEFAULT_START_TIME = datetime(2026, 8, 13, 16, 12, 57, tzinfo=timezone.utc)
DEFAULT_END_TIME = datetime(2026, 8, 13, 16, 13, 4, tzinfo=timezone.utc)


def build_llm_component(**overrides) -> MeasurementComponentV1:
    defaults = dict(key="input_tokens", value=1200, cost_musd=240)
    defaults.update(overrides)
    return MeasurementComponentV1(**defaults)


def build_mcp_component(**overrides) -> MeasurementComponentV1:
    defaults = dict(key="request_count", value=1, cost_musd=None)
    defaults.update(overrides)
    return MeasurementComponentV1(**defaults)


def build_sbx_component(**overrides) -> MeasurementComponentV1:
    defaults = dict(key="vcpu_core_time_msec", value=4500, cost_musd=90)
    defaults.update(overrides)
    return MeasurementComponentV1(**defaults)


def build_measurement_command(**overrides) -> MeasurementCommandV1:
    defaults = dict(
        version=1,
        measurement_id=f"msr_{uuid4().hex}",
        organization_id=UUID("00000000-0000-0000-0000-00000000007a"),
        project_id=UUID("00000000-0000-0000-0000-0000000005c0"),
        user_id=UUID("00000000-0000-0000-0000-0000000004d0"),
        agent_id=UUID("00000000-0000-0000-0000-0000000006e0"),
        gateway_kind=GatewayKind.LLM,
        request_id=f"req_{uuid4().hex}",
        resource_key="llm:google:gemini-2.5-flash",
        resource_locator={
            "provider": "google",
            "model": "gemini-2.5-flash",
            "endpoint_id": "end_2f",
        },
        endpoint_id="end_2f",
        endpoint_kind="managed",
        start_time=DEFAULT_START_TIME,
        end_time=DEFAULT_END_TIME,
        components=[build_llm_component()],
        references={"workflow": {"id": "wf_01"}},
        created_at=DEFAULT_CREATED_AT,
    )
    defaults.update(overrides)
    return MeasurementCommandV1(**defaults)


def build_debit_command(**overrides) -> DebitCommandV1:
    defaults = dict(
        version=1,
        idempotency_key=f"gw_{uuid4().hex}",
        organization_id=UUID("00000000-0000-0000-0000-00000000007a"),
        debit_kind=DebitKind.GATEWAY_USAGE,
        amount_musd=1020,
        pricing_version="wallet-v1-fake-llm-1",
        resource_key="llm:google:gemini-2.5-flash",
        resource_locator={
            "provider": "google",
            "model": "gemini-2.5-flash",
            "endpoint_id": "end_2f",
        },
        created_at=DEFAULT_CREATED_AT,
    )
    defaults.update(overrides)
    return DebitCommandV1(**defaults)


DEFAULT_ORGANIZATION_ID = UUID("00000000-0000-0000-0000-00000000007a")


def build_credit_candidate(**overrides) -> CreditCandidateDTO:
    defaults = dict(
        wallet_credit_id=uuid4(),
        credit_kind="plan_allowance",
        priority=10,
        end_time=None,
        balance_musd=500_000,
    )
    defaults.update(overrides)
    return CreditCandidateDTO(**defaults)


def build_wallet_credit_dto(**overrides) -> WalletCreditDTO:
    defaults = dict(
        id=uuid4(),
        organization_id=DEFAULT_ORGANIZATION_ID,
        credit_kind="plan_allowance",
        amount_musd=500_000,
        priority=10,
        start_time=DEFAULT_START_TIME,
        end_time=None,
        data={},
        created_at=DEFAULT_CREATED_AT,
    )
    defaults.update(overrides)
    return WalletCreditDTO(**defaults)


def build_general_wallet_balance(**overrides) -> WalletBalanceDTO:
    defaults = dict(
        id=uuid4(),
        organization_id=DEFAULT_ORGANIZATION_ID,
        wallet_credit_id=None,
        balance_musd=480_000,
        floor_musd=0,
        created_at=DEFAULT_CREATED_AT,
    )
    defaults.update(overrides)
    return WalletBalanceDTO(**defaults)


def build_credit_wallet_balance(**overrides) -> WalletBalanceDTO:
    defaults = dict(
        id=uuid4(),
        organization_id=DEFAULT_ORGANIZATION_ID,
        wallet_credit_id=uuid4(),
        balance_musd=315_000,
        floor_musd=None,
        created_at=DEFAULT_CREATED_AT,
    )
    defaults.update(overrides)
    return WalletBalanceDTO(**defaults)
