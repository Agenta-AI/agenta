from typing import Any, Dict

from supertokens_python.recipe.passwordless.types import (
    EmailDeliveryOverrideInput,
    EmailTemplateVars,
)

from oss.src.core.emails.branded import (
    TEXT_FOOTER,
    BrandedEmail,
    Detail,
    code_block,
    details_block,
    details_text,
    note_block,
    render_layout,
    send_branded_email,
)
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


OTP_EMAIL_SUBJECT = "Your Agenta sign-in code"
_DESCRIPTION = "Enter this code in your browser to finish signing in to Agenta."
_NOTE = "Did not ask for this code? Ignore this email. No one can sign in without it."


def _humanize_duration(milliseconds: int) -> str:
    minutes = max(1, round(milliseconds / 60_000))
    if minutes % 60 == 0:
        value, unit = minutes // 60, "hour"
    else:
        value, unit = minutes, "minute"
    return f"{value} {unit}" if value == 1 else f"{value} {unit}s"


def render_otp_email(
    *,
    code: str,
    email: str,
    code_life_time_ms: int,
) -> BrandedEmail:
    expires_in = _humanize_duration(code_life_time_ms)
    details = [
        Detail("EXPIRES IN", expires_in),
        Detail("REQUESTED FOR", email, is_email=True),
    ]

    html = render_layout(
        subject=OTP_EMAIL_SUBJECT,
        preheader=f"This code expires in {expires_in}.",
        headline="Your sign-in code",
        description=_DESCRIPTION,
        blocks=[
            code_block(code=code),
            details_block(items=details),
            note_block(note=_NOTE),
        ],
    )
    text = (
        f"Your sign-in code\n\n{_DESCRIPTION}\n\n{code}\n\n"
        f"{details_text(items=details)}\n\n{_NOTE}\n\n{TEXT_FOOTER}"
    )
    return BrandedEmail(subject=OTP_EMAIL_SUBJECT, html=html, text=text)


def override_passwordless_email_delivery(
    original_implementation: EmailDeliveryOverrideInput,
) -> EmailDeliveryOverrideInput:
    original_send_email = original_implementation.send_email

    async def send_email(
        template_vars: EmailTemplateVars,
        user_context: Dict[str, Any],
    ) -> None:
        code = template_vars.user_input_code
        if not code or not (env.smtp.enabled or env.sendgrid.enabled):
            return await original_send_email(template_vars, user_context)

        try:
            sent = await send_branded_email(
                to_email=template_vars.email,
                email=render_otp_email(
                    code=code,
                    email=template_vars.email,
                    code_life_time_ms=template_vars.code_life_time,
                ),
            )
        except Exception as exc:
            # Mailer errors are logged with a traceback already; never log the code.
            log.warning(
                f"[AUTH] Sign-in code email failed ({type(exc).__name__}), "
                "using SuperTokens delivery"
            )
            sent = False

        if not sent:
            await original_send_email(template_vars, user_context)

    original_implementation.send_email = send_email  # type: ignore
    return original_implementation
