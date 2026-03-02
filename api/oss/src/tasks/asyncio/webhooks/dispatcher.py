"""Webhook dispatcher — asyncio side of the delivery pipeline.

Reads grouped EventMessages (already parsed by the events worker), finds
matching active subscriptions for each project (from cache or Postgres),
and enqueues one TaskIQ delivery task per (event, subscription) pair.

The dispatcher is intentionally self-contained so it can be extracted into
its own consumer process later without changing its internal logic.
"""

from typing import Any, Dict, List, Optional
from uuid import UUID

import uuid_utils.compat as uuid_compat

from oss.src.core.secrets.services import VaultService
from oss.src.core.events.types import EventType
from oss.src.core.webhooks.types import (
    WebhookSubscription,
    WebhookSubscriptionQuery,
    WebhookSubscriptionQueryFlags,
)
from oss.src.core.webhooks.interfaces import WebhooksDAOInterface
from oss.src.utils.caching import get_cache, set_cache, AGENTA_CACHE_TTL
from oss.src.utils.crypting import decrypt, encrypt
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class WebhooksDispatcher:
    """Dispatches webhook delivery tasks for a batch of ingested events.

    Constructed once at worker startup and injected into EventsWorker.
    The deliver_task parameter is the registered TaskIQ task callable
    (supports .kiq() for async enqueuing).
    """

    def __init__(
        self,
        *,
        subscriptions_dao: WebhooksDAOInterface,
        vault_service: VaultService,
        deliver_task: Any,
    ):
        self.subscriptions_dao = subscriptions_dao
        self.vault_service = vault_service
        self.deliver_task = deliver_task

    # --- internal helpers ---------------------------------------------------- #

    async def _resolve_secret(
        self,
        *,
        project_id: UUID,
        secret_id: UUID,
    ) -> Optional[str]:
        try:
            secret_dto = await self.vault_service.get_secret(
                secret_id=secret_id,
                project_id=project_id,
            )
            if secret_dto is None:
                log.warning(
                    f"[WEBHOOKS DISPATCHER] Secret {secret_id} not found in vault"
                )
                return None
            key = secret_dto.data.provider.key
            if not key:
                log.warning(
                    f"[WEBHOOKS DISPATCHER] Secret {secret_id} has no key value"
                )
                return None
            return key
        except Exception as e:
            log.warning(
                f"[WEBHOOKS DISPATCHER] Failed to resolve secret {secret_id}: {e}"
            )
            return None

    async def _get_subscriptions(
        self,
        project_id: UUID,
    ) -> List[WebhookSubscription]:
        """Return validated subscriptions for the project, with secrets resolved.

        Hits the cache on warm paths; falls back to Postgres + vault on miss.
        """
        cached = await get_cache(
            namespace="webhooks",
            project_id=str(project_id),
            key="subscriptions",
            model=WebhookSubscription,
            is_list=True,
        )
        if cached is not None:
            decrypted = []
            for sub in cached:
                if sub.secret:
                    try:
                        sub = sub.model_copy(update={"secret": decrypt(sub.secret)})
                    except Exception:
                        log.warning(
                            f"[WEBHOOKS DISPATCHER] Failed to decrypt cached secret for {sub.id}"
                        )
                        sub = sub.model_copy(update={"secret": None})
                decrypted.append(sub)
            return decrypted

        subscriptions = await self.subscriptions_dao.query_subscriptions(
            project_id=project_id,
            subscription=WebhookSubscriptionQuery(
                flags=WebhookSubscriptionQueryFlags(is_valid=True),
            ),
            include_archived=False,
        )

        # Resolve secrets (vault reads happen only on cache miss)
        result: List[WebhookSubscription] = []
        for sub in subscriptions:
            if sub.secret_id:
                secret = await self._resolve_secret(
                    project_id=project_id,
                    secret_id=sub.secret_id,
                )
                if secret:
                    sub = sub.model_copy(update={"secret": secret})
            result.append(sub)

        encrypted = [
            sub.model_copy(update={"secret": encrypt(sub.secret)})
            if sub.secret
            else sub
            for sub in result
        ]
        await set_cache(
            namespace="webhooks",
            project_id=str(project_id),
            key="subscriptions",
            value=encrypted,
            ttl=AGENTA_CACHE_TTL,
        )
        return result

    # --- public API ---------------------------------------------------------- #

    async def dispatch(
        self,
        batches: List[Dict[str, Any]],
    ) -> None:
        """Fan out TaskIQ delivery tasks for all (event, subscription) matches."""
        enqueue_failures = 0

        for project_batch in batches:
            project_id = project_batch["project_id"]
            try:
                subscriptions = await self._get_subscriptions(project_id)
            except Exception as e:
                log.error(
                    f"[WEBHOOKS DISPATCHER] Failed to load subscriptions "
                    f"for project {project_id}: {e}"
                )
                enqueue_failures += len(project_batch["events"])
                continue

            for msg in project_batch["events"]:
                event = msg.event
                event_type = event.event_type.value
                target_subscription_id = None
                if event.event_type == EventType.WEBHOOKS_SUBSCRIPTIONS_TESTED:
                    target_subscription_id = (
                        (event.attributes or {}).get("subscription_id")
                        if event.attributes
                        else None
                    )

                if target_subscription_id is not None:
                    matching = [
                        sub
                        for sub in subscriptions
                        if str(sub.id) == target_subscription_id
                    ]
                else:
                    matching = [
                        sub
                        for sub in subscriptions
                        if sub.data.event_types is None
                        or event_type in sub.data.event_types
                    ]

                for sub in matching:
                    if not sub.secret:
                        log.warning(
                            f"[WEBHOOKS DISPATCHER] Skipping subscription {sub.id} "
                            f"— no secret resolved"
                        )
                        continue

                    try:
                        delivery_id = uuid_compat.uuid7()

                        await self.deliver_task.kiq(
                            project_id=str(project_id),
                            #
                            delivery_id=str(delivery_id),
                            #
                            subscription_id=str(sub.id),
                            event_id=str(event.event_id),
                            #
                            url=str(sub.data.url),
                            headers=sub.data.headers or {},
                            encrypted_secret=encrypt(sub.secret),
                            #
                            event_type=event_type,
                            payload=event.attributes or {},
                        )
                        log.debug(
                            f"[WEBHOOKS DISPATCHER] Enqueued delivery "
                            f"delivery={delivery_id} event={event.event_id} "
                            f"subscription={sub.id}"
                        )
                    except Exception as e:
                        log.error(
                            f"[WEBHOOKS DISPATCHER] Failed to enqueue delivery "
                            f"for subscription {sub.id}: {e}"
                        )
                        enqueue_failures += 1

        if enqueue_failures > 0:
            raise RuntimeError(
                f"Webhook dispatch had {enqueue_failures} enqueue failures"
            )
