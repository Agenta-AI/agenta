"""The managed action executor: look up, validate, rate limit, admit, invoke once, count,
and hand one measurement to billing. It knows no transport and no price."""

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import uuid_utils.compat as uuid
from pydantic import BaseModel, ValidationError

from oss.src.core.managed_tools.dtos import (
    ManagedAction,
    ManagedActionContext,
    ManagedActionMeasurement,
    ManagedActionOutcome,
    ManagedActionPrice,
    ManagedActionResponse,
    ManagedActionResult,
)
from oss.src.core.managed_tools.interfaces import (
    ManagedActionBillingInterface,
    ManagedActionProviderInterface,
    ManagedActionRateLimiterInterface,
)
from oss.src.core.managed_tools.registry import ManagedActionRegistry
from oss.src.core.managed_tools.types import ManagedActionNotSentError
from oss.src.core.tools.dtos import AgentError
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

# The same bounds the gateway puts on a model call's admission and usage hand-off.
ADMISSION_TIMEOUT_SECONDS = 2.0
RECORD_TIMEOUT_SECONDS = 0.5
PRICES_TIMEOUT_SECONDS = 2.0

_NOT_CHARGED = "You were not charged."


class ManagedToolsService:
    def __init__(
        self,
        *,
        registry: ManagedActionRegistry,
        billing: ManagedActionBillingInterface,
        rate_limiter: Optional[ManagedActionRateLimiterInterface] = None,
    ) -> None:
        self.registry = registry
        self.billing = billing
        self.rate_limiter = rate_limiter

    async def list_actions(
        self,
    ) -> List[Tuple[ManagedAction, Optional[ManagedActionPrice]]]:
        """Every action with its price. A listing without prices still lists."""
        try:
            prices = await asyncio.wait_for(
                self.billing.prices(), timeout=PRICES_TIMEOUT_SECONDS
            )
        except Exception:  # noqa: BLE001 - a price is decoration on a listing
            log.error("[managed-tools] prices unavailable", exc_info=True)
            prices = {}
        return [(action, prices.get(action.key)) for action in self.registry.list()]

    async def execute(
        self,
        *,
        context: ManagedActionContext,
        tool: str,
        arguments: Dict[str, Any],
    ) -> ManagedActionResult:
        # Raises for an unknown tool before anything else runs.
        action = self.registry.get_by_tool(tool)
        provider = self.registry.provider_for(action)

        try:
            validated = action.input_model.model_validate(arguments)
        except ValidationError as exc:
            return _refused(
                AgentError(
                    code="invalid_arguments",
                    message=f"The arguments do not match {action.tool}'s input schema.",
                    retryable=False,
                    next_step="Correct the arguments against the tool's schema.",
                    details={
                        "errors": exc.errors(include_url=False, include_context=False)
                    },
                )
            )

        retry_after_ms = await self._throttle(provider=provider, context=context)
        if retry_after_ms is not None:
            return _refused(
                AgentError(
                    code="rate_limited",
                    message="Too many calls to this tool from your organization.",
                    retryable=True,
                    next_step="Wait for the retry delay, then call again.",
                    details={"retry_after_ms": retry_after_ms},
                )
            )

        if not await self._admit(action=action, context=context):
            return _refused(
                AgentError(
                    code="wallet_balance_exhausted",
                    message=(
                        "Your Agenta credits do not cover this tool call, so it did not run."
                    ),
                    retryable=False,
                    next_step="Ask the user to add credits, then try again.",
                )
            )

        execution_id = f"tool_{uuid.uuid7()}"
        context = context.model_copy(update={"execution_id": execution_id})
        request = {
            **validated.model_dump(mode="json"),
            **action.binding.fixed_arguments,
        }
        started = datetime.now(timezone.utc)

        def measurement(
            outcome: ManagedActionOutcome,
            units: int = 0,
            response: Optional[ManagedActionResponse] = None,
        ) -> ManagedActionMeasurement:
            return ManagedActionMeasurement(
                execution_id=execution_id,
                action=action.key,
                provider=provider.name,
                unit=action.unit,
                units=units,
                outcome=outcome,
                context=context,
                start_time=started,
                end_time=datetime.now(timezone.utc),
                provider_reference=response.provider_reference if response else None,
                provider_cost=response.provider_cost if response else None,
            )

        try:
            response = await asyncio.wait_for(
                provider.invoke(
                    operation=action.binding.operation,
                    arguments=request,
                    context=context,
                ),
                timeout=action.timeout_seconds,
            )
        except ManagedActionNotSentError as exc:
            log.warning(
                "[managed-tools] not sent", action=action.key, reason=exc.message
            )
            return ManagedActionResult(
                execution_id=execution_id,
                error=AgentError(
                    code="provider_unavailable",
                    message=f"The tool's provider could not be reached. {_NOT_CHARGED}",
                    retryable=True,
                    next_step="Retry the call later.",
                ),
            )
        except asyncio.CancelledError:
            # The caller left while the upstream may have run: record that, then leave.
            await self._record(measurement(ManagedActionOutcome.UNKNOWN))
            raise
        except Exception:  # noqa: BLE001 - a timeout or a cut connection: outcome unknown
            log.error(
                "[managed-tools] outcome unknown",
                action=action.key,
                execution_id=execution_id,
                exc_info=True,
            )
            await self._record(measurement(ManagedActionOutcome.UNKNOWN))
            return ManagedActionResult(
                execution_id=execution_id,
                error=AgentError(
                    code="outcome_unknown",
                    message=(
                        "The tool did not answer in time, so whether it ran is unknown. "
                        + _NOT_CHARGED
                    ),
                    retryable=False,
                    next_step="Do not repeat the call; tell the user the result is unknown.",
                ),
            )

        output, error = _read(action, response)
        await self._record(
            measurement(
                ManagedActionOutcome.SUCCEEDED, action.count_units(output), response
            )
            if output is not None
            else measurement(ManagedActionOutcome.FAILED, 0, response)
        )
        return ManagedActionResult(
            execution_id=execution_id,
            output=output.model_dump(mode="json") if output is not None else None,
            error=error,
        )

    async def _throttle(
        self,
        *,
        provider: ManagedActionProviderInterface,
        context: ManagedActionContext,
    ) -> Optional[int]:
        if self.rate_limiter is None or provider.rate_limit is None:
            return None
        try:
            return await self.rate_limiter.acquire(
                provider=provider.name,
                organization_id=context.organization_id,
                limit=provider.rate_limit,
            )
        except Exception:  # noqa: BLE001 - the limit guards capacity; admission guards money
            log.warning("[managed-tools] rate limiter failed; admitting", exc_info=True)
            return None

    async def _admit(
        self, *, action: ManagedAction, context: ManagedActionContext
    ) -> bool:
        # Fails closed: a wallet that cannot answer has not said the organization may pay.
        try:
            return await asyncio.wait_for(
                self.billing.admit(
                    organization_id=context.organization_id, action=action
                ),
                timeout=ADMISSION_TIMEOUT_SECONDS,
            )
        except Exception:  # noqa: BLE001 - any failure, a timeout included, refuses
            log.error(
                "[managed-tools] admission failed; refusing",
                organization_id=str(context.organization_id),
                action=action.key,
                exc_info=True,
            )
            return False

    async def _record(self, measurement: ManagedActionMeasurement) -> None:
        # One measurement per execution, published by a task a cancelled caller cannot
        # interrupt: the upstream has already been paid either way.
        publication = asyncio.ensure_future(self._publish(measurement))
        await asyncio.shield(publication)

    async def _publish(self, measurement: ManagedActionMeasurement) -> None:
        try:
            await asyncio.wait_for(
                self.billing.record(measurement=measurement),
                timeout=RECORD_TIMEOUT_SECONDS,
            )
        except Exception:  # noqa: BLE001 - billing must never change the call's result
            log.error(
                "[managed-tools] measurement hand-off failed or timed out; publication"
                " outcome unknown",
                execution_id=measurement.execution_id,
                action=measurement.action,
                exc_info=True,
            )


def _read(
    action: ManagedAction, response: ManagedActionResponse
) -> Tuple[Optional[BaseModel], Optional[AgentError]]:
    failure = response.failure
    if failure is not None:
        if failure.kind == "rate_limited":
            return None, AgentError(
                code="provider_rate_limited",
                message=f"The tool's provider is rate limiting. {_NOT_CHARGED}",
                retryable=True,
                next_step="Wait, then call again.",
                details=(
                    {"retry_after_ms": failure.retry_after_ms}
                    if failure.retry_after_ms is not None
                    else None
                ),
            )
        if failure.kind == "auth_failed":
            log.error(
                "[managed-tools] the platform credential was refused",
                action=action.key,
                provider=action.binding.provider,
            )
            return None, AgentError(
                code="provider_auth_failed",
                message=f"The tool is misconfigured on Agenta's side. {_NOT_CHARGED}",
                retryable=False,
                next_step="Tell the user this tool is unavailable for now.",
            )
        return None, AgentError(
            code="provider_error",
            message=f"The tool's provider refused the call: {failure.message}",
            retryable=False,
            next_step="Check the arguments; do not repeat an identical call.",
        )
    try:
        return action.output_model.model_validate(response.output), None
    except ValidationError:
        log.error(
            "[managed-tools] the provider's output breaks the action's contract",
            action=action.key,
            exc_info=True,
        )
        return None, AgentError(
            code="provider_error",
            message=f"The tool's provider returned an unreadable answer. {_NOT_CHARGED}",
            retryable=False,
        )


def _refused(error: AgentError) -> ManagedActionResult:
    return ManagedActionResult(error=error)
