"""Routes for image-related operations (push, remove).
Does not deal with the instanciation of the images
"""

import os
import logging
from docker.errors import DockerException
from sqlalchemy.exc import SQLAlchemyError
from fastapi.responses import JSONResponse
from agenta_backend.config import settings
from typing import Any, Dict, List, Optional, Union
from fastapi import APIRouter, Body, HTTPException, Depends
from agenta_backend.services.selectors import get_user_own_org
from agenta_backend.services import (
    app_manager,
    db_manager,
    docker_utils,
    new_db_manager,
    new_app_manager,
)
from agenta_backend.utils.common import check_access_to_app, get_app_instance
from agenta_backend.models.converters import app_variant_db_to_output
from agenta_backend.utils.common import check_user_org_access, check_access_to_variant
from agenta_backend.models.api.api_models import (
    URI,
    App,
    AppOutput,
    CreateApp,
    CreateAppOutput,
    AppVariant,
    Image,
    DockerEnvVars,
    CreateAppVariant,
    AddVariantFromPreviousPayload,
    AppVariantOutput,
    Variant,
    UpdateVariantParameterPayload,
    AddVariantFromBasePayload,
)
from agenta_backend.models.db_models import (
    AppDB,
    AppVariantDB,
    EnvironmentDB,
    ImageDB,
    TemplateDB,
    UserDB,
    OrganizationDB,
    BaseDB,
    ConfigDB,
)

if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    from agenta_backend.ee.services.auth_helper import (  # noqa pylint: disable-all
        SessionContainer,
        verify_session,
    )
    from agenta_backend.ee.services.selectors import (
        get_user_and_org_id,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.services.auth_helper import (
        SessionContainer,
        verify_session,
    )
    from agenta_backend.services.selectors import get_user_and_org_id

router = APIRouter()
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


@router.get("/", response_model=List[AppVariant])
async def list_variants(
    app_id: Optional[str] = None,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Lists the app variants from our repository.

    Arguments:
        app_id -- If specified, only returns the app variants for the specified app
    Raises:
        HTTPException: _description_

    Returns:
        List[AppVariant]
    """

    try:
        user_org_data: dict = await get_user_and_org_id(stoken_session)

        if app_id is not None:
            access_app = await check_access_to_app(user_org_data, app_id=app_id)
            if not access_app:
                error_msg = f"You cannot access app: {app_id}"
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=400,
                )

        app_variants = await new_db_manager.list_app_variants(
            app_id=app_id, **user_org_data
        )
        return [app_variant_db_to_output(app_variant) for app_variant in app_variants]

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
