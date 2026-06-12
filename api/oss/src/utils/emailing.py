import asyncio
import smtplib
import ssl
import time
from email.message import EmailMessage

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


def _get_sender_email(from_email: str | None = None) -> str:
    """Resolve sender address, preferring explicit value, then SMTP, then SendGrid."""

    sender = from_email
    if not sender and env.smtp.enabled:
        sender = env.smtp.from_email
    if not sender:
        sender = env.sendgrid.from_address
    if sender:
        return sender

    raise ValueError(
        "Email delivery requires a sender email address. "
        "Set SMTP_FROM_EMAIL, AGENTA_AUTHN_EMAIL_FROM, or "
        "AGENTA_SEND_EMAIL_FROM_ADDRESS for SMTP delivery, or "
        "SENDGRID_FROM_ADDRESS for SendGrid fallback."
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
    Render the shared email template and send it via SMTP or SendGrid.

    Prefers SMTP when configured, otherwise falls back to SendGrid. No-op
    (returns True) when neither mailer is configured. Callers that need to
    short-circuit on a disabled mailer before doing other work should still gate
    on configuration themselves.

    Returns True if the email was sent (or skipped because mailing is disabled),
    raises on a send failure or missing sender address.
    """

    html_content = _render_email_template(
        username=username,
        action=action,
        workspace=workspace,
        call_to_action=call_to_action,
    )

    sender = _get_sender_email(from_email)

    if env.smtp.enabled:
        return await _send_smtp_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            from_email=sender,
        )

    if env.sendgrid.enabled:
        return await _send_sendgrid_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            from_email=sender,
        )

    log.info(f"[EMAIL] Disabled - would send '{subject}' to {to_email}")
    return True


async def _send_smtp_email(
    *,
    to_email: str,
    subject: str,
    html_content: str,
    from_email: str,
) -> bool:
    try:
        return await asyncio.to_thread(
            _send_smtp_email_sync,
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            from_email=from_email,
        )
    except Exception:
        log.exception("Failed to send SMTP email")
        raise


def _send_smtp_email_sync(
    *,
    to_email: str,
    subject: str,
    html_content: str,
    from_email: str,
) -> bool:
    username = env.smtp.username
    password = env.smtp.password
    if bool(username) != bool(password):
        raise RuntimeError(
            "SMTP_USERNAME and SMTP_PASSWORD must be configured together"
        )

    message = EmailMessage()
    message["From"] = from_email
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(html_content, subtype="html")

    context = ssl.create_default_context()

    if env.smtp.use_ssl:
        with smtplib.SMTP_SSL(
            env.smtp.host,
            env.smtp.port,
            context=context,
            timeout=env.smtp.timeout,
        ) as smtp:
            if username and password:
                smtp.login(username, password)
            smtp.send_message(message)
    else:
        with smtplib.SMTP(
            env.smtp.host,
            env.smtp.port,
            timeout=env.smtp.timeout,
        ) as smtp:
            if env.smtp.use_tls:
                smtp.starttls(context=context)
            if username and password:
                smtp.login(username, password)
            smtp.send_message(message)

    return True


async def _send_sendgrid_email(
    *,
    to_email: str,
    subject: str,
    html_content: str,
    from_email: str,
) -> bool:
    try:
        return await asyncio.to_thread(
            _send_sendgrid_email_sync,
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            from_email=from_email,
        )
    except Exception:
        log.exception("Failed to send SendGrid email")
        raise


def _send_sendgrid_email_sync(
    *,
    to_email: str,
    subject: str,
    html_content: str,
    from_email: str,
) -> bool:
    sendgrid = _load_sendgrid()
    if sendgrid is None:
        log.info(f"[SENDGRID] Disabled - would send '{subject}' to {to_email}")
        return True

    message = Mail(
        from_email=from_email,
        to_emails=to_email,
        subject=subject,
        html_content=html_content,
    )

    sendgrid.send(message)
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
