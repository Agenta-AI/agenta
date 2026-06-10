import asyncio
import os
import smtplib
import ssl
from email.message import EmailMessage
from functools import lru_cache

import sendgrid
from sendgrid.helpers.mail import Mail

from fastapi import HTTPException

from oss.src.utils.env import env
from oss.src.utils.logging import get_logger

log = get_logger(__name__)

# Initialize email providers only if enabled
if env.smtp.enabled:
    log.info("✓ SMTP email enabled")
else:
    smtp_configuration = {
        "SMTP_HOST": env.smtp.host,
        "SMTP_PORT": env.smtp.port,
        "SMTP_FROM_EMAIL": env.smtp.from_email,
    }
    if any(smtp_configuration.values()):
        missing_fields = [
            field for field, value in smtp_configuration.items() if not value
        ]
        log.warning(
            "✗ SMTP disabled: missing required configuration: %s",
            ", ".join(missing_fields),
        )
    else:
        log.info("✗ SMTP disabled")

if env.sendgrid.enabled:
    log.info("✓ SendGrid enabled")
else:
    if env.sendgrid.api_key and not env.sendgrid.from_address:
        log.warning("✗ SendGrid disabled: missing sender email address")
    else:
        log.info("✗ SendGrid disabled")


def get_configured_from_email() -> str:
    """Return the configured sender email for SMTP or SendGrid delivery."""
    from_email = env.smtp.from_email if env.smtp.enabled else env.sendgrid.from_address
    if from_email:
        return from_email

    raise ValueError(
        "Email delivery requires a sender email address. "
        "Set SMTP_FROM_EMAIL, AGENTA_AUTHN_EMAIL_FROM, or "
        "AGENTA_SEND_EMAIL_FROM_ADDRESS for SMTP delivery, or "
        "SENDGRID_FROM_ADDRESS for SendGrid fallback."
    )


def read_email_template(template_file_path):
    """
    Function to read the HTML template from the file
    """

    # Get the absolute path to the template file
    script_directory = os.path.dirname(os.path.abspath(__file__))
    absolute_template_file_path = os.path.join(script_directory, template_file_path)

    with open(absolute_template_file_path, "r") as template_file:
        return template_file.read()


async def send_email(
    to_email: str, subject: str, html_content: str, from_email: str
) -> bool:
    """
    Send an email to a user.

    Args:
        to_email (str): The email address to send the email to.
        subject (str): The subject of the email.
        html_content (str): The HTML content of the email.
        from_email (str): The email address to send the email from.

    Returns:
        bool: True if the email was sent successfully, False otherwise.

    Raises:
        HTTPException: If there is an error sending the email.
    """

    if env.smtp.enabled:
        return await _send_smtp_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            from_email=from_email,
        )

    if env.sendgrid.enabled:
        return await _send_sendgrid_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            from_email=from_email,
        )

    log.info("[EMAIL] Email disabled - skipping email send")
    return True


async def _send_smtp_email(
    to_email: str, subject: str, html_content: str, from_email: str
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
        raise HTTPException(
            status_code=500,
            detail="Failed to send email",
        )


def _send_smtp_email_sync(
    to_email: str, subject: str, html_content: str, from_email: str
) -> bool:
    username = env.smtp.username
    password = env.smtp.password
    if bool(username) != bool(password):
        raise RuntimeError(
            "SMTP_USERNAME and SMTP_PASSWORD must be configured together"
        )

    message = EmailMessage()
    message["From"] = from_email or env.smtp.from_email
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
    to_email: str, subject: str, html_content: str, from_email: str
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
        raise HTTPException(
            status_code=500,
            detail="Failed to send email",
        )


def _send_sendgrid_email_sync(
    to_email: str, subject: str, html_content: str, from_email: str
) -> bool:
    message = Mail(
        from_email=from_email,
        to_emails=to_email,
        subject=subject,
        html_content=html_content,
    )

    api_key = env.sendgrid.api_key
    if not api_key:
        raise RuntimeError("SENDGRID_API_KEY must be configured")

    sg = _get_sendgrid_client(api_key)
    sg.send(message)
    return True


@lru_cache(maxsize=1)
def _get_sendgrid_client(api_key: str) -> sendgrid.SendGridAPIClient:
    return sendgrid.SendGridAPIClient(api_key=api_key)
