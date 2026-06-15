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
        from oss.src.utils.env import env
        from oss.src.utils.logging import get_module_logger

        log = get_module_logger(__name__)

        # Gate on "enabled" here so the return value means "a usable, configured
        # Stripe module": None signals "not available" (disabled OR import/config
        # failure), and callers need a single `if stripe is None` check.
        if not env.stripe.enabled:
            log.warn("✗ Stripe disabled")
            _stripe_module = None
            return _stripe_module

        import stripe as _stripe

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
        from oss.src.utils.env import env
        from oss.src.utils.logging import get_module_logger

        log = get_module_logger(__name__)

        # Gate on "enabled" here so the return value means "a usable, configured
        # PostHog module": None signals "not available" (disabled OR import/config
        # failure), and callers need a single `if posthog is None` check.
        if not env.posthog.enabled:
            log.warn("✗ PostHog disabled")
            _posthog_module = None
            return _posthog_module

        import posthog as _posthog

        _posthog.api_key = env.posthog.api_key
        _posthog.host = env.posthog.api_url
        log.info("✓ PostHog enabled")

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
        from oss.src.utils.env import env
        from oss.src.utils.logging import get_module_logger

        log = get_module_logger(__name__)

        # Gate on "enabled" here so the return value means "a usable, configured
        # SendGrid client": None signals "not available" (disabled OR import/config
        # failure), and callers need a single `if sg is None` check.
        if not env.sendgrid.enabled:
            if env.sendgrid.api_key and not env.sendgrid.from_email:
                log.warn("✗ SendGrid disabled: missing sender email address")
            else:
                log.warn("✗ SendGrid disabled")
            _sendgrid_client = None
            return _sendgrid_client

        import sendgrid

        _sendgrid_client = sendgrid.SendGridAPIClient(api_key=env.sendgrid.api_key)
        log.info("✓ SendGrid enabled")
    except Exception:
        _sendgrid_client = None

    return _sendgrid_client
