import logging

from typing import List, Optional, Union
from fastapi.responses import JSONResponse
from fastapi import Request, UploadFile, HTTPException


from oss.src.services import db_manager
from oss.src.utils.common import (
    APIRouter,
    isCloudEE,
    isCloudProd,
    isCloudDev,
    isEE,
)

if isCloudEE():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access
    from ee.src.models.api.api_models import Image_ as Image
else:
    from oss.src.models.api.api_models import Image


if isCloudProd():
    from ee.src.services import container_manager
elif isCloudDev():
    from oss.src.services import container_manager
elif isEE():
    from ee.src.services import container_manager
else:
    from oss.src.services import container_manager

from oss.src.models.api.api_models import (
    URI,
    RestartAppContainer,
    Template,
)


router = APIRouter()
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


# TODO: We need to improve this to use the introduced abstraction to also use start and stop service
# * Edit: someone remind me (abram) to work on this.
@router.post("/build_image/", operation_id="build_image")
async def build_image(
    app_id: str,
    base_name: str,
    tar_file: UploadFile,
    request: Request,
) -> Image:
    """
    Builds a Docker image from a tar file containing the application code.

    Args:
        app_id (str): The ID of the application to build the image for.
        base_name (str): The base name of the image to build.
        tar_file (UploadFile): The tar file containing the application code.
        stoken_session (SessionContainer): The session container for the user making the request.

    Returns:
        Image: The Docker image that was built.
    """

    app_db = await db_manager.fetch_app_by_id(app_id)
    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(app_db.project_id),
            permission=Permission.CREATE_APPLICATION,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    image_result = await container_manager.build_image(
        app_db=app_db,
        base_name=base_name,
        tar_file=tar_file,
    )

    return image_result


@router.post("/restart_container/", operation_id="restart_container")
async def restart_docker_container(
    payload: RestartAppContainer,
    request: Request,
) -> dict:
    """Restart docker container.

    Args:
        payload (RestartAppContainer) -- the required data (app_name and variant_name)
    """

    logger.debug(f"Restarting container for variant {payload.variant_id}")

    app_variant_db = await db_manager.fetch_app_variant_by_id(payload.variant_id)
    deployment = await db_manager.get_deployment_by_id(app_variant_db.base.deployment)
    container_id = deployment.container_id

    logger.debug(f"Restarting container with id: {container_id}")
    container_manager.restart_container(container_id)
    return {"message": "Please wait a moment. The container is now restarting."}


@router.get("/templates/", operation_id="container_templates")
async def container_templates(
    request: Request,
) -> Union[List[Template], str]:
    """
    Returns a list of templates available for creating new containers.

    Parameters:
    stoken_session (SessionContainer): The session container for the user.

    Returns:

    Union[List[Template], str]: A list of templates or an error message.
    """
    # Frontend expects these exact names: web/oss/src/components/pages/app-management/assets/helpers.ts
    COMPLETION_SERVICE_TITLE = "Completion Prompt"
    CHAT_SERVICE_TITLE = "Chat Prompt"
    return [
        {
            "id": "1",
            "image": {
                "name": "completion",
                "size": None,
                "digest": None,
                "title": COMPLETION_SERVICE_TITLE,
                "description": "Single prompt application useful for one-turn completions (text generation, classification, etc.)",
                "last_pushed": "2024-10-22T13:11:28.993403Z",
                "repo_name": None,
                "template_uri": None,
            },
        },
        {
            "id": "2",
            "image": {
                "name": "chat",
                "size": None,
                "digest": None,
                "title": CHAT_SERVICE_TITLE,
                "description": "Chat application useful for multi-turn conversations",
                "last_pushed": "2024-10-22T13:11:29.008086Z",
                "repo_name": None,
                "template_uri": None,
            },
        },
    ]


@router.get("/container_url/", operation_id="construct_app_container_url")
async def construct_app_container_url(
    request: Request,
    base_id: Optional[str] = None,
    variant_id: Optional[str] = None,
) -> URI:
    """
    Constructs the URL for an app container based on the provided base_id or variant_id.

    Args:
        base_id (Optional[str]): The ID of the base to use for the app container.
        variant_id (Optional[str]): The ID of the variant to use for the app container.
        request (Request): The request object.

    Returns:
        URI: The URI for the app container.

    Raises:
        HTTPException: If the base or variant cannot be found or the user does not have access.
    """

    # assert that one of base_id or variant_id is provided
    assert base_id or variant_id, "Please provide either base_id or variant_id"

    if base_id:
        object_db = await db_manager.fetch_base_by_id(base_id)
    elif variant_id and variant_id != "None":
        # NOTE: Backward Compatibility
        # ---------------------------
        # When a user creates a human evaluation with a variant and later deletes the variant,
        # the human evaluation page becomes inaccessible due to the backend raising a
        # "'NoneType' object has no attribute 'variant_id'" error. To suppress this error,
        # we will return the string "None" as the ID of the variant.
        # This change ensures that users can still view their evaluations; however,
        # they will no longer be able to access a deployment URL for the deleted variant.
        # Therefore, we ensure that variant_id is not "None".
        object_db = await db_manager.fetch_app_variant_by_id(variant_id)
    else:
        # NOTE: required for backward compatibility

        object_db = None

    # Check app access
    if isCloudEE() and object_db is not None:
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(object_db.project_id),
            permission=Permission.VIEW_APPLICATION,
        )

        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            logger.error(error_msg)

            raise HTTPException(status_code=403, detail=error_msg)

    if getattr(object_db, "deployment_id", None):  # this is a base
        deployment = await db_manager.get_deployment_by_id(
            str(object_db.deployment_id)  # type: ignore
        )
    elif getattr(object_db, "base_id", None):  # this is a variant
        deployment = await db_manager.get_deployment_by_id(
            str(object_db.base.deployment_id)  # type: ignore
        )
    else:
        raise HTTPException(
            status_code=400,
            detail="Deployment not found",
        )

    return URI(uri=deployment.uri)
