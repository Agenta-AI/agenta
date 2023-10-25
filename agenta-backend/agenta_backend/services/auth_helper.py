from fastapi import Request, HTTPException


class SessionContainer(object):
    """dummy class"""

    pass


def verify_session():
    """dummy function"""

    def inner_function():
        """dummy function"""
        return SessionContainer()

    return inner_function


async def authentication_middleware(request: Request, call_next):
    try:
        # Initialize the user_id attribute in the request state if it doesn't exist
        if not hasattr(request.state, "user_uid"):
            user_uid_id = "0"
            setattr(request.state, "user_uid", user_uid_id)

        # Call the next middleware or route handler
        response = await call_next(request)
        return response
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))
