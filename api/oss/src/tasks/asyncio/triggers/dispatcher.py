"""Trigger dispatcher — asyncio side of the inbound pipeline.

The inbound dual of ``webhooks/dispatcher.py``. Given a verified Composio event
(``ti_*`` trigger id + ``metadata.id`` dedup key + raw payload), it resolves the
local subscription, dedups, maps ``inputs_fields`` into the workflow inputs, runs
the bound workflow, and records a single delivery row with the outcome.

Self-contained so it can run inside its own TaskIQ worker process.
"""

from typing import Any, Dict, Optional
from uuid import UUID

import uuid_utils.compat as uuid_compat

from oss.src.core.shared.dtos import Status
from oss.src.core.triggers.dtos import (
    TRIGGER_EVENT_FIELDS,
    SUBSCRIPTION_CONTEXT_FIELDS,
    TriggerDeliveryCreate,
    TriggerDeliveryData,
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
        subscription: TriggerSubscription,
        project_id: UUID,
    ) -> Dict[str, Any]:
        sub_dump = subscription.model_dump(mode="json", exclude_none=True)
        return {
            "event": {k: v for k, v in event.items() if k in TRIGGER_EVENT_FIELDS},
            "subscription": {
                k: v for k, v in sub_dump.items() if k in SUBSCRIPTION_CONTEXT_FIELDS
            },
            "scope": {"project_id": str(project_id)},
        }

    async def dispatch(
        self,
        *,
        trigger_id: str,
        event_id: str,
        event: Dict[str, Any],
    ) -> None:
        """Run the bound workflow for one inbound event (idempotent on event_id)."""
        resolved = await self.triggers_dao.get_project_and_subscription_by_trigger_id(
            trigger_id=trigger_id,
        )

        if resolved is None:
            log.info(
                "[TRIGGERS DISPATCHER] Unknown trigger_id %s — skipping", trigger_id
            )
            return

        project_id, subscription = resolved

        if not subscription.enabled:
            log.info(
                "[TRIGGERS DISPATCHER] Subscription %s disabled — skipping",
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

        context = self._build_context(
            event=event,
            subscription=subscription,
            project_id=project_id,
        )

        # MAPPING — inputs-only template (default whole-context "$" like webhooks).
        template = subscription.data.inputs_fields
        inputs = resolve_target_fields(
            template if template is not None else "$", context
        )

        references = (
            {
                k: ref.model_dump(mode="json", exclude_none=True)
                for k, ref in subscription.data.references.items()
            }
            if subscription.data.references
            else None
        )
        selector = (
            subscription.data.selector.model_dump(mode="json", exclude_none=True)
            if subscription.data.selector
            else None
        )

        delivery_id = uuid_compat.uuid7()
        user_id = subscription.created_by_id  # M6 — attribute to the creator, or None

        delivery_data = TriggerDeliveryData(
            event_key=subscription.data.event_key,
            references=subscription.data.references,
            inputs=inputs if isinstance(inputs, dict) else {"value": inputs},
        )

        if not references:
            await self._write_delivery(
                project_id=project_id,
                user_id=user_id,
                delivery_id=delivery_id,
                subscription_id=subscription.id,
                event_id=event_id,
                status=Status(code="400", message="failed"),
                data=delivery_data.model_copy(
                    update={"error": "Subscription has no bound workflow reference"}
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
            await self._write_delivery(
                project_id=project_id,
                user_id=user_id,
                delivery_id=delivery_id,
                subscription_id=subscription.id,
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
                subscription_id=subscription.id,
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
            subscription_id=subscription.id,
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

    async def _write_delivery(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        delivery_id: UUID,
        subscription_id: UUID,
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
                event_id=event_id,
                status=status,
                data=data,
            ),
        )
