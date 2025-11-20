from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import APIRouter
from ee.src.services.email_helper import update_contact_in_loops

log = get_module_logger(__name__)


router = APIRouter()


class LoopsSyncRequest(BaseModel):
    """Request model for syncing user properties to Loops"""

    company_size_v1: str | None = None
    user_role_v1: str | None = None
    user_experience_v1: str | None = None
    interest_evaluation: bool | None = None
    interest_no_code: bool | None = None
    interest_prompt_management: bool | None = None
    interest_prompt_engineering: bool | None = None
    interest_observability: bool | None = None
    is_icp_v1: bool | None = None
    deviceTheme: str | None = None


@router.post("/sync-to-loops", operation_id="sync_user_properties_to_loops")
async def sync_user_properties_to_loops(
    request: Request, sync_request: LoopsSyncRequest
):
    """
    Sync user properties from PostHog to Loops for email campaigns.

    This endpoint is called after a user completes the post-signup survey.
    It updates the contact in Loops with the same properties that were sent to PostHog.

    Args:
        request: FastAPI request object (contains user email in state)
        sync_request: User properties to sync

    Returns:
        JSONResponse indicating success or failure
    """
    try:
        # Get user email from request state (set by authentication middleware)
        user_email = getattr(request.state, "user_email", None)

        if not user_email:
            raise HTTPException(
                status_code=401, detail="User email not found in request"
            )

        # Convert pydantic model to dict, excluding None values
        properties = sync_request.model_dump(exclude_none=True)

        if not properties:
            return JSONResponse(
                {"detail": "No properties provided to sync"}, status_code=400
            )

        # Sync properties to Loops
        response = update_contact_in_loops(user_email, properties)

        if response.status_code in [200, 201]:
            log.info(
                f"Successfully synced {len(properties)} properties to Loops for user: {user_email}"
            )
            return JSONResponse(
                {
                    "detail": "Properties synced to Loops successfully",
                    "properties_synced": list(properties.keys()),
                },
                status_code=200,
            )
        else:
            log.error(
                f"Failed to sync to Loops. Status: {response.status_code}, Response: {response.text}"
            )
            return JSONResponse(
                {"detail": f"Failed to sync to Loops: {response.text}"},
                status_code=response.status_code,
            )

    except ConnectionError as ex:
        log.error(f"Connection error while syncing to Loops: {ex}")
        return JSONResponse(
            {"detail": "Failed to connect to Loops API"}, status_code=503
        )
    except Exception as ex:
        log.error(f"Unexpected error while syncing to Loops: {ex}")
        return JSONResponse(
            {"detail": "An unexpected error occurred"}, status_code=500
        )
