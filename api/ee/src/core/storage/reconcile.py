"""Periodic reconcile job: reads authoritative storage size for all orgs, corrects gauge."""

from typing import Optional, Callable, Awaitable

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


async def run_storage_reconcile(
    *,
    renew: Optional[Callable[[], Awaitable[bool]]] = None,
) -> None:
    """Iterate over all active orgs and reconcile their storage gauge.

    Gated on is_ee() + env.agenta.storage.reconcile_enabled.
    """
    from oss.src.utils.common import is_ee
    from oss.src.utils.env import env

    if not is_ee():
        log.debug("[storage] reconcile skipped (not EE)")
        return

    if not env.agenta.storage.reconcile_enabled:
        log.debug(
            "[storage] reconcile skipped (AGENTA_STORAGE_RECONCILE_ENABLED not set)"
        )
        return

    if not env.agenta.storage.enabled:
        log.debug("[storage] reconcile skipped (no storage provider configured)")
        return

    try:
        from ee.src.dbs.postgres.subscriptions.dao import SubscriptionsDAO

        dao = SubscriptionsDAO()
        subscriptions = await dao.list_active()
    except Exception:
        log.error("[storage] failed to list active subscriptions", exc_info=True)
        return

    from ee.src.core.storage.service import reconcile_org_storage

    for sub in subscriptions:
        try:
            org_id = sub.organization_id
            if org_id is None:
                continue
            await reconcile_org_storage(org_id=org_id)
        except Exception:
            log.warning(
                "[storage] reconcile failed for org=%s",
                getattr(sub, "organization_id", "?"),
                exc_info=True,
            )

        if renew:
            try:
                ok = await renew()
                if not ok:
                    log.error("[storage] lock renewal rejected; stopping reconcile")
                    return
            except Exception:
                log.error(
                    "[storage] lock renewal error; stopping reconcile", exc_info=True
                )
                return
