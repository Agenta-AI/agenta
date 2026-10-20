import asyncio
import base64
import smtplib
import ssl
import time
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from typing import Sequence

import httpx

from sendgrid.helpers.mail import (
    Attachment,
    ContentId,
    Disposition,
    FileContent,
    FileName,
    FileType,
    Mail,
)

from oss.src.utils.env import env
from oss.src.utils.lazy import _load_sendgrid
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


@dataclass(frozen=True)
class InlineImage:
    """A PNG embedded in the message and referenced from the HTML as `cid:<cid>`."""

    cid: str
    filename: str
    content: bytes


def _get_sender_email(from_email: str | None = None) -> str:
    """Resolve sender address, preferring explicit value, then SMTP, then SendGrid."""

    sender = from_email
    if not sender and env.smtp.enabled:
        sender = env.smtp.from_email
    if not sender:
        sender = env.sendgrid.from_email
    if sender:
        return sender

    raise ValueError(
        "Email delivery requires a sender email address. "
        "Set SMTP_FROM_EMAIL, AGENTA_AUTHN_EMAIL_FROM, or "
        "AGENTA_SEND_EMAIL_FROM_ADDRESS for SMTP delivery, or "
        "SENDGRID_FROM_EMAIL (or legacy SENDGRID_FROM_ADDRESS) for SendGrid fallback."
    )


def _with_display_name(sender: str, name: str | None) -> str:
    current_name, address = parseaddr(sender)
    if not name or current_name or not address:
        return sender
    return formataddr((name, address))


async def send_html_email(
    *,
    to_email: str,
    subject: str,
    html_content: str,
    #
    text_content: str | None = None,
    inline_images: Sequence[InlineImage] = (),
    from_email: str | None = None,
    from_name: str | None = None,
) -> bool:
    """
    Send pre-rendered HTML via SMTP, else SendGrid. Returns True when sent, or when no
    mailer is configured (no-op); False when SendGrid is configured but unusable.
    Raises on a send failure or a missing sender. `from_name` applies only when the
    sender has no display name.
    """

    sender = _with_display_name(_get_sender_email(from_email), from_name)

    if env.smtp.enabled:
        return await _send_smtp_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content,
            inline_images=inline_images,
            from_email=sender,
        )

    if env.sendgrid.enabled:
        return await _send_sendgrid_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content,
            inline_images=inline_images,
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
    text_content: str | None = None,
    inline_images: Sequence[InlineImage] = (),
) -> bool:
    try:
        return await asyncio.to_thread(
            _send_smtp_email_sync,
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content,
            inline_images=inline_images,
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
    text_content: str | None = None,
    inline_images: Sequence[InlineImage] = (),
) -> bool:
    username = env.smtp.username
    password = env.smtp.password
    if bool(username) != bool(password):
        raise RuntimeError(
            "SMTP_USERNAME and SMTP_PASSWORD must be configured together"
        )

    message = _build_smtp_message(
        to_email=to_email,
        subject=subject,
        html_content=html_content,
        from_email=from_email,
        text_content=text_content,
        inline_images=inline_images,
    )

    context = ssl.create_default_context()

    if env.smtp.use_ssl:
        client = smtplib.SMTP_SSL(
            env.smtp.host,
            env.smtp.port,
            context=context,
            timeout=env.smtp.timeout,
        )
    else:
        client = smtplib.SMTP(
            env.smtp.host,
            env.smtp.port,
            timeout=env.smtp.timeout,
        )

    sent = False
    try:
        with client as smtp:
            if not env.smtp.use_ssl and env.smtp.use_tls:
                smtp.starttls(context=context)
            if username and password:
                smtp.login(username, password)
            smtp.send_message(message)
            sent = True
    except (smtplib.SMTPException, OSError):
        # Only QUIT failed: the server already accepted the message.
        if not sent:
            raise
        log.warning("[EMAIL] SMTP QUIT failed after the message was accepted")

    return True


def _build_smtp_message(
    *,
    to_email: str,
    subject: str,
    html_content: str,
    from_email: str,
    text_content: str | None = None,
    inline_images: Sequence[InlineImage] = (),
) -> EmailMessage:
    message = EmailMessage()
    message["From"] = from_email
    message["To"] = to_email
    message["Subject"] = subject
    if text_content:
        message.set_content(text_content)
        message.add_alternative(html_content, subtype="html")
        html_part = message.get_payload()[-1]
    else:
        message.set_content(html_content, subtype="html")
        html_part = message

    for image in inline_images:
        html_part.add_related(
            image.content,
            maintype="image",
            subtype="png",
            cid=f"<{image.cid}>",
            filename=image.filename,
            disposition="inline",
        )

    return message


async def _send_sendgrid_email(
    *,
    to_email: str,
    subject: str,
    html_content: str,
    from_email: str,
    text_content: str | None = None,
    inline_images: Sequence[InlineImage] = (),
) -> bool:
    try:
        return await asyncio.to_thread(
            _send_sendgrid_email_sync,
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content,
            inline_images=inline_images,
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
    text_content: str | None = None,
    inline_images: Sequence[InlineImage] = (),
) -> bool:
    sendgrid = _load_sendgrid()
    if sendgrid is None:
        log.info(f"[SENDGRID] Disabled - would send '{subject}' to {to_email}")
        return False

    message = Mail(
        from_email=from_email,
        to_emails=to_email,
        subject=subject,
        plain_text_content=text_content,
        html_content=html_content,
    )
    for image in inline_images:
        message.add_attachment(
            Attachment(
                FileContent(base64.b64encode(image.content).decode()),
                FileName(image.filename),
                FileType("image/png"),
                Disposition("inline"),
                ContentId(image.cid),
            )
        )

    sendgrid.send(message)
    return True


def add_contact(
    email: str,
    max_retries: int = 5,
    initial_delay: int = 1,
):
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


async def remove_contact(
    email: str,
    max_retries: int = 5,
    initial_delay: int = 1,
) -> httpx.Response | None:
    """
    Remove a contact from the Loops audience, with retry and exponential backoff.

    No-op (returns None) when Loops is disabled (no API key configured). Returns the
    raw response for any non-429 status (including 404 if contact already gone).

    Args:
        email (str): Email address of the contact to be removed.
        max_retries (int): Maximum number of retries in case of rate limiting.
        initial_delay (int): Initial delay in seconds before retrying.

    Raises:
        ConnectionError: If max retries reached and unable to connect to Loops API.

    Returns:
        httpx.Response | None: The Loops API response, or None when disabled.
    """

    if not env.loops.enabled:
        log.info(f"[LOOPS] Disabled - would delete contact {email}")
        return None

    url = "https://app.loops.so/api/v1/contacts/delete"
    headers = {"Authorization": f"Bearer {env.loops.api_key}"}
    data = {"email": email}

    retries = 0
    delay = initial_delay

    async with httpx.AsyncClient(timeout=20) as client:
        while retries < max_retries:
            response = await client.post(url, json=data, headers=headers)

            # 429 indicates rate limiting; back off and retry.
            if response.status_code == 429:
                log.warning(f"[LOOPS] Rate limit hit. Retrying in {delay} seconds...")
                await asyncio.sleep(delay)
                retries += 1
                delay *= 2
            else:
                return response

    raise ConnectionError("Max retries reached. Unable to connect to Loops API.")
