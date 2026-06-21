"""Trigger dispatcher — asyncio side of the inbound pipeline.

Entity-agnostic: ``dispatch`` runs one already-resolved entity (a
``TriggerSubscription`` from the Composio path, or a ``TriggerSchedule`` from the
cron path) against its bound workflow, dedups on ``event_id``, maps
``inputs_fields`` into the workflow inputs, and records one delivery row. The
``ti_*`` → subscription lookup lives in the worker, not here.

Self-contained so it can run inside its own TaskIQ worker process.
"""

from datetime import datetime, timezone
from typing import Any, Dict, Optional, Union
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
    ):
        self.triggers_dao = triggers_dao
        self.workflows_service = workflows_service

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
            "trigger_id": metadata.get("trigger_id"),
            "trigger_type": metadata.get("trigger_slug"),
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

    async def dispatch(
        self,
        *,
        project_id: UUID,
        entity: Union[TriggerSubscription, TriggerSchedule],
        event_id: str,
        event: Dict[str, Any],
    ) -> None:
        """Run the bound workflow for one resolved entity (idempotent on event_id)."""
        is_subscription = isinstance(entity, TriggerSubscription)

        if not entity.flags.is_active:
            log.info(
                "[TRIGGERS DISPATCHER] Entity %s inactive — skipping",
                entity.id,
            )
            return

        # is_valid (subscriptions only) is NOT a silent skip: let it fall through to
        # the failed-delivery branch so the user sees why nothing ran.
        if is_subscription:
            already_seen = await self.triggers_dao.dedup_seen(
                project_id=project_id,
                subscription_id=entity.id,
                event_id=event_id,
            )
            if already_seen:
                log.info(
                    "[TRIGGERS DISPATCHER] Duplicate event %s for subscription %s — skipping",
                    event_id,
                    entity.id,
                )
                return

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
                entity=entity,
                event_id=event_id,
                status=Status(code="400", message="failed"),
                data=delivery_data.model_copy(
                    update={"error": "Entity has no bound workflow reference"}
                ),
            )
            return

        try:
            request = WorkflowServiceRequest(
                references=references,
                selector=selector,
                data=WorkflowRequestData(
                    inputs=inputs if isinstance(inputs, dict) else {"value": inputs},
                ),
            )

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
                entity=entity,
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
                entity=entity,
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
            entity=entity,
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
        entity: Union[TriggerSubscription, TriggerSchedule],
        event_id: str,
        status: Status,
        data: TriggerDeliveryData,
    ) -> None:
        is_subscription = isinstance(entity, TriggerSubscription)
        await self.triggers_dao.write_delivery(
            project_id=project_id,
            user_id=user_id,
            delivery=TriggerDeliveryCreate(
                id=delivery_id,
                subscription_id=entity.id if is_subscription else None,
                schedule_id=None if is_subscription else entity.id,
                event_id=event_id,
                status=status,
                data=data,
            ),
        )
