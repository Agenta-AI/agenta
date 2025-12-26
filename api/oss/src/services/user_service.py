from sqlalchemy.future import select
from sqlalchemy.exc import NoResultFound
from supertokens_python.recipe.emailpassword.asyncio import create_reset_password_link

from oss.src.utils.env import env
from oss.src.models.db_models import UserDB
from oss.src.utils.logging import get_module_logger
from oss.src.dbs.postgres.shared.engine import engine
from oss.src.models.api.user_models import UserUpdate
from oss.src.services import db_manager, email_service

log = get_module_logger(__name__)


async def create_new_user(payload: dict) -> UserDB:
    """
    This function creates a new user.

    Args:
        payload (dict): The payload data to create the user.

    Returns:
        UserDB: The created user object.
    """

    async with engine.core_session() as session:
        user = UserDB(**payload)

        session.add(user)

        log.info(
            "[scopes] user created",
            user_id=user.id,
        )

        await session.commit()

        await session.refresh(user)

        return user


async def update_user(user_uid: str, payload: UserUpdate) -> UserDB:
    """
    This function updates the user.

    Args:
        user_uid (str): The supertokens session id of the user
        payload (UserUpdate): The payload to update the user information with

    Returns:
        UserDB: The updated user object

    Raises:
        NoResultFound: User with session id xxxx not found.
    """

    async with engine.core_session() as session:
        result = await session.execute(select(UserDB).filter_by(uid=user_uid))
        user = result.scalars().first()

        if not user:
            raise NoResultFound(f"User with session id {user_uid} not found.")

        for key, value in payload.dict(exclude_unset=True).items():
            if hasattr(user, key):
                setattr(user, key, value)

        await session.commit()
        await session.refresh(user)

        return user


async def generate_user_password_reset_link(user_id: str, admin_user_id: str):
    """
    This function generates a password reset link for a user.

    Args:
        user_id (str): The id of the user for whom the password reset link needs to be generated.
        admin_user_id (str): The id of the admin user who requested the password reset link.

    Returns:
        str: The password reset link if successful, otherwise None.
    """

    user = await db_manager.get_user_with_id(user_id=user_id)
    admin_user = await db_manager.get_user_with_id(user_id=admin_user_id)

    password_reset_link = await create_reset_password_link(
        tenant_id="public",
        user_id=str(user.uid),
        email=user.email,
    )

    if not env.sendgrid.api_key:
        return password_reset_link

    html_template = email_service.read_email_template("./templates/send_email.html")
    html_content = html_template.format(
        username_placeholder=admin_user.username,
        action_placeholder="requested a password reset for you in their workspace",
        workspace_placeholder="",
        call_to_action=f"""<p>Click the link below to reset your password:</p><br><a href="{password_reset_link}">Reset Password</a>""",
    )

    if not env.sendgrid.from_address:
        raise ValueError("Sendgrid requires a sender email address to work.")

    await email_service.send_email(
        from_email=env.sendgrid.from_address,
        to_email=user.email,
        subject=f"{admin_user.username} requested a password reset for you in their workspace",
        html_content=html_content,
    )
