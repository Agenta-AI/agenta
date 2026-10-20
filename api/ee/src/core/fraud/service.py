"""The credit-farming fraud check at its two check points.

Both check points fail open: a vendor timeout, a vendor error, a missing key or any
bug here logs and allows. A real user is never blocked because the vendor is down.
"""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from oss.src.utils.logging import get_module_logger

from ee.src.core.fraud.config import read_fraud_check_config
from ee.src.core.fraud.jev import ask_noul
from ee.src.core.fraud.types import (
    API_KEY_QUESTION,
    HOLD_FLOOR_MUSD,
    POLICY,
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

    async def check_signup(
        self,
        *,
        organization_id: UUID,
        email: str,
    ) -> FraudVerdict:
        """Judge a new account from its email alone. When flagged, mark the organization
        so that neither the signup grant nor the daily free grants are awarded."""
        config = await read_fraud_check_config()
        checkpoint = FraudCheckpoint.SIGNUP
        if config.mode == FraudCheckMode.OFF:
            return FraudVerdict(
                checkpoint=checkpoint,
                domain=_domain(email),
                threshold=config.signup_threshold,
                flagged=False,
                action="off",
            )

        score = await ask_noul(
            state={"policy": POLICY, "signup": {"email": email}},
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
        organization's wallet (expire live credits, raise the floor) and mark it so no
        grant is awarded. The key is created either way."""
        config = await read_fraud_check_config()
        if config.mode == FraudCheckMode.OFF:
            return None

        now = datetime.now(timezone.utc)
        signals: Optional[ApiKeySignals] = await self.fraud_dao.read_api_key_signals(
            user_id=user_id,
            project_id=project_id,
            now=now,
        )
        if signals is None:
            return None

        if await self.fraud_dao.grants_blocked(organization_id=signals.organization_id):
            log.info(
                "[fraud] decision",
                checkpoint=FraudCheckpoint.API_KEY.value,
                domain=_domain(signals.email),
                score=None,
                threshold=config.apikey_threshold,
                action="already_held",
                reason="marked",
            )
            return None

        score = await ask_noul(
            state={"policy": POLICY, "signup": signals.to_state()},
            question=API_KEY_QUESTION,
        )
        verdict = self._decide(
            checkpoint=FraudCheckpoint.API_KEY,
            email=signals.email,
            score=score,
            threshold=config.apikey_threshold,
            flagged_action="hold_wallet",
        )
        if verdict.flagged:
            await self.wallets_service.hold(
                organization_id=signals.organization_id,
                floor_musd=HOLD_FLOOR_MUSD,
                now=now,
            )
            await self.fraud_dao.mark_no_grants(
                organization_id=signals.organization_id,
                checkpoint=FraudCheckpoint.API_KEY,
                score=score,
                now=now,
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
    except Exception:
        log.warning("[fraud] signup check failed; allowing", exc_info=True)
        return False


async def check_api_key_creation(*, user_id: str, project_id: str) -> None:
    """The API key seam, called from the OSS router through `is_ee()`. Never raises."""
    try:
        await _get_fraud_service().check_api_key_creation(
            user_id=UUID(str(user_id)),
            project_id=UUID(str(project_id)),
        )
    except Exception:
        log.warning("[fraud] API key check failed; allowing", exc_info=True)
