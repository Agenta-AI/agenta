import time

import httpx

from sendgrid.helpers.mail import Mail

from oss.src.utils.env import env
from oss.src.utils.lazy import _load_sendgrid
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


# Shared invitation/notification email template. Inlined (rather than a file)
# since it is tiny and avoids per-send file I/O and path resolution.
_EMAIL_TEMPLATE = (
    "<p>Hello,</p>\n"
    "<p>\n"
    "  {username_placeholder} has {action_placeholder} {workspace_placeholder} on\n"
    "  Agenta.\n"
    "</p>\n"
    "<p>{call_to_action}</p>\n"
    "<p>Thank you for using Agenta!</p>\n"
)


def _render_email_template(
    *,
    username: str,
    action: str,
    workspace: str,
    call_to_action: str,
) -> str:
    """Render the shared invitation/notification email template."""

    return _EMAIL_TEMPLATE.format(
        username_placeholder=username,
        action_placeholder=action,
        workspace_placeholder=workspace,
        call_to_action=call_to_action,
    )


async def send_email(
    *,
    to_email: str,
    subject: str,
    #
    username: str,
    action: str,
    workspace: str,
    call_to_action: str,
    #
    from_email: str = None,
) -> bool:
    """
    Render the shared email template and send it via SendGrid.

    No-op (returns True) when SendGrid is disabled or unavailable. Callers that
    need to short-circuit on a disabled mailer before doing other work should
    still gate on `env.sendgrid.enabled` themselves.

    Returns True if the email was sent (or skipped because mailing is disabled),
    raises on a send failure or missing sender address.
    """

    sg = _load_sendgrid()
    if not env.sendgrid.enabled or sg is None:
        log.info(f"[SENDGRID] Email disabled - would send '{subject}' to {to_email}")
        return True

    sender = from_email or env.sendgrid.from_address
    if not sender:
        raise ValueError("Sendgrid requires a sender email address to work.")

    html_content = _render_email_template(
        username=username,
        action=action,
        workspace=workspace,
        call_to_action=call_to_action,
    )

    message = Mail(
        from_email=sender,
        to_emails=to_email,
        subject=subject,
        html_content=html_content,
    )

    sg.send(message)

    return True


def add_contact(email: str, max_retries: int = 5, initial_delay: int = 1):
    """
    Add a contact to the Loops audience, with retry and exponential backoff.

    No-op (returns None) when Loops is disabled (no API key configured).

    Args:
        email (str): Email address of the contact to be added.
        max_retries (int): Maximum number of retries in case of rate limiting.
        initial_delay (int): Initial delay in seconds before retrying.

    Raises:
        ConnectionError: If max retries reached and unable to connect to Loops API.

    Returns:
        Optional[httpx.Response]: The Loops API response, or None when disabled.
    """

    if not env.loops.enabled:
        log.info(f"[LOOPS] Disabled - would add contact {email}")
        return None

    url = "https://app.loops.so/api/v1/contacts/create"
    headers = {"Authorization": f"Bearer {env.loops.api_key}"}
    data = {"email": email}

    retries = 0
    delay = initial_delay

    while retries < max_retries:
        response = httpx.post(url, json=data, headers=headers, timeout=20)

        # 429 indicates rate limiting; back off and retry.
        if response.status_code == 429:
            log.warning(f"[LOOPS] Rate limit hit. Retrying in {delay} seconds...")
            time.sleep(delay)
            retries += 1
            delay *= 2
        else:
            return response

    raise ConnectionError("Max retries reached. Unable to connect to Loops API.")
