from fastapi import status
from agenta_backend.utils.common import APIRouter

router = APIRouter()


@router.get("/", status_code=status.HTTP_200_OK, operation_id="health_check")
def health_check():
    return {"status": "ok"}
