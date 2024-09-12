from fastapi import Request, HTTPException

from agenta_backend.services.db_manager import fetch_default_project, NoResultFound


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
        if not hasattr(request.state, "user_id"):
            user_uid_id = "0"
            setattr(request.state, "user_id", user_uid_id)

        if not hasattr(request.state, "project_id"):
            project = await fetch_default_project()
            if project is None:
                raise NoResultFound("Default project not found.")

            setattr(request.state, "project_id", str(project.id))

        # Call the next middleware or route handler
        response = await call_next(request)
        return response
    except Exception as e:
        status_code = e.status_code if hasattr(e, "status_code") else 500
        raise HTTPException(status_code=status_code, detail=str(e))
