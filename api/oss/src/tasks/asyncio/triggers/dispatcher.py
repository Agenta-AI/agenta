"""Trigger dispatcher — asyncio side of the inbound pipeline.

Entity-agnostic: ``dispatch`` runs one already-resolved entity (a
``TriggerSubscription`` from the Composio path, or a ``TriggerSchedule`` from the
cron path) against its bound workflow, dedups on ``event_id``, maps
``inputs_fields`` into the workflow inputs, and records one delivery row. The
``ti_*`` → subscription lookup lives in the worker, not here.

Self-contained so it can run inside its own TaskIQ worker process.
"""

from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional, Union
from uuid import UUID, uuid4

import uuid_utils.compat as uuid_compat

from oss.src.core.access.dtos import RunOrigin
from oss.src.core.access.principals import (
    access_denied_error,
    missing_principal_error,
    stored_work_envelope,
)
from oss.src.core.access.service import AccessService, get_access_service
from oss.src.core.tools.dtos import AgentError
from oss.src.core.shared.dtos import Status
from oss.src.core.triggers.dtos import (
    TRIGGER_CONTEXT_FIELDS,
    SUBSCRIPTION_CONTEXT_FIELDS,
    TriggerDeliveryCreate,
    TriggerDeliveryData,
    TriggerSchedule,
    TriggerSubscription,
)
from oss.src.core.triggers.interfaces import TriggersDAOInterface
from oss.src.core.sessions.dtos import (
    SessionTriggerAttribution,
    SessionTriggerKind,
)
from oss.src.core.sessions.streams.interfaces import TriggerSessionClaimsDAOInterface
from oss.src.core.sharing.admission import TRIGGER_DISPATCH_BOUNDARY, RunAdmission
from oss.src.core.sharing.dtos import SharedItemKind
from oss.src.core.sharing.service import SharingService, get_sharing_service
from oss.src.core.sharing.types import AdmissionDenied
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.workflows.types import WorkflowDetachedStartRejected
from oss.src.utils.logging import get_module_logger

from agenta.sdk.agents.requirements import (
    AGENT_NEEDS_SETUP,
    AGENT_NEEDS_SETUP_MESSAGE,
)
from agenta.sdk.decorators.running import WorkflowServiceRequest
from agenta.sdk.models.workflows import WorkflowRequestData
from agenta.sdk.utils.resolvers import resolve_target_fields

log = get_module_logger(__name__)


# A fire skipped because the agent's model needs setup: recorded once, never retried, and
# the trigger stays on. Not the retryable "500", so the claim and the dedup treat it as seen.
SKIPPED_STATUS_CODE = "422"
SKIPPED_STATUS_MESSAGE = "skipped"


def _needs_setup_details(failure_code: Any, details: Any) -> Optional[AgentError]:
    """The delivery's error envelope when the run start says the model needs setup."""
    if failure_code != AGENT_NEEDS_SETUP:
        return None
    return AgentError(
        code=AGENT_NEEDS_SETUP,
        message=AGENT_NEEDS_SETUP_MESSAGE,
        retryable=False,
        next_step="Set up the agent's model. The next run starts as usual.",
        details=details if isinstance(details, dict) else None,
    )


def _agent_deleted_error() -> AgentError:
    return AgentError(
        code="agent_deleted",
        message="The trigger's agent was deleted, so the trigger is paused.",
        retryable=False,
        next_step="Point the trigger at another agent, then turn it on again.",
    )


class TriggersDispatcher:
    """Resolves and runs one inbound provider event against its bound workflow."""

    def __init__(
        self,
        *,
        triggers_dao: TriggersDAOInterface,
        session_claims_dao: TriggerSessionClaimsDAOInterface,
        workflows_service: WorkflowsService,
        run_admission: RunAdmission,
        dispatch_fn: Optional[Callable] = None,
        access_service: Optional[AccessService] = None,
        sharing_service: Optional[SharingService] = None,
    ):
        self.triggers_dao = triggers_dao
        # Admits every fire (the principal and the resolved agent) before the claim.
        self.run_admission = run_admission
        self.session_claims_dao = session_claims_dao
        self.workflows_service = workflows_service
        self._dispatch_fn = dispatch_fn
        # None: the process's registered service (bootstrap_access).
        self._access_service = access_service
        # Every root builds the dispatcher after bootstrap_access().
        self.sharing_service = sharing_service or get_sharing_service()

    @property
    def access_service(self) -> AccessService:
        return self._access_service or get_access_service()

    def _build_context(
        self,
        *,
        event: Dict[str, Any],
        entity: Union[TriggerSubscription, TriggerSchedule],
        project_id: UUID,
    ) -> Dict[str, Any]:
        sub_dump = entity.model_dump(mode="json", exclude_none=True)
        metadata = event.get("metadata") or {}
        now = datetime.now(timezone.utc).isoformat()
        normalized = {
            "event_id": metadata.get("id"),
            "event_type": metadata.get("trigger_slug"),
            "timestamp": now,
            "created_at": now,
            "attributes": event.get("payload"),
        }
        return {
            "event": {
                k: v for k, v in normalized.items() if k in TRIGGER_CONTEXT_FIELDS
            },
            "subscription": {
                k: v for k, v in sub_dump.items() if k in SUBSCRIPTION_CONTEXT_FIELDS
            },
            "scope": {"project_id": str(project_id)},
        }

    async def dispatch_subscription(
        self,
        *,
        project_id: UUID,
        subscription: TriggerSubscription,
        event_id: str,
        event: Dict[str, Any],
    ) -> None:
        """Dispatch an inbound provider event for one subscription.

        Subscription-only gates (dedup on the provider event_id, is_valid →
        failed delivery) run here, then the path converges on ``_run``.
        """
        if not subscription.flags.is_active:
            log.info(
                "[TRIGGERS DISPATCHER] Subscription %s inactive — skipping",
                subscription.id,
            )
            return

        already_seen = await self.triggers_dao.dedup_seen(
            project_id=project_id,
            subscription_id=subscription.id,
            event_id=event_id,
        )
        if already_seen:
            log.info(
                "[TRIGGERS DISPATCHER] Duplicate event %s for subscription %s — skipping",
                event_id,
                subscription.id,
            )
            return

        # Test mode: capture the resolved event as a test delivery and skip the
        # workflow entirely (no binding required). Runs after dedup, before the
        # is_valid gate — a test sub is typically unbound/invalid by design.
        if subscription.flags.is_test:
            log.info(
                "[TRIGGERS DISPATCHER] Subscription %s is test — capturing event %s",
                subscription.id,
                event_id,
            )
            context = self._build_context(
                event=event,
                entity=subscription,
                project_id=project_id,
            )
            template = subscription.data.inputs_fields
            inputs = resolve_target_fields(
                template if template is not None else "$", context
            )
            await self._write_subscription_delivery_if_live(
                project_id=project_id,
                user_id=subscription.created_by_id,
                delivery_id=uuid_compat.uuid7(),
                subscription_id=subscription.id,
                schedule_id=None,
                event_id=event_id,
                status=Status(code="200", message="success"),
                data=TriggerDeliveryData(
                    event_key=subscription.data.event_key,
                    inputs=inputs if isinstance(inputs, dict) else {"value": inputs},
                    is_test=True,
                ),
            )
            return

        # is_valid is NOT a silent skip: write a failed delivery so the user sees
        # why nothing ran, and never invoke the workflow.
        if not subscription.flags.is_valid:
            log.info(
                "[TRIGGERS DISPATCHER] Subscription %s is invalid — failed delivery",
                subscription.id,
            )
            await self._write_subscription_delivery_if_live(
                project_id=project_id,
                user_id=subscription.created_by_id,
                delivery_id=uuid_compat.uuid7(),
                subscription_id=subscription.id,
                schedule_id=None,
                event_id=event_id,
                status=Status(code="409", message="failed"),
                data=TriggerDeliveryData(
                    event_key=subscription.data.event_key,
                    references=subscription.data.references,
                    error="Subscription is invalid (provider connection revoked or unsynced)",
                ),
            )
            return

        await self._run(
            project_id=project_id,
            entity=subscription,
            event_id=event_id,
            event=event,
        )

    async def dispatch_schedule(
        self,
        *,
        project_id: UUID,
        schedule: TriggerSchedule,
        event_id: str,
        event: Dict[str, Any],
    ) -> None:
        """Dispatch a cron tick for one schedule (no provider/validity gates).

        Dedups on the (schedule, tick) event_id like ``dispatch_subscription``: the task
        is retried on error, so without this a failure after the workflow's side effects
        landed would re-invoke it.
        """
        if not schedule.flags.is_active:
            log.info(
                "[TRIGGERS DISPATCHER] Schedule %s inactive — skipping",
                schedule.id,
            )
            return

        already_seen = await self.triggers_dao.dedup_seen_schedule(
            project_id=project_id,
            schedule_id=schedule.id,
            event_id=event_id,
        )
        if already_seen:
            log.info(
                "[TRIGGERS DISPATCHER] Duplicate event %s for schedule %s — skipping",
                event_id,
                schedule.id,
            )
            return

        await self._run(
            project_id=project_id,
            entity=schedule,
            event_id=event_id,
            event=event,
        )

    async def _run(
        self,
        *,
        project_id: UUID,
        entity: Union[TriggerSubscription, TriggerSchedule],
        event_id: str,
        event: Dict[str, Any],
    ) -> None:
        """Shared path once a subscription/schedule is cleared to fire: claim the
        delivery row, resolve inputs + references, invoke the bound workflow, and
        complete the delivery.

        The claim is the ONLY thing that authorizes an invoke: it is an atomic
        ``INSERT ... ON CONFLICT DO NOTHING ... RETURNING`` on the same unique key
        (project_id, subscription_id|schedule_id, event_id) the caller's earlier
        dedup pre-check reads. Two concurrent ticks/deliveries for the same event
        both reach `_run`, but only the one whose INSERT lands may invoke — the
        other's claim returns false and it returns immediately. Every subsequent
        write in this method UPDATEs that same claimed row by id (never inserts),
        so a delivery-write failure after a successful invoke cannot look like "no
        row exists" to a retry and cause a re-invoke.
        """
        is_subscription = isinstance(entity, TriggerSubscription)

        # No principal (created by a pod before M2, or a creatorless row the backfill
        # paused): refuse and pause. The principal is never rebuilt from created_by_id.
        if entity.principal is None:
            await self._refuse(
                project_id=project_id,
                entity=entity,
                event_id=event_id,
                reason="missing_principal",
                error=missing_principal_error(next_step="Create the trigger again."),
            )
            return

        delivery_id = uuid_compat.uuid7()
        session_id = uuid4().hex
        user_id = entity.created_by_id
        kind = (
            SessionTriggerKind.subscription
            if is_subscription
            else SessionTriggerKind.schedule
        )

        # Build the request and resolve its target BEFORE the claim, so the principal
        # is checked against the revision that will run. A build or resolution failure
        # is still recorded on a claimed delivery (400), as before.
        delivery_data = TriggerDeliveryData(session_id=session_id)
        request: Optional[WorkflowServiceRequest] = None
        failure: Optional[str] = None
        target = None
        try:
            context = self._build_context(
                event=event,
                entity=entity,
                project_id=project_id,
            )
            template = entity.data.inputs_fields
            inputs = resolve_target_fields(
                template if template is not None else "$", context
            )
            references = (
                {
                    k: ref.model_dump(mode="json", exclude_none=True)
                    for k, ref in entity.data.references.items()
                }
                if entity.data.references
                else None
            )
            if not references:
                raise ValueError("Entity has no bound workflow reference")
            selector = (
                entity.data.selector.model_dump(mode="json", exclude_none=True)
                if entity.data.selector
                else None
            )
            delivery_data = TriggerDeliveryData(
                session_id=session_id,
                event_key=entity.data.event_key,
                references=entity.data.references,
                inputs=inputs if isinstance(inputs, dict) else {"value": inputs},
            )
            request = WorkflowServiceRequest(
                references=references,
                selector=selector,
                session_id=session_id,
                data=WorkflowRequestData(
                    inputs=inputs if isinstance(inputs, dict) else {"value": inputs},
                ),
            )
            target = await self.workflows_service.resolve_request_target(
                project_id=project_id,
                request=request,
            )
            if target is None:
                raise ValueError("The bound workflow reference resolves to no revision")
        except Exception as e:
            failure = str(e)

        if failure is None and target is not None and target.archived:
            await self._refuse(
                project_id=project_id,
                entity=entity,
                event_id=event_id,
                reason="agent_deleted",
                error=_agent_deleted_error(),
            )
            return

        envelope = None
        if failure is None:
            envelope = stored_work_envelope(
                principal=entity.principal,
                organization_id=await self._organization_id(project_id=project_id),
                project_id=project_id,
                origin=(
                    RunOrigin.SUBSCRIPTION if is_subscription else RunOrigin.SCHEDULE
                ),
                origin_id=str(entity.id),
                created_by_id=entity.created_by_id,
            )
            # The target resolved above is the one checked and the one that runs
            # (the stored `artifact_id` is a pause index, never read here). The
            # admission logs a refusal with the run context (origin, trigger id).
            try:
                await self.run_admission.admit(
                    envelope=envelope,
                    session_id=None,
                    agent_artifact_id=target.artifact_id,
                    boundary=TRIGGER_DISPATCH_BOUNDARY,
                )
            except AdmissionDenied as denied:
                decision = denied.decision
                await self._refuse(
                    project_id=project_id,
                    entity=entity,
                    event_id=event_id,
                    reason="access_denied",
                    error=access_denied_error(
                        decision=decision,
                        principal_kind=entity.principal.kind,
                        project_id=project_id,
                    ),
                )
                return

        claimed = await self.session_claims_dao.claim_trigger_delivery(
            project_id=project_id,
            user_id=user_id,
            event_id=event_id,
            session_id=session_id,
            attribution=SessionTriggerAttribution(
                configuration_id=entity.id,
                kind=kind,
                delivery_id=delivery_id,
            ),
            access=self.sharing_service.initial_policy(
                principal=entity.principal,
                origin=(
                    RunOrigin.SUBSCRIPTION if is_subscription else RunOrigin.SCHEDULE
                ),
                sender_user_id=None,
                kind=SharedItemKind.SESSION,
            ),
        )
        if not claimed:
            log.info(
                "[TRIGGERS DISPATCHER] claim lost for entity=%s event=%s — already "
                "claimed/delivered, skipping invoke",
                entity.id,
                event_id,
            )
            return

        if failure is not None:
            await self._complete_delivery(
                project_id=project_id,
                delivery_id=delivery_id,
                status=Status(code="400", message="failed"),
                data=delivery_data.model_copy(update={"error": failure}),
            )
            await self._abandon_claimed_session(
                project_id=project_id, session_id=session_id
            )
            return

        if self._dispatch_fn is not None:
            # Detached completion means the runner accepted ownership. The API has no durable
            # callback for the run's later terminal outcome, so this delivery remains 202.
            try:
                run_id = await self._dispatch_fn(
                    project_id=project_id,
                    user_id=user_id,
                    request=request,
                    envelope=envelope,
                )
            except Exception as e:
                skipped = (
                    _needs_setup_details(e.failure_code, e.failure_details)
                    if isinstance(e, WorkflowDetachedStartRejected)
                    else None
                )
                if skipped is not None:
                    await self._skip_delivery(
                        project_id=project_id,
                        delivery_id=delivery_id,
                        session_id=session_id,
                        delivery_data=delivery_data,
                        error=skipped,
                    )
                    log.info(
                        "[TRIGGERS DISPATCHER] skipped entity=%s event=%s: agent needs setup",
                        entity.id,
                        event_id,
                    )
                    return
                log.error("[TRIGGERS DISPATCHER] detached invoke failed: %s", e)
                await self._complete_delivery(
                    project_id=project_id,
                    delivery_id=delivery_id,
                    status=Status(code="500", message="failed"),
                    data=delivery_data.model_copy(update={"error": str(e)}),
                )
                await self._abandon_claimed_session(
                    project_id=project_id, session_id=session_id
                )
                raise
            await self._complete_delivery(
                project_id=project_id,
                delivery_id=delivery_id,
                status=Status(code="202", message="dispatched"),
                data=delivery_data.model_copy(update={"result": {"run_id": run_id}}),
            )
            log.info(
                "[TRIGGERS DISPATCHER] detached dispatch entity=%s event=%s run_id=%s",
                entity.id,
                event_id,
                run_id,
            )
            return

        try:
            response = await self.workflows_service.invoke_workflow(
                project_id=project_id,
                user_id=user_id,
                request=request,
                envelope=envelope,
            )
        except Exception as e:
            log.error("[TRIGGERS DISPATCHER] invoke failed: %s", e, exc_info=True)
            await self._complete_delivery(
                project_id=project_id,
                delivery_id=delivery_id,
                status=Status(code="500", message="failed"),
                data=delivery_data.model_copy(update={"error": str(e)}),
            )
            raise

        status_obj = getattr(response, "status", None)
        status_code = getattr(status_obj, "code", None)
        outputs = getattr(response, "outputs", None) or getattr(
            getattr(response, "data", None), "outputs", None
        )

        skipped = _needs_setup_details(
            getattr(status_obj, "failure_code", None),
            getattr(status_obj, "details", None),
        )
        if skipped is not None:
            await self._skip_delivery(
                project_id=project_id,
                delivery_id=delivery_id,
                session_id=session_id,
                delivery_data=delivery_data,
                error=skipped,
            )
            return

        if status_code not in (None, 200):
            await self._complete_delivery(
                project_id=project_id,
                delivery_id=delivery_id,
                status=Status(code=str(status_code), message="failed"),
                data=delivery_data.model_copy(
                    update={
                        "error": getattr(status_obj, "message", None)
                        or "Workflow failed",
                        "result": {
                            "trace_id": getattr(response, "trace_id", None),
                            "span_id": getattr(response, "span_id", None),
                        },
                    }
                ),
            )
            return

        await self._complete_delivery(
            project_id=project_id,
            delivery_id=delivery_id,
            status=Status(code="200", message="success"),
            data=delivery_data.model_copy(
                update={
                    "result": {
                        "trace_id": getattr(response, "trace_id", None),
                        "span_id": getattr(response, "span_id", None),
                        "outputs": outputs,
                    }
                }
            ),
        )
        log.info(
            "[TRIGGERS DISPATCHER] dispatch complete entity=%s event=%s status=200",
            entity.id,
            event_id,
        )

    async def _skip_delivery(
        self,
        *,
        project_id: UUID,
        delivery_id: Any,
        session_id: Any,
        delivery_data: Any,
        error: AgentError,
    ) -> None:
        """Record a fire the agent could not run (needs setup) and keep the trigger on."""
        await self._complete_delivery(
            project_id=project_id,
            delivery_id=delivery_id,
            status=Status(code=SKIPPED_STATUS_CODE, message=SKIPPED_STATUS_MESSAGE),
            data=delivery_data.model_copy(
                update={"error": error.message, "error_details": error}
            ),
        )
        await self._abandon_claimed_session(
            project_id=project_id, session_id=session_id
        )

    async def _organization_id(self, *, project_id: UUID) -> UUID:
        organization_id = await self.access_service.project_organization_id(
            project_id=project_id
        )
        if organization_id is None:
            raise ValueError(f"project {project_id} has no organization")
        return organization_id

    async def _refuse(
        self,
        *,
        project_id: UUID,
        entity: Union[TriggerSubscription, TriggerSchedule],
        event_id: str,
        reason: str,
        error: AgentError,
    ) -> None:
        """A refused delivery (status failed, `error` the message, `error_details` the
        envelope) and the trigger paused, in one DAO transaction. A repeated event
        writes nothing."""

        is_subscription = isinstance(entity, TriggerSubscription)
        await self.triggers_dao.refuse_delivery(
            project_id=project_id,
            user_id=entity.created_by_id,
            delivery=TriggerDeliveryCreate(
                id=uuid_compat.uuid7(),
                subscription_id=entity.id if is_subscription else None,
                schedule_id=None if is_subscription else entity.id,
                event_id=event_id,
                status=Status(code="403", message="failed"),
                data=TriggerDeliveryData(
                    event_key=entity.data.event_key,
                    references=entity.data.references,
                    error=error.message,
                    error_details=error,
                ),
            ),
            reason=reason,
        )
        log.info(
            "[triggers] paused",
            trigger_kind="subscription" if is_subscription else "schedule",
            trigger_id=str(entity.id),
            project_id=str(project_id),
            principal_kind=entity.principal.kind.value if entity.principal else None,
            principal_id=str(entity.principal.id) if entity.principal else None,
            reason=reason,
        )

    async def _write_subscription_delivery_if_live(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        delivery_id: UUID,
        subscription_id: Optional[UUID],
        schedule_id: Optional[UUID],
        event_id: str,
        status: Status,
        data: TriggerDeliveryData,
    ) -> None:
        written = await self.triggers_dao.write_subscription_delivery_if_live(
            project_id=project_id,
            user_id=user_id,
            delivery=TriggerDeliveryCreate(
                id=delivery_id,
                subscription_id=subscription_id,
                schedule_id=schedule_id,
                event_id=event_id,
                status=status,
                data=data,
            ),
        )
        if written is None:
            # The subscription went inactive/was deleted between the dispatcher's
            # gate check and this write — not an error, but a silent no-op here
            # otherwise looks identical to a normal write from the logs alone.
            log.info(
                "[TRIGGERS DISPATCHER] delivery write skipped — subscription %s "
                "is no longer live/active (event=%s)",
                subscription_id,
                event_id,
            )

    async def _abandon_claimed_session(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> None:
        """Soft-delete the session_streams row `_run`'s claim inserted, when dispatch
        fails before a turn ever starts. Its `flags` are NULL at claim time — the
        orphan sweep only matches `is_alive: true` — so left alone it becomes a
        permanent, un-sweepable phantom session (P0-3)."""
        try:
            await self.session_claims_dao.abandon_claimed_session(
                project_id=project_id, session_id=session_id
            )
        except Exception:
            log.error(
                "[TRIGGERS DISPATCHER] failed to abandon claimed session=%s",
                session_id,
                exc_info=True,
            )

    async def _complete_delivery(
        self,
        *,
        project_id: UUID,
        delivery_id: UUID,
        status: Status,
        data: TriggerDeliveryData,
    ) -> None:
        """Complete a row `_run` already claimed — an UPDATE by id, never a fresh
        INSERT, so a write failure here cannot look like "no delivery yet" to a
        retry (see `_run`'s claim-then-update contract)."""
        await self.triggers_dao.update_delivery(
            project_id=project_id,
            delivery_id=delivery_id,
            status=status,
            data=data,
        )
