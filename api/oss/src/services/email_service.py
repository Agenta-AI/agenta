import asyncio
import os
import smtplib
import ssl
from email.message import EmailMessage

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
    if (env.smtp.host or env.smtp.port) and not env.smtp.from_email:
        log.warning("✗ SMTP disabled: missing sender email address")
    else:
        log.warning("✗ SMTP disabled")

if env.sendgrid.enabled:
    sg = sendgrid.SendGridAPIClient(api_key=env.sendgrid.api_key)
    log.info("✓ SendGrid enabled")
else:
    sg = None
    if env.sendgrid.api_key and not env.sendgrid.from_address:
        log.warning("✗ SendGrid disabled: missing sender email address")
    else:
        log.warning("✗ SendGrid disabled")


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
            if env.smtp.username:
                smtp.login(env.smtp.username, env.smtp.password)
            smtp.send_message(message)
    else:
        with smtplib.SMTP(
            env.smtp.host,
            env.smtp.port,
            timeout=env.smtp.timeout,
        ) as smtp:
            if env.smtp.use_tls:
                smtp.starttls(context=context)
            if env.smtp.username:
                smtp.login(env.smtp.username, env.smtp.password)
            smtp.send_message(message)

    return True


async def _send_sendgrid_email(
    to_email: str, subject: str, html_content: str, from_email: str
)->bool:
    return await asyncio.to_thread(
        _send_sendgrid_email_sync,
        to_email=to_email,
        subject=subject,
        html_content=html_content,
        from_email=from_email,
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

    try:
        sg.send(message)
        return True
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
