"""Main Business logic"""

from urllib.parse import urlparse
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from oss.src.utils.env import env
from oss.src.utils.common import is_ee
from oss.src.services import db_manager
from oss.src.models.shared_models import AppType
from oss.src.utils.logging import get_module_logger
from oss.src.models.db_models import AppVariantDB, AppDB

if is_ee():
    pass

log = get_module_logger(__name__)

AGENTA_SERVICES_URL = env.agenta.services_url


async def update_last_modified_by(
    user_uid: str, object_id: str, object_type: str, project_id: str
) -> None:
    """Updates the last_modified_by field in the app variant table.

    Args:
        object_id (str): The object ID to update.
        object_type (str): The type of object to update.
        user_uid (str): The user UID to update.
        project_id (str): The project ID.
    """

    async def get_appdb_str_by_id(object_id: str, object_type: str) -> str:
        if object_type == "app":
            return object_id
        elif object_type == "variant":
            app_variant_db = await db_manager.fetch_app_variant_by_id(object_id)
            if app_variant_db is None:
                raise db_manager.NoResultFound(f"Variant with id {object_id} not found")
            return str(app_variant_db.app_id)
        elif object_type == "evaluation":
            evaluation_db = await db_manager.fetch_evaluation_by_id(
                project_id=project_id,
                evaluation_id=object_id,
            )
            if evaluation_db is None:
                raise db_manager.NoResultFound(
                    f"Evaluation with id {object_id} not found"
                )
            return str(evaluation_db.app_id)
        else:
            raise ValueError(
                f"Could not update last_modified_by application information. Unsupported type: {object_type}"
            )

    user = await db_manager.get_user_with_id(user_id=user_uid)
    app_id = await get_appdb_str_by_id(object_id=object_id, object_type=object_type)
    assert app_id is not None, f"app_id in {object_type} cannot be None"
    await db_manager.update_app(
        app_id=app_id,
        values_to_update={
            "modified_by_id": user.id,
            "updated_at": datetime.now(timezone.utc),
        },
    )


async def update_variant_url(
    app_variant_db: AppVariantDB,
    project_id: str,
    url: str,
    user_uid: str,
    commit_message: Optional[str] = None,
):
    """Updates the URL for app variant in the database.

    Arguments:
        app_variant (AppVariantDB): the app variant to update
        project_id (str): The ID of the project
        url (str): the URL to update
        user_uid (str): The ID of the user updating the URL
        commit_message (str, optional): The commit message for the update. Defaults to None.
    """

    parsed_url = urlparse(url).geturl()

    base = await db_manager.fetch_base_by_id(str(app_variant_db.base_id))
    deployment = await db_manager.get_deployment_by_id(str(base.deployment_id))

    await db_manager.remove_deployment(str(deployment.id))

    await db_manager.update_variant_parameters(
        str(app_variant_db.id),
        parameters={},
        project_id=project_id,
        user_uid=user_uid,
        commit_message=commit_message,
    )

    app_variant_db = await db_manager.update_app_variant(
        app_variant_id=str(app_variant_db.id), url=parsed_url
    )

    deployment = await db_manager.create_deployment(
        app_id=str(app_variant_db.app.id),
        project_id=project_id,
        uri=parsed_url,
    )

    await db_manager.update_base(
        str(app_variant_db.base_id),
        deployment_id=deployment.id,
    )

    return {"uri": deployment.uri}


async def terminate_and_remove_app_variant(
    project_id: str,
    app_variant_id: Optional[str] = None,
    app_variant_db: Optional[AppVariantDB] = None,
) -> None:
    """
    Removes app variant from the database.

    Args:
        project_id (str): The ID of the project
        variant_id (srt): The app variant to remove.

    Raises:
        ValueError: If the app variant is not found in the database.
        Exception: Any other exception raised during the operation.
    """

    assert app_variant_id or app_variant_db, (
        "Either app_variant_id or app_variant_db must be provided"
    )
    assert not (app_variant_id and app_variant_db), (
        "Only one of app_variant_id or app_variant_db must be provided"
    )

    if app_variant_id:
        app_variant_db = await db_manager.fetch_app_variant_by_id(app_variant_id)

    if app_variant_db is None:
        error_msg = f"Failed to delete app variant {app_variant_id}: Not found in DB."
        log.error(error_msg)
        raise ValueError(error_msg)

    try:
        await db_manager.remove_app_variant_from_db(app_variant_db, project_id)

    except Exception as e:
        log.error(
            f"An error occurred while deleting app variant {app_variant_db.app.app_name}/{app_variant_db.variant_name}: {str(e)}"
        )
        raise e from None


async def remove_app_related_resources(app_id: str, project_id: str):
    """Removes associated tables with an app after its deletion.

    When an app or its last variant is deleted, this function ensures that
    all related resources such as environments and testsets are also deleted.

    Args:
        app_name (str): The name of the app whose associated resources are to be removed.
        project_id (str: The ID of the project)
    """

    try:
        await db_manager.remove_app_by_id(app_id, project_id)
    except Exception as e:
        log.error(
            f"An error occurred while cleaning up resources for app {app_id}: {str(e)}"
        )
        raise e from None


async def remove_app(app: AppDB):
    """Removes all app variants from db

    Args:
        app (AppDB): The application instance to remove from database.
    """

    if app is None:
        error_msg = f"Failed to delete app {app.id}: Not found in DB."
        log.error(error_msg)
        raise ValueError(error_msg)

    app_variants = await db_manager.list_app_variants(str(app.id))

    try:
        for app_variant_db in app_variants:
            await terminate_and_remove_app_variant(
                project_id=str(app_variant_db.project_id), app_variant_db=app_variant_db
            )

        app_variants = await db_manager.list_app_variants(str(app.id))

        if len(app_variants) == 0:
            await remove_app_related_resources(str(app.id), str(app.project_id))

    except Exception:
        # Failsafe: in case something went wrong,
        # delete app and its related resources
        try:
            await remove_app_related_resources(str(app.id), str(app.project_id))
        except Exception as e:
            log.error(
                f"An error occurred while deleting app {app.id} and its associated resources: {str(e)}"
            )
            raise e


async def update_variant_parameters(
    app_variant_id: str,
    parameters: Dict[str, Any],
    user_uid: str,
    project_id: str,
    commit_message: Optional[str] = None,
):
    """Updates the parameters for app variant in the database.

    Arguments:
        app_variant (str): The app variant to update
        parameters (dict): The parameters to update
        user_uid (str): The UID of the user
        project_id (str): The ID of the project
        commit_message (str, optional): The commit message for the update. Defaults to None.
    """

    assert app_variant_id is not None, "app_variant_id must be provided"
    assert parameters is not None, "parameters must be provided"

    try:
        await db_manager.update_variant_parameters(
            app_variant_id=app_variant_id,
            parameters=parameters,
            project_id=project_id,
            user_uid=user_uid,
            commit_message=commit_message,
        )
    except Exception as e:
        log.error(f"Error updating app variant {app_variant_id}")
        raise e from None


async def add_variant_from_url(
    app: AppDB,
    project_id: str,
    variant_name: str,
    url: str,
    user_uid: str,
    config_name: str = "default",
    base_name: Optional[str] = None,
    commit_message: Optional[str] = None,
) -> AppVariantDB:
    """
    Adds a new variant to the app based on the specified URL.

    Args:
        app (AppDB): The app to add the variant to.
        project_id (str): The ID of the project.
        variant_name (str): The name of the new variant.
        url (str): The URL to use for the new variant.
        base_name (str, optional): The name of the base to use for the new variant. Defaults to None.
        config_name (str, optional): The name of the configuration to use for the new variant. Defaults to "default".
        user_uid (str): The UID of the user.
        commit_message (str, optional): The commit message for the operation. Defaults to None.

    Returns:
        AppVariantDB: The newly created app variant.

    Raises:
        ValueError: If the app variant or URL is None, or if an app variant with the same name already exists.
        HTTPException: If an error occurs while creating the app variant.
    """
    if app in [None, ""] or variant_name in [None, ""] or url in [None, ""]:
        raise ValueError("App variant, variant name, or URL is None")

    parsed_url = urlparse(url).geturl()

    variants = await db_manager.list_app_variants_for_app_id(
        app_id=str(app.id),
        project_id=project_id,
    )

    already_exists = any(av for av in variants if av.variant_name == variant_name)  # type: ignore
    if already_exists:
        # log.debug("App variant with the same name already exists")
        raise ValueError("App variant with the same name already exists")

    user_instance = await db_manager.get_user_with_id(user_id=user_uid)

    # Create config
    config_db = await db_manager.create_new_config(
        config_name=config_name, parameters={}
    )

    # Create base
    if not base_name:
        base_name = variant_name.split(".")[
            0
        ]  # TODO: Change this in SDK2 to directly use base_name
    db_base = await db_manager.create_new_variant_base(
        app=app,
        project_id=project_id,
        base_name=base_name,
    )

    # Create app variant
    db_app_variant = await db_manager.create_new_app_variant(
        app=app,
        user=user_instance,
        variant_name=variant_name,
        project_id=project_id,
        base=db_base,
        config=config_db,
        base_name=base_name,
        commit_message=commit_message,
    )

    deployment = await db_manager.create_deployment(
        app_id=str(db_app_variant.app.id),
        project_id=project_id,
        uri=parsed_url,
    )

    await db_manager.update_base(
        str(db_app_variant.base_id),
        deployment_id=deployment.id,
    )

    return db_app_variant


def get_service_url_from_template_key(
    key: str,
) -> Optional[str]:
    if key not in [AppType.CHAT_SERVICE, AppType.COMPLETION_SERVICE]:
        return None

    if not AGENTA_SERVICES_URL:
        raise NotImplementedError("Service URL could be generated.")

    # We need to map a `template_key` to a `service_path`.
    # We could have an explicit map, like {`key`: `path`},
    # or make use of the `app_type` like here.
    # This may evolve over time if and when we change `app_type` values.
    path = key.replace("SERVICE:", "")

    url = AGENTA_SERVICES_URL + "/" + path
    return url
