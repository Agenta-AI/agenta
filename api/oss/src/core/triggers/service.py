import hashlib
import hmac
from typing import List, Mapping, Optional, Tuple
from uuid import UUID

from oss.src.utils.logging import get_module_logger

from oss.src.core.gateway.catalog.service import CatalogService
from oss.src.core.gateway.connections.service import ConnectionsService
from oss.src.core.triggers.dtos import (
    TriggerCatalogEvent,
    TriggerCatalogEventDetails,
    TriggerCatalogIntegration,
    TriggerCatalogProvider,
    TriggerConnection,
    TriggerConnectionCreate,
    TriggerDelivery,
    TriggerDeliveryCreate,
    TriggerDeliveryQuery,
    TriggerSubscription,
    TriggerSubscriptionCreate,
    TriggerSubscriptionEdit,
    TriggerSubscriptionQuery,
)
from oss.src.core.triggers.exceptions import (
    ConnectionNotFoundError,
    SubscriptionNotFoundError,
)
from oss.src.core.triggers.interfaces import TriggersDAOInterface
from oss.src.core.triggers.registry import TriggersGatewayRegistry
from oss.src.core.triggers.utils import WebhookSecretResolver
from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.workflows.service import WorkflowsService


log = get_module_logger(__name__)


class TriggersService:
    """Triggers domain orchestration.

    Covers the read-only events catalog (WP1) and subscription/delivery
    CRUD (WP3). Subscriptions bind a provider event to a workflow on top of a
    shared gateway connection; the provider-side trigger instance (``ti_*``) is
    minted/managed through the adapter, never the catalog routes.
    """

    def __init__(
        self,
        *,
        adapter_registry: TriggersGatewayRegistry,
        catalog_service: CatalogService,
        triggers_dao: Optional[TriggersDAOInterface] = None,
        connections_service: Optional[ConnectionsService] = None,
        workflows_service: Optional[WorkflowsService] = None,
    ):
        self.adapter_registry = adapter_registry
        self.catalog_service = catalog_service
        self.dao = triggers_dao
        self.connections_service = connections_service
        self.workflows_service = workflows_service
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
    ) -> Tuple[List[TriggerCatalogIntegration], Optional[str], int]:
        integrations, next_cursor, total = await self.catalog_service.list_integrations(
            provider_key=provider_key,
            search=search,
            sort_by=sort_by,
            limit=limit,
            cursor=cursor,
        )
        items = [
            TriggerCatalogIntegration.model_validate(i.model_dump())
            for i in integrations
        ]
        return items, next_cursor, total

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
    ) -> Tuple[List[TriggerCatalogEvent], Optional[str], int]:
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
        """Resolve the bound workflow ref to a runnable revision, in place.

        The UI may send a variant id (or a bare/partial ref) under
        ``workflow_revision``; resolve it to the actual workflow revision (by
        revision id, else by variant id → latest) and rewrite id/slug/version so
        the dispatcher's ``invoke_workflow`` finds the service uri (mirrors the
        reference completion done on /deploy).
        """
        if not references or not self.workflows_service:
            return

        ref = references.get("workflow_revision")
        ref_id = getattr(ref, "id", None) if ref else None
        if not ref_id:
            return

        revision = await self.workflows_service.fetch_workflow_revision(
            project_id=project_id,
            workflow_revision_ref=Reference(id=ref_id),
        )
        if revision is None:
            # Not a revision id — try it as a variant id (latest revision).
            revision = await self.workflows_service.fetch_workflow_revision(
                project_id=project_id,
                workflow_variant_ref=Reference(id=ref_id),
            )
        if revision is None:
            return

        references["workflow_revision"] = Reference(
            id=revision.id,
            slug=revision.slug,
            version=revision.version,
        )

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

        ti_id = await adapter.create_subscription(
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
            ti_id=ti_id,
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

    async def edit_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription: TriggerSubscriptionEdit,
    ) -> Optional[TriggerSubscription]:
        """Full-PUT edit. Reflects the enabled flag onto the provider ``ti_*``."""
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

        ti_id = existing.data.ti_id
        if ti_id is not None and subscription.enabled != existing.enabled:
            connection = await self._require_connection(
                project_id=project_id,
                connection_id=existing.connection_id,
            )
            adapter = self.adapter_registry.get(connection.provider_key.value)
            await adapter.set_subscription_status(
                trigger_id=ti_id,
                enabled=subscription.enabled,
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

        ti_id = existing.data.ti_id
        if ti_id is not None:
            connection = await self.connections_service.get_connection(
                project_id=project_id,
                connection_id=existing.connection_id,
            )
            if connection is not None:
                adapter = self.adapter_registry.get(connection.provider_key.value)
                try:
                    await adapter.delete_subscription(trigger_id=ti_id)
                except Exception:
                    log.warning(
                        "Failed to delete provider trigger %s; proceeding with local delete",
                        ti_id,
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
        """Re-enable the provider ``ti_*`` and mark the row enabled+valid."""
        return await self._set_enabled(
            project_id=project_id,
            user_id=user_id,
            subscription_id=subscription_id,
            enabled=True,
        )

    async def revoke_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription_id: UUID,
    ) -> TriggerSubscription:
        """Disable the provider ``ti_*`` and mark the row disabled.

        Local + provider trigger-instance only; the shared connection is never
        touched (C7).
        """
        return await self._set_enabled(
            project_id=project_id,
            user_id=user_id,
            subscription_id=subscription_id,
            enabled=False,
        )

    async def _set_enabled(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        subscription_id: UUID,
        enabled: bool,
    ) -> TriggerSubscription:
        existing = await self.dao.fetch_subscription(
            project_id=project_id,
            subscription_id=subscription_id,
        )
        if existing is None:
            raise SubscriptionNotFoundError(subscription_id=str(subscription_id))

        ti_id = existing.data.ti_id
        if ti_id is not None:
            connection = await self._require_connection(
                project_id=project_id,
                connection_id=existing.connection_id,
            )
            adapter = self.adapter_registry.get(connection.provider_key.value)
            await adapter.set_subscription_status(
                trigger_id=ti_id,
                enabled=enabled,
            )

        edit = TriggerSubscriptionEdit(
            id=existing.id,
            connection_id=existing.connection_id,
            name=existing.name,
            description=existing.description,
            tags=existing.tags,
            meta=existing.meta,
            data=existing.data,
            enabled=enabled,
            valid=existing.valid,
        )

        updated = await self.dao.edit_subscription(
            project_id=project_id,
            user_id=user_id,
            subscription=edit,
        )

        return updated or existing

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
        signed = f"{webhook_id}.{timestamp}.{body.decode('utf-8', errors='replace')}"
        provided = signature.split(",")[-1].strip()

        for force_refresh in (False, True):
            secret = await self.webhook_secret_resolver.resolve(
                force_refresh=force_refresh,
            )
            if not secret:
                return False
            expected = hmac.new(
                secret.encode("utf-8"),
                signed.encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()
            if hmac.compare_digest(expected, provided):
                return True

        return False
