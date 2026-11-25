"""Whether this install is Agenta cloud: a valid license key with plan `cloud` in
`AGENTA_LICENSE_KEY`.

Every "is this cloud" check calls `is_cloud()`. Stripe is only billing: a Stripe key does
not make an install cloud, and losing it does not make cloud self-hosted. A cloud key
counts only from the environment, never from a key added in the app.
"""

from functools import lru_cache

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

from ee.src.core.licenses.types import CLOUD_PLAN, InvalidLicenseKey

log = get_module_logger(__name__)


@lru_cache(maxsize=1)
def is_cloud() -> bool:
    """Read once per process: a cloud key that expires mid-run keeps the process cloud,
    and the next start refuses to run (see `validate_cloud_license`)."""
    if not env.license.key:
        return False

    # Imported here: `keys` reads the plan table, whose build calls `is_cloud()`.
    from ee.src.core.licenses.keys import parse_license_key  # noqa: PLC0415

    try:
        license_key = parse_license_key(env.license.key)
    except InvalidLicenseKey:
        return False
    return license_key.plan == CLOUD_PLAN and not license_key.is_expired()


def validate_cloud_license() -> None:
    """Fails startup when the cloud key and the Stripe key disagree.

    A cloud key needs Stripe to bill. A Stripe key without a cloud key is the deploy
    that forgot `AGENTA_LICENSE_KEY`: running would move every paying organization to
    the self-hosted plans.
    """
    cloud = is_cloud()
    if cloud and not env.stripe.enabled:
        message = (
            "AGENTA_LICENSE_KEY is a cloud license key, but STRIPE_API_KEY is not set. "
            "Cloud needs Stripe for billing. Set STRIPE_API_KEY, or use a license key "
            "that is not a cloud key."
        )
    elif env.stripe.enabled and not cloud:
        message = (
            "STRIPE_API_KEY is set, but AGENTA_LICENSE_KEY is not a valid cloud license "
            "key. A cloud install needs its cloud license key; without it every "
            "organization would fall back to the self-hosted plans. Set "
            "AGENTA_LICENSE_KEY to the cloud key, or remove STRIPE_API_KEY on a "
            "self-hosted install."
        )
    else:
        return

    log.error("[licenses] %s", message)
    raise RuntimeError(message)
