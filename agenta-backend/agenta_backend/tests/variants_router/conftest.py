import pytest
import logging

from agenta_backend.models.db_engine import DBEngine
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

# Initialize database engine
engine = DBEngine().engine()

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


@pytest.fixture(scope="function")
async def get_first_user_object():
    """Get the user object from the database or create a new one if not found."""

    try:
        user = await engine.find_one(UserDB, UserDB.uid == "0")
        if user is None:
            create_user = UserDB(uid="0")
            await engine.save(create_user)

            org = OrganizationDB(type="default", owner=str(create_user.id))
            await engine.save(org)

            create_user.organizations.append(org.id)
            await engine.save(create_user)
            await engine.save(org)

            return create_user
        else:
            return user
    except Exception as e:
        pytest.fail(f"Failed to get or create the first user: {e}")


@pytest.fixture(scope="function")
async def get_second_user_object():
    """Create a second user object."""

    try:
        user = await engine.find_one(UserDB, UserDB.uid == "1")
        if user is None:
            create_user = UserDB(
                uid="1", username="test_user1", email="test_user1@email.com"
            )
            await engine.save(create_user)

            org = OrganizationDB(type="default", owner=str(create_user.id))
            await engine.save(org)

            create_user.organizations.append(org.id)
            await engine.save(create_user)
            await engine.save(org)

            return create_user
        else:
            return user

    except Exception as e:
        pytest.fail(f"Failed to get or create the second user: {e}")


@pytest.fixture()
async def get_first_user_app():
    user = await engine.find_one(UserDB, UserDB.uid == "0")
    if user is None:
        user = UserDB(uid="0")
        await engine.save(user)

        organization = OrganizationDB(type="default", owner=str(user.id))
        await engine.save(organization)

        user.organizations.append(organization.id)
        await engine.save(user)
        await engine.save(organization)

    organization = await selectors.get_user_own_org(user.uid)

    app = AppDB(app_name="myapp", organization=organization, user=user)
    await engine.save(app)

    db_image = ImageDB(
        docker_id="sha256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        tags="agentaai/templates:local_test_prompt",
        user=user,
        organization=organization,
    )
    await engine.save(db_image)

    db_config = ConfigDB(
        config_name="default",
        parameters={},
    )
    await engine.save(db_config)

    db_base = VariantBaseDB(
        base_name="app", image=db_image, organization=organization, user=user, app=app
    )
    await engine.save(db_base)

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
    await engine.save(appvariant)

    return appvariant, user, organization, app, db_image, db_config, db_base
