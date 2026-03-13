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
    UpdateSecretDTO,
    WebhookProviderDTO,
    WebhookProviderSettingsDTO,
)
from oss.src.core.secrets.enums import SecretKind
from oss.src.core.secrets.services import VaultService
from oss.src.core.shared.dtos import Windowing
from oss.src.core.webhooks.types import (
    WEBHOOK_TEST_MAX_ATTEMPTS,
    WEBHOOK_TEST_POLL_INTERVAL_MS,
    WebhookSubscription,
    WebhookSubscriptionCreate,
    WebhookSubscriptionEdit,
    WebhookSubscriptionQuery,
    WebhookDelivery,
    WebhookDeliveryCreate,
    WebhookDeliveryQuery,
)
from oss.src.core.webhooks.interfaces import WebhooksDAOInterface
from oss.src.core.webhooks.exceptions import (
    WebhookAuthorizationSecretRequiredError,
    WebhookSubscriptionNotFoundError,
    WebhookTestDeliveryTimeoutError,
    WebhookTestEventPublishFailedError,
)
from oss.src.utils.logging import get_module_logger

if TYPE_CHECKING:
    from oss.src.tasks.taskiq.webhooks.worker import WebhooksWorker

log = get_module_logger(__name__)


class WebhooksService:
    def __init__(
        self,
        *,
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
        self,
        *,
        project_id: UUID,
        #
        secret_id: UUID,
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
        self,
        *,
        subscription: WebhookSubscription,
        #
        secret: Optional[str],
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
        subscription.flags = None

        auth_mode = subscription.data.auth_mode if subscription.data else None

        if auth_mode == "authorization" and not subscription.secret:
            raise WebhookAuthorizationSecretRequiredError()

        secret_value = subscription.secret or self._generate_secret()

        secret_dto = await self.vault_service.create_secret(
            project_id=project_id,
            #
            create_secret_dto=CreateSecretDTO(
                header={
                    "name": f"webhook-{subscription.name or 'subscription'}",
                    "description": "Webhook signing secret",
                },
                secret=SecretDTO(
                    kind=SecretKind.WEBHOOK_PROVIDER,
                    data=WebhookProviderDTO(
                        provider=WebhookProviderSettingsDTO(
                            key=secret_value,
                        ),
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

        return self._with_secret(
            subscription=result,
            secret=secret_value,
        )

    async def fetch_subscription(
        self,
        *,
        project_id: UUID,
        #
        subscription_id: UUID,
    ) -> Optional[WebhookSubscription]:
        result = await self.dao.fetch_subscription(
            project_id=project_id,
            #
            subscription_id=subscription_id,
        )

        if result is None:
            return None

        if result.secret_id:
            secret_value = await self._resolve_secret(
                project_id=project_id,
                secret_id=result.secret_id,
            )

            result = self._with_secret(
                subscription=result,
                secret=secret_value,
            )

        return result

    async def query_subscriptions(
        self,
        *,
        project_id: UUID,
        #
        subscription: Optional[WebhookSubscriptionQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[WebhookSubscription]:
        return await self.dao.query_subscriptions(
            project_id=project_id,
            #
            subscription=subscription,
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
        subscription.flags = None

        existing = await self.dao.fetch_subscription(
            project_id=project_id,
            subscription_id=subscription.id,
        )

        if existing is None:
            return None

        if subscription.secret is not None and existing.secret_id is not None:
            await self.vault_service.update_secret(
                secret_id=existing.secret_id,
                project_id=project_id,
                update_secret_dto=UpdateSecretDTO(
                    secret=SecretDTO(
                        kind=SecretKind.WEBHOOK_PROVIDER,
                        data=WebhookProviderDTO(
                            provider=WebhookProviderSettingsDTO(
                                key=subscription.secret,
                            ),
                        ),
                    ),
                ),
            )

        result = await self.dao.edit_subscription(
            project_id=project_id,
            user_id=user_id,
            subscription=subscription,
        )

        if result is None:
            return None

        if subscription.secret is not None:
            result = self._with_secret(
                subscription=result,
                secret=subscription.secret,
            )

            return result

        if result.secret_id:
            secret_value = await self._resolve_secret(
                project_id=project_id,
                secret_id=result.secret_id,
            )
            result = self._with_secret(
                subscription=result,
                secret=secret_value,
            )

        return result

    async def delete_subscription(
        self,
        *,
        project_id: UUID,
        #
        subscription_id: UUID,
    ) -> bool:
        return await self.dao.delete_subscription(
            project_id=project_id,
            #
            subscription_id=subscription_id,
        )

    # --- deliveries --------------------------------------------------------- #

    async def fetch_delivery(
        self,
        *,
        project_id: UUID,
        #
        delivery_id: UUID,
    ) -> Optional[WebhookDelivery]:
        return await self.dao.fetch_delivery(
            project_id=project_id,
            #
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
            #
            delivery=delivery,
        )

    async def query_deliveries(
        self,
        *,
        project_id: UUID,
        #
        delivery: Optional[WebhookDeliveryQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[WebhookDelivery]:
        return await self.dao.query_deliveries(
            project_id=project_id,
            #
            delivery=delivery,
            #
            windowing=windowing,
        )

    async def test_webhook(
        self,
        *,
        project_id: UUID,
        #
        subscription_id: UUID,
    ) -> WebhookDelivery:
        """Test delivery by emitting an event and polling for resulting delivery."""
        log.info(
            "[WEBHOOKS CORE] Starting webhook test",
            project_id=str(project_id),
            subscription_id=str(subscription_id),
        )

        subscription = await self.dao.fetch_subscription(
            project_id=project_id,
            #
            subscription_id=subscription_id,
        )

        if subscription is None:
            log.warning(
                "[WEBHOOKS CORE] Webhook test aborted: subscription not found",
                project_id=str(project_id),
                subscription_id=str(subscription_id),
            )
            raise WebhookSubscriptionNotFoundError(
                subscription_id=str(subscription_id),
            )

        log.info(
            "[WEBHOOKS CORE] Subscription loaded for webhook test",
            project_id=str(project_id),
            subscription_id=str(subscription_id),
            subscription_name=subscription.name,
            subscription_url=str(subscription.data.url),
            auth_mode=subscription.data.auth_mode or "signature",
            has_secret=bool(subscription.secret_id),
            is_valid=subscription.flags.is_valid if subscription.flags else None,
        )

        # --- THIS WILL BE IMPROVED LATER ------------------------------------ #
        request_id = uuid.uuid7()
        event_id = uuid.uuid7()

        request_type = RequestType.UNKNOWN
        event_type = EventType.WEBHOOKS_SUBSCRIPTIONS_TESTED

        timestamp = datetime.now(timezone.utc)

        attributes = dict(
            subscription_id=str(subscription_id),
        )

        event = Event(
            request_id=request_id,
            event_id=event_id,
            request_type=request_type,
            event_type=event_type,
            timestamp=timestamp,
            attributes=attributes,
        )
        # --- THIS WILL BE IMPROVED LATER ------------------------------------ #

        log.info(
            "[WEBHOOKS CORE] Publishing webhook test event",
            project_id=str(project_id),
            subscription_id=str(subscription_id),
            request_id=str(request_id),
            event_id=str(event_id),
            event_type=event_type.value,
        )

        published = await publish_event(
            project_id=project_id,
            event=event,
        )

        if not published:
            log.error(
                "[WEBHOOKS CORE] Failed to publish webhook test event",
                project_id=str(project_id),
                subscription_id=str(subscription_id),
                event_id=str(event_id),
            )
            raise WebhookTestEventPublishFailedError(
                subscription_id=str(subscription_id),
                event_id=str(event_id),
            )

        log.info(
            "[WEBHOOKS CORE] Webhook test event published; polling for delivery",
            project_id=str(project_id),
            subscription_id=str(subscription_id),
            event_id=str(event_id),
            max_attempts=WEBHOOK_TEST_MAX_ATTEMPTS,
            poll_interval_ms=WEBHOOK_TEST_POLL_INTERVAL_MS,
        )

        for attempt in range(1, WEBHOOK_TEST_MAX_ATTEMPTS + 1):
            log.debug(
                "[WEBHOOKS CORE] Polling for webhook test delivery",
                project_id=str(project_id),
                subscription_id=str(subscription_id),
                event_id=str(event_id),
                attempt=attempt,
                max_attempts=WEBHOOK_TEST_MAX_ATTEMPTS,
            )

            deliveries = await self.dao.query_deliveries(
                project_id=project_id,
                #
                delivery=WebhookDeliveryQuery(
                    subscription_id=subscription_id,
                    event_id=event_id,
                ),
                #
                windowing=Windowing(
                    limit=1,
                    order="descending",
                ),
            )

            if deliveries:
                delivery = deliveries[0]
                status_message = delivery.status.message if delivery.status else None
                status_code = delivery.status.code if delivery.status else None

                log.info(
                    "[WEBHOOKS CORE] Webhook test delivery found",
                    project_id=str(project_id),
                    subscription_id=str(subscription_id),
                    event_id=str(event_id),
                    delivery_id=str(delivery.id),
                    status_message=status_message,
                    status_code=status_code,
                )

                if delivery.status and delivery.status.message == "success":
                    enabled_subscription = await self.dao.enable_subscription(
                        project_id=project_id,
                        #
                        subscription_id=subscription_id,
                    )

                    log.info(
                        "[WEBHOOKS CORE] Enabled subscription after successful webhook test",
                        project_id=str(project_id),
                        subscription_id=str(subscription_id),
                        delivery_id=str(delivery.id),
                        updated=enabled_subscription is not None,
                    )

                return delivery

            if attempt < WEBHOOK_TEST_MAX_ATTEMPTS:
                log.debug(
                    "[WEBHOOKS CORE] No webhook test delivery yet; waiting before next poll",
                    project_id=str(project_id),
                    subscription_id=str(subscription_id),
                    event_id=str(event_id),
                    attempt=attempt,
                    sleep_ms=WEBHOOK_TEST_POLL_INTERVAL_MS,
                )
                await asyncio.sleep(WEBHOOK_TEST_POLL_INTERVAL_MS / 1000)

        log.error(
            "[WEBHOOKS CORE] Timed out waiting for webhook test delivery",
            project_id=str(project_id),
            subscription_id=str(subscription_id),
            event_id=str(event_id),
            attempts=WEBHOOK_TEST_MAX_ATTEMPTS,
        )
        raise WebhookTestDeliveryTimeoutError(
            subscription_id=str(subscription_id),
            event_id=str(event_id),
            #
            attempts=WEBHOOK_TEST_MAX_ATTEMPTS,
        )
