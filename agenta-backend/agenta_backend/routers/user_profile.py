import os
from agenta_backend.utills.common import engine
from agenta_backend.services.db_manager import UserDB
from fastapi import APIRouter, HTTPException, Depends
from agenta_backend.models.api.user_models import User

router = APIRouter()

if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    from agenta_backend.ee.services.auth_helper import (
        SessionContainer,
        verify_session,
    )
    from agenta_backend.ee.services.selectors import get_user_and_org_id
else:
    from agenta_backend.services.auth_helper import (
        SessionContainer,
        verify_session,
    )
    from agenta_backend.services.selectors import get_user_and_org_id

@router.get("/")
async def user_profile(
    stoken_session: SessionContainer = Depends(verify_session()),
):
    
    try:
        
        kwargs: dict = await get_user_and_org_id(stoken_session)
        user = await engine.find_one(UserDB, UserDB.uid == kwargs["uid"])
        return User(
            id=str(user.id),
            uid=str(user.uid),
            username=str(user.username),
            email=str(user.email)
        ).dict(exclude_unset=True)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

