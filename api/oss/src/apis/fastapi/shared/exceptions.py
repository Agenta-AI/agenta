from fastapi import HTTPException

FORBIDDEN_EXCEPTION = HTTPException(
    status_code=403,
    detail="You do not have access to perform this action. Please contact your organization admin.",
)
