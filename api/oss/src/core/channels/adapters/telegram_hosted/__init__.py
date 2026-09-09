# The HostedTelegramAdapter is built alongside the ingress hosted-resolve seam
# (its verify_signature and connection_locator contract is defined by that
# flow). Until then this package exposes only the capability declaration.
from oss.src.core.channels.adapters.telegram_hosted.capabilities import (
    fetch_telegram_hosted_capabilities,
)

__all__ = ["fetch_telegram_hosted_capabilities"]
