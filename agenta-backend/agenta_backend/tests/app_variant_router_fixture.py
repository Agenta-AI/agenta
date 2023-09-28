import pytest
import asyncio
import logging
from bson import ObjectId
from datetime import datetime

from agenta_backend.models.db_engine import DBEngine
from agenta_backend.models.db_models import (
    AppDB,
    UserDB,
    BaseDB,
    ImageDB,
    ConfigDB,
    AppVariantDB,
    OrganizationDB,
)

from agenta_backend.services import new_db_manager

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
    """Create a secind user object."""

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


@pytest.fixture(scope="function")
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

    organization = await new_db_manager.get_user_own_org(user.uid)

    app = AppDB(app_name="myapp", organization_id=organization, user_id=user)
    await engine.save(app)

    db_image = ImageDB(
        docker_id="sha256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        tags="agentaai/templates:local_test_prompt",
        user_id=user,
        organization_id=organization,
    )
    await engine.save(db_image)

    db_config = ConfigDB(
        config_name="default",
        parameters={},
    )
    await engine.save(db_config)

    db_base = BaseDB(
        base_name="app",
        image_id=db_image,
    )
    await engine.save(db_base)

    appvariant = AppVariantDB(
        app_id=app,
        variant_name="app",
        image_id=db_image,
        user_id=user,
        organization_id=organization,
        parameters={},
        base_name="app",
        config_name="default",
        base_id=db_base,
        config_id=db_config,
    )
    await engine.save(appvariant)

    return appvariant, user, organization, app, db_image, db_config, db_base
