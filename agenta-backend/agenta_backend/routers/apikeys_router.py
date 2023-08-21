import logging
from typing import Dict

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from agenta_backend.services.selectors import get_user_and_org_id
from agenta_backend.services.apikeys_service import (
    save_apikey,
    get_apikey,
    remove_apikey,
)
from agenta_backend.models.api.apikeys_models import (
    OpenAIAPIKey,
    SaveOpenAIAPIKey,
)

from supertokens_python.recipe.session import SessionContainer
from supertokens_python.recipe.session.framework.fastapi import verify_session


router = APIRouter()
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


@router.post("/save/")
async def save_openai_apikey_to_db(
    payload: SaveOpenAIAPIKey,
    stoken_session: SessionContainer = Depends(verify_session()),
) -> Dict:
    """Save user apikey in database.

    Arguments:
        payload (dict) -- The payload required to save apikey

    Returns:
        Dict: a dictionary of status and message
    """

    # Get user id
    kwargs: dict = await get_user_and_org_id(stoken_session)

    apikey = OpenAIAPIKey(
        **{"user_id": kwargs["user_id"], "api_key": payload.api_key}
    )
    try:
        await save_apikey(apikey)
    except Exception as e:
        return JSONResponse(
            {"status": False, "message": str(e)}, status_code=400
        )
    return {"status": True, "message": "API Key saved successfully!"}


@router.get("/retrieve/")
async def get_openai_apikey(
    stoken_session: SessionContainer = Depends(verify_session()),
) -> Dict:
    """Retrieve openai apikey from database.

    Returns:
        Dict: a dictionary of status and data
    """

    # Get user id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    api_key = await get_apikey(kwargs["user_id"])
    return {"status": True, "data": {"api_key": api_key}}


@router.put("/remove/")
async def remove_openai_apikey(
    stoken_session: SessionContainer = Depends(verify_session()),
) -> Dict:
    """Remove openai apikey from database.

    Returns:
        Dict: a status and message
    """

    # Get user id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    try:
        await remove_apikey(kwargs["user_id"])
    except Exception as e:
        return JSONResponse(
            {"status": False, "message": str(e)}, status_code=400
        )
    return {"status": True, "message": "Successfully removed OpenAI Key!"}
