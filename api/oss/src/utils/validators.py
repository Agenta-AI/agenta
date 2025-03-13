from re import fullmatch

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
