import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from fastapi import HTTPException

from oss.src.utils.env import env
from oss.src.utils.logging import get_logger

log = get_logger(__name__)

# Determine which email backend to use (SMTP > SendGrid > no-op)
_USE_SMTP = env.smtp.enabled
_USE_SENDGRID = not _USE_SMTP and env.sendgrid.enabled

if _USE_SMTP:
    log.info(
        "✓ Email enabled via SMTP (%s:%s)", env.smtp.host, env.smtp.port
    )
elif _USE_SENDGRID:
    import sendgrid

    _sg = sendgrid.SendGridAPIClient(api_key=env.sendgrid.api_key)
    log.info("✓ Email enabled via SendGrid (legacy)")
else:
    _sg = None
    if env.sendgrid.api_key and not env.sendgrid.from_address:
        log.warn("✗ Email disabled: missing sender email address")
    else:
        log.warn("✗ Email disabled")


def read_email_template(template_file_path):
    """
    Function to read the HTML template from the file
    """

    # Get the absolute path to the template file
    script_directory = os.path.dirname(os.path.abspath(__file__))
    absolute_template_file_path = os.path.join(script_directory, template_file_path)

    with open(absolute_template_file_path, "r") as template_file:
        return template_file.read()


def _send_via_smtp(to_email: str, subject: str, html_content: str, from_email: str) -> None:
    """Send email using SMTP."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    msg.attach(MIMEText(html_content, "html"))

    smtp_host = env.smtp.host
    smtp_port = env.smtp.port

    if env.smtp.use_tls:
        server = smtplib.SMTP(smtp_host, smtp_port)
        server.ehlo()
        server.starttls()
        server.ehlo()
    else:
        server = smtplib.SMTP(smtp_host, smtp_port)

    try:
        if env.smtp.username and env.smtp.password:
            server.login(env.smtp.username, env.smtp.password)
        server.sendmail(from_email, [to_email], msg.as_string())
    finally:
        server.quit()


def _send_via_sendgrid(to_email: str, subject: str, html_content: str, from_email: str) -> None:
    """Send email using SendGrid (legacy fallback)."""
    from sendgrid.helpers.mail import Mail

    message = Mail(
        from_email=from_email,
        to_emails=to_email,
        subject=subject,
        html_content=html_content,
    )
    _sg.send(message)


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

    if not _USE_SMTP and not _USE_SENDGRID:
        log.info(f"[EMAIL] Email disabled - would send '{subject}' to {to_email}")
        return True

    try:
        if _USE_SMTP:
            _send_via_smtp(to_email, subject, html_content, from_email)
        else:
            _send_via_sendgrid(to_email, subject, html_content, from_email)
        return True
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
