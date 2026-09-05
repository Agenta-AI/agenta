from functools import wraps

from fastapi import HTTPException

from oss.src.core.skills.exceptions import (
    SkillsError,
    SkillSourceFetchError,
    SkillSourceInvalidURLError,
    SkillSourceNotFoundError,
    SkillSourceTooLargeError,
    SkillNameCollisionError,
)

_STATUS_BY_TYPE = {
    SkillSourceInvalidURLError: 422,
    SkillSourceTooLargeError: 413,
    SkillSourceFetchError: 502,
    SkillSourceNotFoundError: 404,
    SkillNameCollisionError: 409,
}


def handle_skills_exceptions():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except SkillsError as e:
                status_code = next(
                    (
                        status
                        for exc_type, status in _STATUS_BY_TYPE.items()
                        if isinstance(e, exc_type)
                    ),
                    400,
                )
                detail = {
                    "code": e.code,
                    "message": e.message,
                    "retryable": e.retryable,
                }
                if e.next_step:
                    detail["next_step"] = e.next_step
                if e.details:
                    detail["details"] = e.details
                raise HTTPException(status_code=status_code, detail=detail) from e

        return wrapper

    return decorator
