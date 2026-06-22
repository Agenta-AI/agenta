import asyncio
import hashlib
import hmac
from datetime import datetime
from typing import Any, List, Mapping, Optional
from uuid import UUID

from croniter import croniter

from oss.src.utils.logging import get_module_logger

from oss.src.core.gateway.catalog.service import CatalogService
from oss.src.core.gateway.connections.service import ConnectionsService
from oss.src.core.triggers.dtos import (
    TriggerCatalogEventDetails,
    TriggerCatalogEventsPage,
    TriggerCatalogIntegration,
    TriggerCatalogIntegrationsPage,
    TriggerCatalogProvider,
    TriggerConnection,
    TriggerConnectionCreate,
    TriggerDelivery,
    TriggerDeliveryCreate,
    TriggerDeliveryQuery,
    TriggerSchedule,
    TriggerScheduleCreate,
    TriggerScheduleEdit,
    TriggerScheduleQuery,
    TriggerSubscription,
    TriggerSubscriptionCreate,
    TriggerSubscriptionEdit,
    TriggerSubscriptionQuery,
)
from oss.src.core.triggers.exceptions import (
    AdapterError,
    ConnectionNotFoundError,
    ScheduleNotFoundError,
    SubscriptionNotFoundError,
    TriggerReferenceInvalid,
    TriggerScheduleInvalid,
)
from oss.src.core.triggers.interfaces import TriggersDAOInterface
from oss.src.core.triggers.registry import TriggersGatewayRegistry
from oss.src.core.triggers.utils import WebhookSecretResolver
from oss.src.core.git.utils import build_retrieval_info
from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.workflows.service import WorkflowsService


log = get_module_logger(__name__)

_ENQUEUE_TIMEOUT_SECONDS = 5.0


class TriggersService:
    """Triggers domain orchestration.

    Covers the read-only events catalog and subscription/delivery CRUD.
    Subscriptions bind a provider event to a workflow on top of a shared gateway
    connection; the provider-side trigger instance (``ti_*``) is minted/managed
    through the adapter, never the catalog routes.
    """

    def __init__(
        self,
        *,
        adapter_registry: TriggersGatewayRegistry,
        catalog_service: CatalogService,
        triggers_dao: TriggersDAOInterface,
        connections_service: ConnectionsService,
        workflows_service: WorkflowsService,
        # Assigned post-construction in the composition root (worker wiring); guarded at use.
        schedule_dispatch_task: Optional[Any] = None,
    ):
        self.adapter_registry = adapter_registry
        self.catalog_service = catalog_service
        self.dao = triggers_dao
        self.connections_service = connections_service
        self.workflows_service = workflows_service
        self.schedule_dispatch_task = schedule_dispatch_task
        self.webhook_secret_resolver = WebhookSecretResolver(
            adapter_registry=adapter_registry,
        )

    # -----------------------------------------------------------------------
    # Catalog browse — providers + integrations come from the SHARED gateway
    # catalog service; this layer narrows them to the triggers subclass DTOs so
    # the router only ever sees triggers-domain types. Events are the
    # triggers-specific leaf (via the triggers adapter).
    # -----------------------------------------------------------------------

    async def list_providers(self) -> List[TriggerCatalogProvider]:
        providers = await self.catalog_service.list_providers()
        return [
            TriggerCatalogProvider.model_validate(p.model_dump()) for p in providers
        ]

    async def get_provider(
        self,
        *,
        provider_key: str,
    ) -> Optional[TriggerCatalogProvider]:
        provider = await self.catalog_service.get_provider(provider_key=provider_key)
        if not provider:
            return None
        return TriggerCatalogProvider.model_validate(provider.model_dump())

    async def list_integrations(
        self,
        *,
        provider_key: str,
        #
        search: Optional[str] = None,
        sort_by: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> TriggerCatalogIntegrationsPage:
        page = await self.catalog_service.list_integrations(
            provider_key=provider_key,
            search=search,
            sort_by=sort_by,
            limit=limit,
            cursor=cursor,
        )
        items = [
            TriggerCatalogIntegration.model_validate(i.model_dump())
            for i in page.integrations
        ]
        return TriggerCatalogIntegrationsPage(
            integrations=items,
            next_cursor=page.next_cursor,
            total=page.total,
        )

    async def get_integration(
        self,
        *,
        provider_key: str,
        integration_key: str,
    ) -> Optional[TriggerCatalogIntegration]:
        integration = await self.catalog_service.get_integration(
            provider_key=provider_key,
            integration_key=integration_key,
        )
        if not integration:
            return None
        return TriggerCatalogIntegration.model_validate(integration.model_dump())

    async def list_events(
        self,
        *,
        provider_key: str,
        integration_key: str,
        #
        query: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> TriggerCatalogEventsPage:
        """List events for an integration with optional search and pagination."""
        adapter = self.adapter_registry.get(provider_key)
        return await adapter.list_events(
            integration_key=integration_key,
            query=query,
            limit=limit,
            cursor=cursor,
        )

    async def get_event(
        self,
        *,
        provider_key: str,
        integration_key: str,
        event_key: str,
    ) -> Optional[TriggerCatalogEventDetails]:
        """Return full event detail including its trigger_config schema, or None."""
        adapter = self.adapter_registry.get(provider_key)
        return await adapter.get_event(
            integration_key=integration_key,
            event_key=event_key,
        )

    # -----------------------------------------------------------------------
    # Connections — shared `gateway_connections` rows via the shared
    # ConnectionsService; narrowed to the triggers subclass so the router only
    # ever sees triggers-domain types. Independent surface from tools; both
    # operate over the same rows.
    # -----------------------------------------------------------------------

    @staticmethod
    def _as_trigger_connection(conn) -> Optional[TriggerConnection]:
        return TriggerConnection.model_validate(conn.model_dump()) if conn else None

    async def query_connections(
        self,
        *,
        project_id: UUID,
        provider_key: Optional[str] = None,
        integration_key: Optional[str] = None,
        is_active: Optional[bool] = True,
    ) -> List[TriggerConnection]:
        conns = await self.connections_service.query_connections(
            project_id=project_id,
            provider_key=provider_key,
            integration_key=integration_key,
            is_active=is_active,
        )
        return [TriggerConnection.model_validate(c.model_dump()) for c in conns]

    async def get_connection(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
    ) -> Optional[TriggerConnection]:
        conn = await self.connections_service.get_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        return self._as_trigger_connection(conn)

    async def create_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        connection_create: TriggerConnectionCreate,
    ) -> TriggerConnection:
        conn = await self.connections_service.initiate_connection(
            project_id=project_id,
            user_id=user_id,
            #
            connection_create=connection_create,
        )
        return TriggerConnection.model_validate(conn.model_dump())

    async def delete_connection(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
    ) -> bool:
        return await self.connections_service.delete_connection(
            project_id=project_id,
            connection_id=connection_id,
        )

    async def refresh_connection(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        #
        force: bool = False,
    ) -> TriggerConnection:
        conn = await self.connections_service.refresh_connection(
            project_id=project_id,
            connection_id=connection_id,
            force=force,
        )
        return TriggerConnection.model_validate(conn.model_dump())

    async def revoke_connection(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
    ) -> TriggerConnection:
        conn = await self.connections_service.revoke_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        return TriggerConnection.model_validate(conn.model_dump())

    # -----------------------------------------------------------------------
    # Subscriptions
    # -----------------------------------------------------------------------

    async def _require_connection(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
    ):
        connection = await self.connections_service.get_connection(
            project_id=project_id,
            connection_id=connection_id,
        )
        if not connection:
            raise ConnectionNotFoundError(connection_id=str(connection_id))
        return connection

    async def _normalize_references(
        self,
        *,
        project_id: UUID,
        references: Optional[dict],
    ) -> None:
        """Complete the bound reference family in place, via the canonical retrieve.

        The FE sends a partial family under the proper prefix (``application`` /
        ``evaluator``, or ``environment`` + ``application``). Delegate to
        ``WorkflowsService.retrieve_workflow_revision`` (which resolves every
        family, environment-backed included) and rebuild the completed family from
        the resolved revision with ``build_retrieval_info`` — so the dispatcher's
        ``invoke_workflow`` finds the service uri.
        """
        if not references or not self.workflows_service:
            return

        def _ref(value):
            if value is None:
                return None
            return value if isinstance(value, Reference) else Reference(**dict(value))

        prefix = next(
            (
                p
                for p in ("application", "evaluator", "workflow")
                if any(references.get(k) for k in (p, f"{p}_variant", f"{p}_revision"))
            ),
            None,
        )
        environment_ref = _ref(references.get("environment"))
        if prefix is None and environment_ref is None:
            return

        key = None
        if environment_ref is not None:
            artifact = _ref(references.get("application") or references.get("workflow"))
            artifact_slug = getattr(artifact, "slug", None)
            key = f"{artifact_slug}.revision" if artifact_slug else None

        revision, _, _ = await self.workflows_service.retrieve_workflow_revision(
            project_id=project_id,
            environment_ref=environment_ref,
            key=key,
            workflow_ref=_ref(references.get(prefix)) if prefix else None,
            workflow_variant_ref=(
                _ref(references.get(f"{prefix}_variant")) if prefix else None
            ),
            workflow_revision_ref=(
                _ref(references.get(f"{prefix}_revision")) if prefix else None
            ),
        )
        if revision is None:
            raise TriggerReferenceInvalid(
                "Bound workflow reference could not be resolved to a runnable revision."
            )

        entity_type = "application" if environment_ref is not None else prefix
        info = build_retrieval_info(revision=revision, entity_type=entity_type)

        references.clear()
        references.update(info.references if info else {})

    async def create_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription: TriggerSubscriptionCreate,
    ) -> TriggerSubscription:
        """Mint the provider-side ``ti_*`` on a shared connection, then persist."""
        await self._normalize_references(
            project_id=project_id,
            references=subscription.data.references,
        )

        connection = await self._require_connection(
            project_id=project_id,
            connection_id=subscription.connection_id,
        )

        adapter = self.adapter_registry.get(connection.provider_key.value)

        trigger_id = await adapter.create_subscription(
            project_id=project_id,
            event_key=subscription.data.event_key,
            connected_account_id=connection.provider_connection_id,
            trigger_config=subscription.data.trigger_config or {},
        )

        return await self.dao.create_subscription(
            project_id=project_id,
            user_id=user_id,
            #
            subscription=subscription,
            #
            trigger_id=trigger_id,
        )

    async def fetch_subscription(
        self,
        *,
        project_id: UUID,
        #
        subscription_id: UUID,
    ) -> Optional[TriggerSubscription]:
        return await self.dao.fetch_subscription(
            project_id=project_id,
            subscription_id=subscription_id,
        )

    async def query_subscriptions(
        self,
        *,
        project_id: UUID,
        #
        subscription: Optional[TriggerSubscriptionQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[TriggerSubscription]:
        return await self.dao.query_subscriptions(
            project_id=project_id,
            subscription=subscription,
            windowing=windowing,
        )

    async def _sync_provider_enabled(
        self,
        *,
        project_id: UUID,
        subscription: TriggerSubscription,
        is_active: bool,
        is_valid: bool,
    ) -> None:
        """Reflect the combined desired state onto the provider ``ti_*``.

        The provider trigger should only fire when the subscription is BOTH
        locally active and provider-valid, so ``enabled = is_active and is_valid``.
        Single source of truth for edit/start/stop/refresh/revoke so they can't
        disagree and re-enable a revoked/paused trigger.
        """
        trigger_id = subscription.trigger_id
        if trigger_id is None:
            return
        connection = await self._require_connection(
            project_id=project_id,
            connection_id=subscription.connection_id,
        )
        adapter = self.adapter_registry.get(connection.provider_key.value)
        await adapter.set_subscription_status(
            trigger_id=trigger_id,
            enabled=is_active and is_valid,
        )

    async def edit_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription: TriggerSubscriptionEdit,
    ) -> Optional[TriggerSubscription]:
        """Full-PUT edit. Reflects the combined is_active/is_valid onto ``ti_*``."""
        existing = await self.dao.fetch_subscription(
            project_id=project_id,
            subscription_id=subscription.id,
        )
        if existing is None:
            return None

        await self._normalize_references(
            project_id=project_id,
            references=subscription.data.references,
        )

        if subscription.flags.is_active != existing.flags.is_active:
            await self._sync_provider_enabled(
                project_id=project_id,
                subscription=existing,
                is_active=subscription.flags.is_active,
                is_valid=existing.flags.is_valid,
            )

        return await self.dao.edit_subscription(
            project_id=project_id,
            user_id=user_id,
            subscription=subscription,
        )

    async def delete_subscription(
        self,
        *,
        project_id: UUID,
        #
        subscription_id: UUID,
    ) -> bool:
        """Delete the local row and the provider ``ti_*``.

        Deleting a subscription must NOT revoke the shared connection (C7): the
        adapter call below targets only the trigger instance, never the ``ca_*``.
        """
        existing = await self.dao.fetch_subscription(
            project_id=project_id,
            subscription_id=subscription_id,
        )
        if existing is None:
            return False

        trigger_id = existing.trigger_id
        if trigger_id is not None:
            connection = await self.connections_service.get_connection(
                project_id=project_id,
                connection_id=existing.connection_id,
            )
            if connection is not None:
                adapter = self.adapter_registry.get(connection.provider_key.value)
                try:
                    await adapter.delete_subscription(trigger_id=trigger_id)
                except AdapterError:
                    # Provider-side trigger may already be gone; local delete is
                    # the source of truth. Unexpected errors are left to surface.
                    log.warning(
                        "Failed to delete provider trigger %s; proceeding with local delete",
                        trigger_id,
                    )

        return await self.dao.delete_subscription(
            project_id=project_id,
            subscription_id=subscription_id,
        )

    async def refresh_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription_id: UUID,
    ) -> TriggerSubscription:
        """Re-sync the provider ``ti_*`` and mark the row valid."""
        return await self._set_valid(
            project_id=project_id,
            user_id=user_id,
            subscription_id=subscription_id,
            is_valid=True,
        )

    async def revoke_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription_id: UUID,
    ) -> TriggerSubscription:
        """Disable the provider ``ti_*`` and mark the row invalid.

        Drives the third-party-sync axis (``is_valid``); the user's local
        play/pause (``is_active``) is left untouched, as is the shared
        connection (C7).
        """
        return await self._set_valid(
            project_id=project_id,
            user_id=user_id,
            subscription_id=subscription_id,
            is_valid=False,
        )

    async def set_subscription_active(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription_id: UUID,
        is_active: bool,
    ) -> TriggerSubscription:
        """Full-PUT play/pause toggle; touches only local is_active (never is_valid).

        Distinct from /revoke, which drives the provider ti_* / is_valid axis.
        """
        existing = await self.dao.fetch_subscription(
            project_id=project_id,
            subscription_id=subscription_id,
        )
        if existing is None:
            raise SubscriptionNotFoundError(subscription_id=str(subscription_id))

        await self._sync_provider_enabled(
            project_id=project_id,
            subscription=existing,
            is_active=is_active,
            is_valid=existing.flags.is_valid,
        )

        edit = TriggerSubscriptionEdit(
            id=existing.id,
            connection_id=existing.connection_id,
            name=existing.name,
            description=existing.description,
            tags=existing.tags,
            meta=existing.meta,
            data=existing.data,
            flags=existing.flags.model_copy(update={"is_active": is_active}),
        )

        updated = await self.dao.edit_subscription(
            project_id=project_id,
            user_id=user_id,
            subscription=edit,
        )

        return updated or existing

    async def _set_valid(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        subscription_id: UUID,
        is_valid: bool,
    ) -> TriggerSubscription:
        existing = await self.dao.fetch_subscription(
            project_id=project_id,
            subscription_id=subscription_id,
        )
        if existing is None:
            raise SubscriptionNotFoundError(subscription_id=str(subscription_id))

        await self._sync_provider_enabled(
            project_id=project_id,
            subscription=existing,
            is_active=existing.flags.is_active,
            is_valid=is_valid,
        )

        edit = TriggerSubscriptionEdit(
            id=existing.id,
            connection_id=existing.connection_id,
            name=existing.name,
            description=existing.description,
            tags=existing.tags,
            meta=existing.meta,
            data=existing.data,
            flags=existing.flags.model_copy(update={"is_valid": is_valid}),
        )

        updated = await self.dao.edit_subscription(
            project_id=project_id,
            user_id=user_id,
            subscription=edit,
        )

        return updated or existing

    # -----------------------------------------------------------------------
    # Schedules
    # -----------------------------------------------------------------------

    @staticmethod
    def _validate_schedule(expr: str) -> None:
        """Reject anything that is not a valid 5-field cron expression (UTC)."""
        if not isinstance(expr, str) or len(expr.split()) != 5:
            raise TriggerScheduleInvalid(
                schedule=expr if isinstance(expr, str) else None,
                reason="not a 5-field cron expression",
            )
        if not croniter.is_valid(expr):
            raise TriggerScheduleInvalid(
                schedule=expr,
                reason="cron expression is not parseable",
            )

    async def create_schedule(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        schedule: TriggerScheduleCreate,
    ) -> TriggerSchedule:
        self._validate_schedule(schedule.data.schedule)

        await self._normalize_references(
            project_id=project_id,
            references=schedule.data.references,
        )

        return await self.dao.create_schedule(
            project_id=project_id,
            user_id=user_id,
            #
            schedule=schedule,
        )

    async def fetch_schedule(
        self,
        *,
        project_id: UUID,
        #
        schedule_id: UUID,
    ) -> Optional[TriggerSchedule]:
        return await self.dao.fetch_schedule(
            project_id=project_id,
            schedule_id=schedule_id,
        )

    async def query_schedules(
        self,
        *,
        project_id: UUID,
        #
        schedule: Optional[TriggerScheduleQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[TriggerSchedule]:
        return await self.dao.query_schedules(
            project_id=project_id,
            schedule=schedule,
            windowing=windowing,
        )

    async def edit_schedule(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        schedule: TriggerScheduleEdit,
    ) -> Optional[TriggerSchedule]:
        """Full-PUT edit (load the current row, override owned fields)."""
        existing = await self.dao.fetch_schedule(
            project_id=project_id,
            schedule_id=schedule.id,
        )
        if existing is None:
            return None

        self._validate_schedule(schedule.data.schedule)

        await self._normalize_references(
            project_id=project_id,
            references=schedule.data.references,
        )

        return await self.dao.edit_schedule(
            project_id=project_id,
            user_id=user_id,
            schedule=schedule,
        )

    async def delete_schedule(
        self,
        *,
        project_id: UUID,
        #
        schedule_id: UUID,
    ) -> bool:
        return await self.dao.delete_schedule(
            project_id=project_id,
            schedule_id=schedule_id,
        )

    async def set_schedule_active(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        schedule_id: UUID,
        is_active: bool,
    ) -> TriggerSchedule:
        """Full-PUT play/pause toggle; touches only flags.is_active."""
        existing = await self.dao.fetch_schedule(
            project_id=project_id,
            schedule_id=schedule_id,
        )
        if existing is None:
            raise ScheduleNotFoundError(schedule_id=str(schedule_id))

        edit = TriggerScheduleEdit(
            id=existing.id,
            name=existing.name,
            description=existing.description,
            tags=existing.tags,
            meta=existing.meta,
            data=existing.data,
            flags=existing.flags.model_copy(update={"is_active": is_active}),
        )

        updated = await self.dao.edit_schedule(
            project_id=project_id,
            user_id=user_id,
            schedule=edit,
        )

        return updated or existing

    async def refresh_schedules(
        self,
        *,
        timestamp: datetime,
        interval: int,
    ) -> bool:
        """Fire every active schedule whose cron matches this tick.

        Mirrors live-eval ``refresh_runs``: point-in-time ``croniter.match`` gate,
        deterministic ``event_id`` per (schedule, tick) for dedup, enqueue onto the
        schedule dispatch task.
        """
        log.info(
            f"[SCHEDULE] Refreshing schedules at {timestamp} every {interval} minute(s)"
        )

        if not timestamp:
            return False

        try:
            schedules = await self.dao.fetch_active_schedules_with_project()
        except Exception as e:  # pylint: disable=broad-exception-caught
            log.error(f"[SCHEDULE] Error fetching active schedules: {e}", exc_info=True)
            return False

        if self.schedule_dispatch_task is None:
            log.warning(
                "[SCHEDULE] Taskiq client is not configured; skipping schedule dispatch"
            )
            return False

        failures = 0
        for project_id, schedule in schedules:
            try:
                if not croniter.match(schedule.data.schedule, timestamp):
                    continue

                event_id = f"{schedule.id}:{timestamp.isoformat()}"

                already_seen = await self.dao.dedup_seen_schedule(
                    project_id=project_id,
                    schedule_id=schedule.id,
                    event_id=event_id,
                )
                if already_seen:
                    continue

                event = {
                    "metadata": {
                        "trigger_slug": schedule.data.event_key,
                        "id": event_id,
                    },
                    "payload": {"timestamp": timestamp.isoformat()},
                }

                log.info(
                    "[SCHEDULE] Dispatching...",
                    project_id=project_id,
                    schedule_id=schedule.id,
                    timestamp=timestamp,
                )

                await asyncio.wait_for(
                    self.schedule_dispatch_task.kiq(
                        project_id=str(project_id),
                        event_id=event_id,
                        event=event,
                        schedule=schedule.model_dump(mode="json"),
                    ),
                    timeout=_ENQUEUE_TIMEOUT_SECONDS,
                )

                log.info(
                    "[SCHEDULE] Dispatched.   ",
                    project_id=project_id,
                    schedule_id=schedule.id,
                )

            except Exception as e:  # pylint: disable=broad-exception-caught
                failures += 1
                log.error(
                    f"[SCHEDULE] Error refreshing schedule {schedule.id}: {e}",
                    exc_info=True,
                )

        # Report failure if any schedule dropped, so the cron/admin caller can
        # surface a non-200 instead of seeing a false success.
        return failures == 0

    # -----------------------------------------------------------------------
    # Deliveries
    # -----------------------------------------------------------------------

    async def fetch_delivery(
        self,
        *,
        project_id: UUID,
        #
        delivery_id: UUID,
    ) -> Optional[TriggerDelivery]:
        return await self.dao.fetch_delivery(
            project_id=project_id,
            delivery_id=delivery_id,
        )

    async def query_deliveries(
        self,
        *,
        project_id: UUID,
        #
        delivery: Optional[TriggerDeliveryQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[TriggerDelivery]:
        return await self.dao.query_deliveries(
            project_id=project_id,
            delivery=delivery,
            windowing=windowing,
        )

    async def write_delivery(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID] = None,
        #
        delivery: TriggerDeliveryCreate,
    ) -> TriggerDelivery:
        return await self.dao.write_delivery(
            project_id=project_id,
            user_id=user_id,
            delivery=delivery,
        )

    # -----------------------------------------------------------------------
    # Inbound webhook — registration + signature verification
    # -----------------------------------------------------------------------

    async def ensure_webhook_registered(self) -> None:
        """Ensure Composio's delivery webhook exists (startup, herd-safe)."""
        await self.webhook_secret_resolver.resolve()

    async def verify_signature(
        self, *, body: bytes, headers: Mapping[str, str]
    ) -> bool:
        """Verify Composio's HMAC over ``{webhook-id}.{webhook-timestamp}.{body}``.

        Confirmed against live events: Composio sends a lowercase hex digest.

        On mismatch, refresh the secret once (it rotates if the subscription is
        recreated) and retry before rejecting.
        """
        signature = headers.get("webhook-signature") or headers.get(
            "x-composio-signature"
        )
        if not signature:
            return False

        webhook_id = headers.get("webhook-id") or ""
        timestamp = headers.get("webhook-timestamp") or ""
        # Byte-exact signing input: avoids the lossy utf-8 decode for non-utf-8 bodies.
        signed_bytes = f"{webhook_id}.{timestamp}.".encode("utf-8") + body
        provided = signature.split(",")[-1].strip()

        for force_refresh in (False, True):
            secret = await self.webhook_secret_resolver.resolve(
                force_refresh=force_refresh,
            )
            if not secret:
                return False
            expected = hmac.new(
                secret.encode("utf-8"), signed_bytes, hashlib.sha256
            ).hexdigest()

            if hmac.compare_digest(expected, provided):
                return True

        log.warning("[TRIGGER SIGNATURE] no match webhook_id=%s", webhook_id)
        return False
