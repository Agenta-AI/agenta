from typing import Literal
import logging

from pydantic import BaseModel

from agenta_backend.utils.common import (
    isCloudEE,
    APIRouter,
)

from fastapi.responses import JSONResponse
from fastapi import HTTPException, Request

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

router = APIRouter()


class AuthorizationResponse(BaseModel):
    status: Literal["allow", "deny"]


@router.get(
    "/verify",
    response_model=AuthorizationResponse,
    operation_id="verify_permissions",
)
async def verify_permissions(
    request: Request,
):
    # BY DEFAULT: RUN_APPLICATION

    try:
        pass
    except Exception as exc:  # pylint: disable=bare-except
        logger.error("Error while verifying permissions: %s", exc)

        raise HTTPException(
            status_code=401,
            detail="Unauthorized",
        ) from exc
