import asyncio
import secrets
import string
from datetime import datetime, timezone
from typing import TYPE_CHECKING, List, Optional
from uuid import UUID

import uuid_utils.compat as uuid

from oss.src.core.events.dtos import Event
from oss.src.core.events.streaming import publish_event
from oss.src.core.events.types import EventType, RequestType
from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    SecretDTO,
    WebhookProviderDTO,
    WebhookProviderSettingsDTO,
)
from oss.src.core.secrets.enums import SecretKind
from oss.src.core.secrets.services import VaultService
from oss.src.core.shared.dtos import Windowing
from oss.src.core.webhooks.types import (
    WEBHOOK_TEST_MAX_ATTEMPTS,
    WEBHOOK_TEST_POLL_INTERVAL_MS,
    WebhookDelivery,
    WebhookDeliveryCreate,
    WebhookDeliveryQuery,
    WebhookSubscription,
    WebhookSubscriptionCreate,
    WebhookSubscriptionEdit,
    WebhookSubscriptionQuery,
)
from oss.src.core.webhooks.interfaces import WebhooksDAOInterface
from oss.src.core.webhooks.exceptions import (
    WebhookSubscriptionNotFoundError,
    WebhookTestDeliveryTimeoutError,
    WebhookTestEventPublishFailedError,
)
from oss.src.utils.caching import (
    AGENTA_CACHE_TTL,
    get_cache,
    invalidate_cache,
    set_cache,
)
from oss.src.utils.crypting import decrypt, encrypt
from oss.src.utils.logging import get_module_logger

if TYPE_CHECKING:
    from oss.src.tasks.taskiq.webhooks.worker import WebhooksWorker

log = get_module_logger(__name__)


class WebhooksService:
    def __init__(
        self,
        webhooks_dao: WebhooksDAOInterface,
        vault_service: VaultService,
        webhooks_worker: Optional["WebhooksWorker"] = None,
    ):
        self.dao = webhooks_dao
        self.vault_service = vault_service
        self.webhooks_worker = webhooks_worker

    def _generate_secret(self) -> str:
        alphabet = string.ascii_letters + string.digits
        return "".join(secrets.choice(alphabet) for _ in range(32))

    async def _resolve_secret(
        self, *, project_id: UUID, secret_id: UUID
    ) -> Optional[str]:
        """Fetch a subscription's signing secret from the vault."""
        try:
            secret_dto = await self.vault_service.get_secret(
                secret_id=secret_id,
                project_id=project_id,
            )
            if secret_dto is None:
                log.warning(f"Webhook secret {secret_id} not found in vault")
                return None
            key = secret_dto.data.provider.key
            if not key:
                log.warning(f"Webhook secret {secret_id} has no key value")
                return None
            return key
        except Exception as e:
            log.warning(f"Failed to resolve webhook secret {secret_id}: {e}")
            return None

    def _with_secret(
        self, subscription: WebhookSubscription, secret: Optional[str]
    ) -> WebhookSubscription:
        subscription.secret = secret
        return subscription

    # --- subscriptions ------------------------------------------------------- #

    async def create_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription: WebhookSubscriptionCreate,
    ) -> WebhookSubscription:
        secret_value = self._generate_secret()
        secret_dto = await self.vault_service.create_secret(
            project_id=project_id,
            create_secret_dto=CreateSecretDTO(
                header={
                    "name": f"webhook-{subscription.name or 'subscription'}",
                    "description": "Webhook signing secret",
                },
                secret=SecretDTO(
                    kind=SecretKind.WEBHOOK_PROVIDER,
                    data=WebhookProviderDTO(
                        provider=WebhookProviderSettingsDTO(key=secret_value),
                    ),
                ),
            ),
        )

        result = await self.dao.create_subscription(
            project_id=project_id,
            user_id=user_id,
            #
            subscription=subscription,
            #
            secret_id=secret_dto.id,
        )

        result = self._with_secret(result, secret_value)

        await set_cache(
            namespace="webhooks",
            project_id=str(project_id),
            key=f"subscription:{result.id}",
            value=result.model_copy(update={"secret": encrypt(result.secret)})
            if result.secret
            else result,
            ttl=AGENTA_CACHE_TTL,
        )
        await invalidate_cache(
            namespace="webhooks", project_id=str(project_id), key="subscriptions"
        )

        return result

    async def fetch_subscription(
        self,
        *,
        project_id: UUID,
        subscription_id: UUID,
    ) -> Optional[WebhookSubscription]:
        cached = await get_cache(
            namespace="webhooks",
            project_id=str(project_id),
            key=f"subscription:{subscription_id}",
            model=WebhookSubscription,
            is_list=False,
        )
        if cached is not None:
            if cached.secret:
                try:
                    cached = cached.model_copy(
                        update={"secret": decrypt(cached.secret)}
                    )
                except Exception:
                    log.warning(
                        f"[WEBHOOKS] Failed to decrypt cached secret for"
                        f" {subscription_id}"
                    )
                    cached = cached.model_copy(update={"secret": None})
            return cached

        result = await self.dao.fetch_subscription(
            project_id=project_id,
            subscription_id=subscription_id,
        )
        if result is None:
            return None

        if result.secret_id:
            secret_value = await self._resolve_secret(
                project_id=project_id,
                secret_id=result.secret_id,
            )
            result = self._with_secret(result, secret_value)

        await set_cache(
            namespace="webhooks",
            project_id=str(project_id),
            key=f"subscription:{result.id}",
            value=result.model_copy(update={"secret": encrypt(result.secret)})
            if result.secret
            else result,
            ttl=AGENTA_CACHE_TTL,
        )

        return result

    async def query_subscriptions(
        self,
        *,
        project_id: UUID,
        #
        subscription: Optional[WebhookSubscriptionQuery] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[WebhookSubscription]:
        return await self.dao.query_subscriptions(
            project_id=project_id,
            #
            subscription=subscription,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

    async def edit_subscription(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription: WebhookSubscriptionEdit,
    ) -> Optional[WebhookSubscription]:
        result = await self.dao.edit_subscription(
            project_id=project_id,
            user_id=user_id,
            subscription=subscription,
        )
        if result is None:
            return None

        if result.secret_id:
            secret_value = await self._resolve_secret(
                project_id=project_id,
                secret_id=result.secret_id,
            )
            result = self._with_secret(result, secret_value)

        await set_cache(
            namespace="webhooks",
            project_id=str(project_id),
            key=f"subscription:{result.id}",
            value=result.model_copy(update={"secret": encrypt(result.secret)})
            if result.secret
            else result,
            ttl=AGENTA_CACHE_TTL,
        )
        await invalidate_cache(
            namespace="webhooks", project_id=str(project_id), key="subscriptions"
        )

        return result

    async def delete_subscription(
        self,
        *,
        project_id: UUID,
        subscription_id: UUID,
    ) -> bool:
        deleted = await self.dao.delete_subscription(
            project_id=project_id,
            subscription_id=subscription_id,
        )

        if deleted:
            await invalidate_cache(
                namespace="webhooks", project_id=str(project_id), key="subscriptions"
            )
            await invalidate_cache(
                namespace="webhooks",
                project_id=str(project_id),
                key=f"subscription:{subscription_id}",
            )

        return deleted

    # --- deliveries ---------------------------------------------------------- #

    async def fetch_delivery(
        self,
        *,
        project_id: UUID,
        delivery_id: UUID,
    ) -> Optional[WebhookDelivery]:
        return await self.dao.fetch_delivery(
            project_id=project_id,
            delivery_id=delivery_id,
        )

    async def create_delivery(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        delivery: WebhookDeliveryCreate,
    ) -> WebhookDelivery:
        return await self.dao.create_delivery(
            project_id=project_id,
            user_id=user_id,
            delivery=delivery,
        )

    async def query_deliveries(
        self,
        *,
        project_id: UUID,
        #
        delivery: Optional[WebhookDeliveryQuery] = None,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[WebhookDelivery]:
        return await self.dao.query_deliveries(
            project_id=project_id,
            #
            delivery=delivery,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

    async def test_webhook(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        subscription_id: UUID,
    ) -> WebhookDelivery:
        """Test delivery by emitting an event and polling for resulting delivery."""
        subscription = await self.dao.fetch_subscription(
            project_id=project_id,
            subscription_id=subscription_id,
        )
        if subscription is None:
            raise WebhookSubscriptionNotFoundError(str(subscription_id))

        event_id = uuid.uuid7()
        published = await publish_event(
            project_id=project_id,
            event=Event(
                request_id=uuid.uuid7(),
                event_id=event_id,
                request_type=RequestType.UNKNOWN,
                event_type=EventType.WEBHOOKS_SUBSCRIPTIONS_TESTED,
                timestamp=datetime.now(timezone.utc),
                attributes={
                    "test": True,
                    "subscription_id": str(subscription_id),
                    "tested_by": str(user_id),
                },
            ),
        )
        if not published:
            raise WebhookTestEventPublishFailedError(
                event_id=str(event_id),
                subscription_id=str(subscription_id),
            )

        for attempt in range(1, WEBHOOK_TEST_MAX_ATTEMPTS + 1):
            deliveries = await self.dao.query_deliveries(
                project_id=project_id,
                delivery=WebhookDeliveryQuery(
                    subscription_id=subscription_id,
                    event_id=event_id,
                ),
                include_archived=False,
                windowing=Windowing(limit=1, order="descending"),
            )
            if deliveries:
                return deliveries[0]

            if attempt < WEBHOOK_TEST_MAX_ATTEMPTS:
                await asyncio.sleep(WEBHOOK_TEST_POLL_INTERVAL_MS / 1000)

        raise WebhookTestDeliveryTimeoutError(
            event_id=str(event_id),
            subscription_id=str(subscription_id),
            attempts=WEBHOOK_TEST_MAX_ATTEMPTS,
        )
