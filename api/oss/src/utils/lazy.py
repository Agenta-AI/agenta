from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    import stripe
    import posthog
    from sendgrid import SendGridAPIClient


_stripe_module: Optional["stripe"] = None
_stripe_checked = False

_posthog_module: Optional["posthog"] = None
_posthog_checked = False

_sendgrid_client: Optional["SendGridAPIClient"] = None
_sendgrid_checked = False


def _load_stripe() -> Optional["stripe"]:
    global _stripe_module, _stripe_checked

    if _stripe_checked:
        return _stripe_module

    _stripe_checked = True
    try:
        import stripe as _stripe
        from oss.src.utils.env import env
        from oss.src.utils.logging import get_module_logger

        log = get_module_logger(__name__)

        if env.stripe.enabled:
            _stripe.api_key = env.stripe.api_key
            log.info("✓ Stripe enabled:", target=env.stripe.webhook_target)

        _stripe_module = _stripe
    except Exception:
        _stripe_module = None

    return _stripe_module


def _load_posthog() -> Optional["posthog"]:
    global _posthog_module, _posthog_checked

    if _posthog_checked:
        return _posthog_module

    _posthog_checked = True
    try:
        import posthog as _posthog
        from oss.src.utils.env import env
        from oss.src.utils.logging import get_module_logger

        log = get_module_logger(__name__)

        if env.posthog.enabled:
            _posthog.api_key = env.posthog.api_key
            _posthog.host = env.posthog.api_url
            log.info("✓ PostHog enabled")
        else:
            log.warn("✗ PostHog disabled")

        _posthog_module = _posthog
    except Exception:
        _posthog_module = None

    return _posthog_module


def _load_sendgrid() -> Optional["SendGridAPIClient"]:
    global _sendgrid_client, _sendgrid_checked

    if _sendgrid_checked:
        return _sendgrid_client

    _sendgrid_checked = True
    try:
        import sendgrid
        from oss.src.utils.env import env
        from oss.src.utils.logging import get_module_logger

        log = get_module_logger(__name__)

        if env.sendgrid.enabled:
            _sendgrid_client = sendgrid.SendGridAPIClient(api_key=env.sendgrid.api_key)
            log.info("✓ SendGrid enabled")
        elif env.sendgrid.api_key and not env.sendgrid.from_address:
            log.warn("✗ SendGrid disabled: missing sender email address")
        else:
            log.warn("✗ SendGrid disabled")
    except Exception:
        _sendgrid_client = None

    return _sendgrid_client
