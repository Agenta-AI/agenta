"""The credit-farming fraud check at its two check points.

Both check points fail open: a vendor timeout, a vendor error, a missing key or any
bug here logs and allows. A real user is never blocked because the vendor is down.
"""

import asyncio
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from oss.src.utils.logging import get_module_logger

from ee.src.core.fraud.config import read_fraud_check_config
from ee.src.core.subscriptions.settings import get_free_plan
from ee.src.core.fraud.jev import ask_noul
from ee.src.core.fraud.types import (
    ACTION_TIMEOUT_SECONDS,
    API_KEY_QUESTION,
    DECISION_TIMEOUT_SECONDS,
    PAID_CREDIT_KINDS,
    SIGNUP_QUESTION,
    ApiKeySignals,
    FraudCheckMode,
    FraudCheckpoint,
    FraudDAOInterface,
    FraudVerdict,
)
from ee.src.core.wallets.service import WalletsService

log = get_module_logger(__name__)


def _domain(email: str) -> Optional[str]:
    normalized = email.strip().lower()
    return normalized.split("@", 1)[1] if normalized.count("@") == 1 else None


class FraudService:
    def __init__(
        self,
        *,
        fraud_dao: FraudDAOInterface,
        wallets_service: WalletsService,
    ):
        self.fraud_dao = fraud_dao
        self.wallets_service = wallets_service

    def _decide(
        self,
        *,
        checkpoint: FraudCheckpoint,
        email: str,
        score: Optional[float],
        threshold: float,
        flagged_action: str,
    ) -> FraudVerdict:
        """One structured log line per decision: domain (never the full email), score,
        threshold and action."""
        if score is None:
            flagged, action = False, "allow"
        elif score >= threshold:
            flagged, action = True, flagged_action
        else:
            flagged, action = False, "allow"

        verdict = FraudVerdict(
            checkpoint=checkpoint,
            domain=_domain(email),
            score=score,
            threshold=threshold,
            flagged=flagged,
            action=action,
        )
        log.info(
            "[fraud] decision",
            checkpoint=checkpoint.value,
            domain=verdict.domain,
            score=score,
            threshold=threshold,
            action=action,
            reason="unscored" if score is None else "scored",
        )
        return verdict

    def _skip(self, *, email: str, threshold: float, reason: str) -> None:
        log.info(
            "[fraud] decision",
            checkpoint=FraudCheckpoint.API_KEY.value,
            domain=_domain(email),
            score=None,
            threshold=threshold,
            action="skip",
            reason=reason,
        )

    async def is_free_and_unpaid(self, *, organization_id: UUID) -> bool:
        """True only for an organization on the free plan that has never paid: no Stripe
        customer or subscription and no purchased or paid-plan credit. Only such an organization can
        be held or lose its grants. Anything unknown counts as paid."""
        facts = await self.fraud_dao.read_billing_facts(organization_id=organization_id)
        return (
            facts.plan is not None
            and facts.plan == get_free_plan()
            and not facts.has_stripe_ids
            and not facts.has_paid_credit
        )

    async def grants_blocked(self, *, organization_id: UUID) -> bool:
        """The daily grant's reader. The marker blocks grants only while the
        organization is free and unpaid: after a payment or an upgrade it has no effect."""
        if not await self.fraud_dao.grants_blocked(organization_id=organization_id):
            return False
        return await self.is_free_and_unpaid(organization_id=organization_id)

    async def inherit_no_grants(self, *, organization_id: UUID, owner_id: UUID) -> bool:
        """A new organization of an owner whose other organization carries the marker
        gets the marker too. Returns whether it did."""
        if not await self.fraud_dao.owner_grants_blocked(owner_id=owner_id):
            return False
        log.info(
            "[fraud] decision",
            checkpoint=FraudCheckpoint.OWNER_ORGANIZATION.value,
            score=None,
            action="skip_grants",
            reason="owner_marked",
            organization_id=str(organization_id),
        )
        # The raised floor is the real guard, so a failed marker write still returns
        # True, the same rule as for a returning account.
        try:
            async with asyncio.timeout(ACTION_TIMEOUT_SECONDS):
                await self.fraud_dao.mark_no_grants(
                    organization_id=organization_id,
                    checkpoint=FraudCheckpoint.OWNER_ORGANIZATION,
                    score=None,
                    now=datetime.now(timezone.utc),
                )
        except Exception as exc:
            log.error(
                "[fraud] no-grant marker write failed for owner organization",
                reason=type(exc).__name__,
                organization_id=str(organization_id),
            )
        return True

    async def check_signup(
        self,
        *,
        organization_id: UUID,
        email: str,
    ) -> FraudVerdict:
        """Judge a new account from its email alone. When flagged, mark the organization
        so that neither the signup grant nor the daily free grants are awarded."""
        checkpoint = FraudCheckpoint.SIGNUP
        async with asyncio.timeout(DECISION_TIMEOUT_SECONDS):
            config = await read_fraud_check_config()
            if config.mode == FraudCheckMode.OFF:
                return FraudVerdict(
                    checkpoint=checkpoint,
                    domain=_domain(email),
                    threshold=config.signup_threshold,
                    flagged=False,
                    action="off",
                )

            score = await ask_noul(
                state={"policy": config.policy, "signup": {"email": email}},
                question=SIGNUP_QUESTION,
            )
        verdict = self._decide(
            checkpoint=checkpoint,
            email=email,
            score=score,
            threshold=config.signup_threshold,
            flagged_action="skip_grants",
        )
        if verdict.flagged:
            async with asyncio.timeout(ACTION_TIMEOUT_SECONDS):
                await self.fraud_dao.mark_no_grants(
                    organization_id=organization_id,
                    checkpoint=checkpoint,
                    score=score,
                    now=datetime.now(timezone.utc),
                )
        return verdict

    async def check_api_key_creation(
        self,
        *,
        user_id: UUID,
        project_id: UUID,
    ) -> Optional[FraudVerdict]:
        """Judge the account from its email plus behaviour facts. When flagged, hold the
        organization's wallet (expire its live credits) and mark it so no grant is
        awarded. The key is created either way.

        Only the owner of a free organization with no payment history is scored. A
        paying customer, an organization on any other plan, and an invited member are
        never scored, never sent to Jev and never held."""
        now = datetime.now(timezone.utc)
        # Only the reads and the Jev call are bounded. The hold and the marker run after
        # the budget, so a timeout can never cut them apart.
        async with asyncio.timeout(DECISION_TIMEOUT_SECONDS):
            config = await read_fraud_check_config()
            if config.mode == FraudCheckMode.OFF:
                return None

            signals: Optional[
                ApiKeySignals
            ] = await self.fraud_dao.read_api_key_signals(
                user_id=user_id,
                project_id=project_id,
                now=now,
            )
            if signals is None:
                return None

            threshold = config.apikey_threshold
            if not signals.owns_organization:
                self._skip(email=signals.email, threshold=threshold, reason="not_owner")
                return None

            if not await self.is_free_and_unpaid(
                organization_id=signals.organization_id
            ):
                self._skip(email=signals.email, threshold=threshold, reason="paid")
                return None

            marked = await self.fraud_dao.grants_blocked(
                organization_id=signals.organization_id
            )
            score = None
            if not marked:
                score = await ask_noul(
                    state={"policy": config.policy, "signup": signals.to_state()},
                    question=API_KEY_QUESTION,
                )

        if marked:
            # Already marked, at signup or by an earlier key whose hold did not finish.
            # The hold is idempotent, so run it again rather than rescore.
            log.info(
                "[fraud] decision",
                checkpoint=FraudCheckpoint.API_KEY.value,
                domain=_domain(signals.email),
                score=None,
                threshold=threshold,
                action="hold_wallet",
                reason="marked",
            )
            async with asyncio.timeout(ACTION_TIMEOUT_SECONDS):
                await self.wallets_service.hold(
                    organization_id=signals.organization_id,
                    keep_credit_kinds=PAID_CREDIT_KINDS,
                    now=datetime.now(timezone.utc),
                )
            return None
        verdict = self._decide(
            checkpoint=FraudCheckpoint.API_KEY,
            email=signals.email,
            score=score,
            threshold=threshold,
            flagged_action="hold_wallet",
        )
        if not verdict.flagged:
            return verdict

        async with asyncio.timeout(ACTION_TIMEOUT_SECONDS):
            # Read again: a payment or an upgrade can land while Jev answers.
            if not await self.is_free_and_unpaid(
                organization_id=signals.organization_id
            ):
                self._skip(email=signals.email, threshold=threshold, reason="paid")
                return verdict
            # The marker first: an organization marked but not yet held is only
            # refused its grants, which is the milder half.
            await self.fraud_dao.mark_no_grants(
                organization_id=signals.organization_id,
                checkpoint=FraudCheckpoint.API_KEY,
                score=score,
                now=now,
            )
            # Paid credits are never expired, even one bought in the moment since the
            # read above.
            await self.wallets_service.hold(
                organization_id=signals.organization_id,
                keep_credit_kinds=PAID_CREDIT_KINDS,
                now=datetime.now(timezone.utc),
            )
        return verdict


_fraud_service: Optional[FraudService] = None


def register_fraud_service(*, fraud_service: FraudService) -> None:
    """Composition-root hook: the entrypoint wires the fraud service at startup."""
    global _fraud_service
    _fraud_service = fraud_service


def _get_fraud_service() -> FraudService:
    if _fraud_service is None:
        raise RuntimeError(
            "Fraud service not registered. "
            "Call register_fraud_service() from the composition root."
        )
    return _fraud_service


async def signup_is_fraud(*, organization_id: UUID, email: str) -> bool:
    """The signup seam. Never raises: any failure allows the grant."""
    try:
        verdict = await _get_fraud_service().check_signup(
            organization_id=organization_id, email=email
        )
        return verdict.flagged
    except Exception as exc:
        # The type only: an exception message can carry the email or other user data.
        log.warning("[fraud] signup check failed; allowing", reason=type(exc).__name__)
        return False


async def owner_organization_blocks_grants(
    *, organization_id: UUID, owner_id: Optional[UUID]
) -> bool:
    """The second-organization seam. Never raises: any failure allows the grants."""
    if owner_id is None:
        return False
    try:
        return await _get_fraud_service().inherit_no_grants(
            organization_id=organization_id, owner_id=owner_id
        )
    except Exception as exc:
        log.warning(
            "[fraud] owner organization check failed; allowing",
            reason=type(exc).__name__,
        )
        return False


async def check_api_key_creation(*, user_id: str, project_id: str) -> None:
    """The API key seam, called from the OSS router through `is_ee()`. Never raises."""
    try:
        await _get_fraud_service().check_api_key_creation(
            user_id=UUID(str(user_id)),
            project_id=UUID(str(project_id)),
        )
    except Exception as exc:
        log.warning("[fraud] API key check failed; allowing", reason=type(exc).__name__)
