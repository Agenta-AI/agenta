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
from uuid import UUID

import uuid_utils.compat as uuid_compat

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
from oss.src.core.workflows.service import WorkflowsService
from oss.src.utils.logging import get_module_logger

from agenta.sdk.decorators.running import WorkflowServiceRequest
from agenta.sdk.models.workflows import WorkflowRequestData
from agenta.sdk.utils.resolvers import resolve_target_fields

log = get_module_logger(__name__)


class TriggersDispatcher:
    """Resolves and runs one inbound provider event against its bound workflow."""

    def __init__(
        self,
        *,
        triggers_dao: TriggersDAOInterface,
        workflows_service: WorkflowsService,
        dispatch_fn: Optional[Callable] = None,
    ):
        self.triggers_dao = triggers_dao
        self.workflows_service = workflows_service
        self._dispatch_fn = dispatch_fn

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
            await self._write_delivery(
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
            await self._write_delivery(
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
        """Shared path once a subscription/schedule is cleared to fire: resolve
        inputs + references, invoke the bound workflow, and record the delivery."""
        is_subscription = isinstance(entity, TriggerSubscription)
        subscription_id = entity.id if is_subscription else None
        schedule_id = None if is_subscription else entity.id

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
        selector = (
            entity.data.selector.model_dump(mode="json", exclude_none=True)
            if entity.data.selector
            else None
        )

        delivery_id = uuid_compat.uuid7()
        user_id = entity.created_by_id

        delivery_data = TriggerDeliveryData(
            event_key=entity.data.event_key,
            references=entity.data.references,
            inputs=inputs if isinstance(inputs, dict) else {"value": inputs},
        )

        if not references:
            await self._write_delivery(
                project_id=project_id,
                user_id=user_id,
                delivery_id=delivery_id,
                subscription_id=subscription_id,
                schedule_id=schedule_id,
                event_id=event_id,
                status=Status(code="400", message="failed"),
                data=delivery_data.model_copy(
                    update={"error": "Entity has no bound workflow reference"}
                ),
            )
            return

        request = WorkflowServiceRequest(
            references=references,
            selector=selector,
            data=WorkflowRequestData(
                inputs=inputs if isinstance(inputs, dict) else {"value": inputs},
            ),
        )

        if self._dispatch_fn is not None:
            # Detached path: hand off to the runner, write dispatched delivery.
            run_id = await self._dispatch_fn(
                project_id=project_id,
                user_id=user_id,
                request=request,
            )
            await self._write_delivery(
                project_id=project_id,
                user_id=user_id,
                delivery_id=delivery_id,
                subscription_id=subscription_id,
                schedule_id=schedule_id,
                event_id=event_id,
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
            )
        except Exception as e:
            log.error("[TRIGGERS DISPATCHER] invoke failed: %s", e, exc_info=True)
            await self._write_delivery(
                project_id=project_id,
                user_id=user_id,
                delivery_id=delivery_id,
                subscription_id=subscription_id,
                schedule_id=schedule_id,
                event_id=event_id,
                status=Status(code="500", message="failed"),
                data=delivery_data.model_copy(update={"error": str(e)}),
            )
            raise

        status_obj = getattr(response, "status", None)
        status_code = getattr(status_obj, "code", None)
        outputs = getattr(response, "outputs", None) or getattr(
            getattr(response, "data", None), "outputs", None
        )

        if status_code not in (None, 200):
            await self._write_delivery(
                project_id=project_id,
                user_id=user_id,
                delivery_id=delivery_id,
                subscription_id=subscription_id,
                schedule_id=schedule_id,
                event_id=event_id,
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

        await self._write_delivery(
            project_id=project_id,
            user_id=user_id,
            delivery_id=delivery_id,
            subscription_id=subscription_id,
            schedule_id=schedule_id,
            event_id=event_id,
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

    async def _write_delivery(
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
        await self.triggers_dao.write_delivery(
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
