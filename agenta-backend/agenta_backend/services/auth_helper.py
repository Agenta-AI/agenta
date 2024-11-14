import logging

from fastapi import Request, HTTPException

from agenta_backend.utils.project_utils import retrieve_project_id_from_request
from agenta_backend.services.db_manager import fetch_default_project, NoResultFound


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


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
        # Retrieve project_id from request
        project_id_from_request = await retrieve_project_id_from_request(
            request=request
        )

        # Set project_id if found or fetch default
        if project_id_from_request and not hasattr(request.state, "project_id"):
            setattr(request.state, "project_id", project_id_from_request)
        elif not project_id_from_request:
            logger.info("Retrieving default project from database...")
            project = await fetch_default_project()  # Fetch the default project
            if project is None:
                raise NoResultFound("Default project not found.")

            setattr(request.state, "project_id", str(project.id))
            logger.info(
                f"Default project fetched: {str(project.id)} and set in request.state"
            )

        if not hasattr(request.state, "user_id"):
            setattr(request.state, "user_id", "0")

        # Call the next middleware or route handler
        response = await call_next(request)
        return response
    except Exception as e:
        # Handle exceptions, set status code
        status_code = e.status_code if hasattr(e, "status_code") else 500
        raise HTTPException(status_code=status_code, detail=str(e))
