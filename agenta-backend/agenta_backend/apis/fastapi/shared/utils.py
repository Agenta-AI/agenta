from functools import wraps
from traceback import print_exc
from fastapi import HTTPException
from uuid import uuid4


def handle_exceptions():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except HTTPException as e:
                raise e
            except Exception:
                support_id = str(uuid4())
                print(f"ERROR : support_id={support_id} & operation_id={func.__name__}")
                print_exc()
                raise HTTPException(
                    status_code=500,
                    detail=f"An unexpected error occurred with operation_id={func.__name__}. Please contact support with support_id={support_id}.",
                )

        return wrapper

    return decorator
