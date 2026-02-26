"""Webhook dispatcher — asyncio side of the delivery pipeline.

Reads grouped EventMessages (already parsed by the events worker), finds
matching active subscriptions for each project (from cache or Postgres),
and enqueues one TaskIQ delivery task per (event, subscription) pair.

The dispatcher is intentionally self-contained so it can be extracted into
its own consumer process later without changing its internal logic.
"""

from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from oss.src.core.secrets.services import VaultService
from oss.src.core.webhooks.dtos import (
    WebhookSubscription,
    WebhookSubscriptionQuery,
    WebhookSubscriptionQueryFlags,
)
from oss.src.core.webhooks.interfaces import WebhooksDAOInterface
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.utils.caching import get_cache, set_cache, AGENTA_CACHE_TTL
from oss.src.utils.crypting import decrypt, encrypt
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

# EventKey matches the type used in EventsWorker.process_batch
EventKey = Tuple[Optional[UUID], UUID]


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
        deliver_task: Any,
    ):
        self.subscriptions_dao = subscriptions_dao
        self.deliver_task = deliver_task

    # --- internal helpers ---------------------------------------------------- #

    async def _resolve_secret(
        self,
        *,
        project_id: UUID,
        secret_id: UUID,
    ) -> Optional[str]:
        try:
            vault_service = VaultService(SecretsDAO())
            secret_dto = await vault_service.get_secret(
                secret_id=secret_id,
                project_id=project_id,
            )
            data = secret_dto.data if secret_dto else None
            provider = getattr(data, "provider", None) or (
                data.get("provider") if isinstance(data, dict) else None
            )
            if isinstance(provider, dict):
                return provider.get("key")
            return getattr(provider, "key", None)
        except Exception as e:
            log.warning(
                f"[WEBHOOKS DISPATCHER] Failed to resolve secret {secret_id}: {e}"
            )
            return None

    async def _get_subscriptions(
        self,
        project_id: UUID,
    ) -> List[WebhookSubscription]:
        """Return active subscriptions for the project, with secrets resolved.

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
                flags=WebhookSubscriptionQueryFlags(is_active=True),
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
        messages_by_key: Dict[EventKey, list],
    ) -> None:
        """Fan out TaskIQ delivery tasks for all (event, subscription) matches."""
        for (_, project_id), msgs in messages_by_key.items():
            try:
                subscriptions = await self._get_subscriptions(project_id)
            except Exception as e:
                log.error(
                    f"[WEBHOOKS DISPATCHER] Failed to load subscriptions "
                    f"for project {project_id}: {e}"
                )
                continue

            for msg in msgs:
                event = msg.event
                event_type = str(event.event_type)

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
                        await self.deliver_task.kiq(
                            project_id=str(project_id),
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
                            f"event={event.event_id} subscription={sub.id}"
                        )
                    except Exception as e:
                        log.error(
                            f"[WEBHOOKS DISPATCHER] Failed to enqueue delivery "
                            f"for subscription {sub.id}: {e}"
                        )
