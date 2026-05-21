import os

from sendgrid.helpers.mail import Mail

from oss.src.utils.env import env
from oss.src.utils.lazy import _load_sendgrid
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


def _read_email_template(template_file_path: str) -> str:
    """Read an HTML email template, resolved relative to this module."""

    script_directory = os.path.dirname(os.path.abspath(__file__))
    absolute_template_file_path = os.path.join(script_directory, template_file_path)

    with open(absolute_template_file_path, "r") as template_file:
        return template_file.read()


def _render_email_template(
    *,
    username: str,
    action: str,
    workspace: str,
    call_to_action: str,
) -> str:
    """Render the shared invitation/notification email template."""

    html_template = _read_email_template("./templates/send_email.html")

    return html_template.format(
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
