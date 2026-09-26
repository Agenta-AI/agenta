"""Joins the ledger (core DB) to the measurements it was priced from (tracing DB) for the
wallet usage view. Read-only: nothing here writes, and the totals are the debits' own."""

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
from uuid import UUID

from ee.src.core.measurements.components import (
    CACHE_READ_TOKENS,
    CACHE_WRITE_TOKENS,
    INPUT_TOKENS,
    OUTPUT_TOKENS,
    REQUEST_COUNT,
)
from ee.src.core.wallets.types import WalletsDAOInterface
from ee.src.core.wallets.usage.dtos import (
    MeasurementUsage,
    WalletUsage,
    WalletUsageCharge,
    WalletUsageDay,
    WalletUsageDebit,
    WalletUsageSession,
    WalletUsageSummary,
)
from ee.src.core.wallets.usage.interfaces import (
    MeasurementUsageDAOInterface,
    WalletUsageDAOInterface,
)

MEASUREMENT_KEY_PREFIX = "measurement:"
DEFAULT_WINDOW = timedelta(days=30)
MAX_DEBITS = 5000

_CATEGORIES = {"llm": "Model calls", "mcp": "Tools", "sbx": "Sandbox"}


def category_of(resource_key: str) -> str:
    return _CATEGORIES.get(resource_key.split(":", 1)[0], "Other")


def _charge(
    debit: WalletUsageDebit, measurement: Optional[MeasurementUsage]
) -> WalletUsageCharge:
    components = measurement.components if measurement else {}
    return WalletUsageCharge(
        created_at=debit.created_at,
        category=category_of(debit.resource_key),
        resource_key=debit.resource_key,
        model=debit.resource_locator.get("model"),
        provider=debit.resource_locator.get("provider"),
        amount_musd=debit.amount_musd,
        pricing_version=debit.pricing_version,
        measurement_id=measurement.measurement_id if measurement else None,
        project_id=measurement.project_id if measurement else None,
        input_tokens=components.get(INPUT_TOKENS),
        output_tokens=components.get(OUTPUT_TOKENS),
        cache_read_tokens=components.get(CACHE_READ_TOKENS),
        cache_write_tokens=components.get(CACHE_WRITE_TOKENS),
        request_count=components.get(REQUEST_COUNT),
    )


def _session_key(
    debit: WalletUsageDebit, measurement: Optional[MeasurementUsage]
) -> Tuple[Optional[str], Optional[UUID], Optional[str]]:
    """A named session groups on its id alone; unnamed charges group per user and day."""
    session = (measurement.references.get("session") or {}) if measurement else {}
    session_id = session.get("id") if isinstance(session, dict) else None
    if session_id:
        return str(session_id), None, None
    user_id = measurement.user_id if measurement else None
    return None, user_id, debit.created_at.date().isoformat()


def _agent_id(measurement: Optional[MeasurementUsage]) -> Optional[UUID]:
    return measurement.agent_id if measurement else None


class WalletUsageService:
    def __init__(
        self,
        *,
        wallets_dao: WalletsDAOInterface,
        usage_dao: WalletUsageDAOInterface,
        measurements_dao: MeasurementUsageDAOInterface,
    ):
        self.wallets_dao = wallets_dao
        self.usage_dao = usage_dao
        self.measurements_dao = measurements_dao

    async def summary(self, *, organization_id: UUID) -> WalletUsageSummary:
        general = await self.wallets_dao.get_general_balance(
            organization_id=organization_id
        )
        spendable = await self.wallets_dao.get_spendable_balance(
            organization_id=organization_id
        )
        credits = await self.usage_dao.list_credits(organization_id=organization_id)
        now = datetime.now(timezone.utc)
        active = [
            credit
            for credit in credits
            if (credit.start_time is None or credit.start_time <= now)
            and (credit.end_time is None or credit.end_time > now)
        ]
        return WalletUsageSummary(
            spendable_musd=spendable.spendable_musd if spendable else None,
            general_balance_musd=general.balance_musd if general else None,
            floor_musd=general.floor_musd if general else None,
            active_credit_total_musd=sum(credit.amount_musd for credit in active),
            credits=credits,
        )

    async def usage(
        self,
        *,
        organization_id: UUID,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
    ) -> WalletUsage:
        end = end or datetime.now(timezone.utc)
        start = start or end - DEFAULT_WINDOW

        debits = await self.usage_dao.list_usage_debits(
            organization_id=organization_id,
            start=start,
            end=end,
            limit=MAX_DEBITS + 1,
        )
        truncated = len(debits) > MAX_DEBITS
        debits = debits[:MAX_DEBITS]

        measurements = await self.measurements_dao.fetch_measurements(
            measurement_ids=[
                debit.idempotency_key[len(MEASUREMENT_KEY_PREFIX) :]
                for debit in debits
                if debit.idempotency_key.startswith(MEASUREMENT_KEY_PREFIX)
            ]
        )

        days: Dict[Tuple, List[int]] = defaultdict(lambda: [0, 0])
        groups: Dict[Tuple, List[Tuple[WalletUsageDebit, Optional[MeasurementUsage]]]]
        groups = defaultdict(list)
        for debit in debits:
            measurement = measurements.get(
                debit.idempotency_key[len(MEASUREMENT_KEY_PREFIX) :]
            )
            day = days[(debit.created_at.date(), category_of(debit.resource_key))]
            day[0] += debit.amount_musd
            day[1] += 1
            groups[_session_key(debit, measurement)].append((debit, measurement))

        user_ids = {
            m.user_id for pairs in groups.values() for _, m in pairs if m and m.user_id
        }
        # Keyed by project too: the agent id is a label the caller's runtime supplied, so a
        # name is only read from the project the measurement itself belongs to.
        agents = {
            (m.project_id, m.agent_id)
            for pairs in groups.values()
            for _, m in pairs
            if m and m.agent_id
        }
        emails = await self.usage_dao.user_emails(user_ids=user_ids)
        names = await self.usage_dao.agent_names(agents=agents)

        sessions = []
        for (session_id, _, _), pairs in groups.items():
            charges = sorted(
                (_charge(debit, measurement) for debit, measurement in pairs),
                key=lambda charge: charge.created_at,
                reverse=True,
            )
            measured = [m for _, m in pairs if m is not None]
            user_id = next((m.user_id for m in measured if m.user_id), None)
            agent = next(
                ((m.project_id, m.agent_id) for m in measured if m.agent_id), None
            )
            agent_id = agent[1] if agent else None
            sessions.append(
                WalletUsageSession(
                    session_id=session_id,
                    agent_id=agent_id,
                    agent_name=names.get(agent) if agent else None,
                    user_id=user_id,
                    user_email=emails.get(user_id) if user_id else None,
                    started_at=charges[-1].created_at,
                    last_at=charges[0].created_at,
                    amount_musd=sum(charge.amount_musd for charge in charges),
                    charge_count=len(charges),
                    charges=charges,
                )
            )
        sessions.sort(key=lambda session: session.last_at, reverse=True)

        return WalletUsage(
            start=start,
            end=end,
            truncated=truncated,
            days=[
                WalletUsageDay(
                    day=day, category=category, amount_musd=amount, charge_count=count
                )
                for (day, category), (amount, count) in sorted(days.items())
            ],
            sessions=sessions,
        )
