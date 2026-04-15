from re import fullmatch
from typing import Optional

from oss.src.services.db_manager import get_user_with_email


async def validate_user_email_or_username(value: str, tenant_id: str):
    # first we check for if it's an email
    if (
        fullmatch(
            r'^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$',
            value,
        )
        is not None
    ):
        return None

    # since it's not an email, we check for if it's a correct username
    if len(value) < 3:
        return "Usernames must be at least 3 characters long."

    if fullmatch(r"^[a-z0-9_-]+$", value) is None:
        return (
            "Username must contain only alphanumeric, underscore or hyphen characters."
        )

    return None


async def validate_actual_email(value: str, tenant_id: str):
    if (
        fullmatch(
            r'^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$',
            value,
        )
        is None
    ):
        return "Email is invalid"

    user = await get_user_with_email(email=value)
    if user is not None:
        return "Email already in use. Please sign in, or use another email"


def is_input_email(email: str):
    return (
        fullmatch(
            r'^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$',
            email,
        )
        is not None
    )


_SPECIAL_CHARS = frozenset('!@#$%^&*()_+-=[]{}|;\':",./<>?')


async def validate_password(value: str, tenant_id: str) -> Optional[str]:
    """Validate a password against the configured SuperTokens password policy.

    Resolution order:
    1. If ``SUPERTOKENS_PASSWORD_REGEX`` is set, the password must fully match
       that regex — all other checks are skipped.
    2. If ``SUPERTOKENS_PASSWORD_POLICY`` is ``"none"``, no validation is
       performed (SuperTokens Core defaults apply).
    3. ``"basic"``  — enforce min/max length only.
    4. ``"strong"`` — basic + at least one uppercase letter, one digit, and
       one special character.
    """
    from oss.src.utils.env import env  # local import avoids circular dependency

    cfg = env.supertokens

    # Custom regex takes precedence over everything else.
    if cfg.password_regex:
        if fullmatch(cfg.password_regex, value) is None:
            return "Password does not meet the required format."
        return None

    policy = (cfg.password_policy or "basic").lower()

    if policy == "none":
        return None

    # Min length (applies to "basic" and "strong").
    if len(value) < cfg.password_min_length:
        return f"Password must be at least {cfg.password_min_length} characters long."

    # Max length.
    if cfg.password_max_length is not None and len(value) > cfg.password_max_length:
        return f"Password must be at most {cfg.password_max_length} characters long."

    if policy == "strong":
        if not any(c.isupper() for c in value):
            return "Password must contain at least one uppercase letter."
        if not any(c.isdigit() for c in value):
            return "Password must contain at least one digit."
        if not any(c in _SPECIAL_CHARS for c in value):
            return (
                "Password must contain at least one special character (!@#$%^&* etc.)."
            )

    return None
