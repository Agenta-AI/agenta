from typing import List, Optional, Tuple
from uuid import UUID

from oss.src.utils.logging import get_module_logger

from oss.src.core.gateway.connections.service import ConnectionsService
from oss.src.core.triggers.dtos import (
    TriggerCatalogEvent,
    TriggerCatalogEventDetails,
    TriggerCatalogProvider,
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
from oss.src.core.shared.dtos import Windowing


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
        triggers_dao: Optional[TriggersDAOInterface] = None,
        connections_service: Optional[ConnectionsService] = None,
    ):
        self.adapter_registry = adapter_registry
        self.dao = triggers_dao
        self.connections_service = connections_service

    # -----------------------------------------------------------------------
    # Catalog browse
    # -----------------------------------------------------------------------

    async def list_providers(self) -> List[TriggerCatalogProvider]:
        """Return all providers across registered adapters."""
        results: List[TriggerCatalogProvider] = []
        for _key, adapter in self.adapter_registry.items():
            providers = await adapter.list_providers()
            results.extend(providers)
        return results

    async def get_provider(
        self,
        *,
        provider_key: str,
    ) -> Optional[TriggerCatalogProvider]:
        """Return a single provider by key.

        Raises ``ProviderNotFoundError`` for an unregistered key (mapped to 404
        at the router); returns None when the adapter has no matching provider.
        """
        adapter = self.adapter_registry.get(provider_key)
        providers = await adapter.list_providers()
        for p in providers:
            if p.key == provider_key:
                return p
        return None

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

    async def create_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription: TriggerSubscriptionCreate,
    ) -> TriggerSubscription:
        """Mint the provider-side ``ti_*`` on a shared connection, then persist."""
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
