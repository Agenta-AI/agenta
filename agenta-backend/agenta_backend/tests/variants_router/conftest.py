import pytest
import logging

from agenta_backend.models.db_models import (
    AppDB,
    UserDB,
    VariantBaseDB,
    ImageDB,
    ConfigDB,
    AppVariantDB,
    OrganizationDB,
)

from agenta_backend.services import selectors

# Initialize logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


@pytest.fixture()
async def get_first_user_object():
    """Get the user object from the database or create a new one if not found."""

    user = await UserDB.find_one(UserDB.uid == "0")
    if user is None:
        create_user = UserDB(uid="0")
        await create_user.create()

        org = OrganizationDB(type="default", owner=str(create_user.id))
        await org.create()

        create_user.organizations.append(org.id)
        await create_user.save()

        return create_user
    return user


@pytest.fixture()
async def get_second_user_object():
    """Create a second user object."""

    user = await UserDB.find_one(UserDB.uid == "1")
    if user is None:
        create_user = UserDB(
            uid="1", username="test_user1", email="test_user1@email.com"
        )
        await create_user.create()

        org = OrganizationDB(type="default", owner=str(create_user.id))
        await org.create()

        create_user.organizations.append(org.id)
        await create_user.save()

        return create_user
    return user


@pytest.fixture()
async def get_first_user_app(get_first_user_object):
    user = await get_first_user_object
    organization = await selectors.get_user_own_org(user.uid)

    app = AppDB(app_name="myapp", organization=organization, user=user)
    await app.create()

    db_image = ImageDB(
        docker_id="sha256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        tags="agentaai/templates_v2:local_test_prompt",
        user=user,
        organization=organization,
    )
    await db_image.create()

    db_config = ConfigDB(
        config_name="default",
        parameters={},
    )
    await db_config.create()

    db_base = VariantBaseDB(
        base_name="app", image=db_image, organization=organization, user=user, app=app
    )
    await db_base.create()

    appvariant = AppVariantDB(
        app=app,
        variant_name="app",
        image=db_image,
        user=user,
        organization=organization,
        parameters={},
        base_name="app",
        config_name="default",
        base=db_base,
        config=db_config,
    )
    await appvariant.create()

    return appvariant, user, organization, app, db_image, db_config, db_base
