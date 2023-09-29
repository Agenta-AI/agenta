import os
import logging
from docker.errors import DockerException
from sqlalchemy.exc import SQLAlchemyError
from fastapi.responses import JSONResponse
from agenta_backend.config import settings
from typing import Any, List, Optional, Union
from fastapi import APIRouter, HTTPException, Depends
from agenta_backend.services.selectors import get_user_own_org
from agenta_backend.services import (
    app_manager,
    docker_utils,
    db_manager,
)
from agenta_backend.utils.common import (
    check_access_to_app,
    get_app_instance,
    check_user_org_access,
    check_access_to_variant,
)
from agenta_backend.models.api.api_models import (
    URI,
    App,
    RemoveApp,
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
    AddVariantFromImagePayload,
    AddVariantFromBasePayload,
    EnvironmentOutput,
)
from agenta_backend.models import converters

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
