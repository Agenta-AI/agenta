import logging
from typing import Optional

from fastapi import Request


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


async def retrieve_project_id_from_request(request: Request) -> Optional[str]:
    """
    Retrieves the `project_id` from an incoming HTTP request.

    This function attempts to extract the `project_id` from various parts of the request:
    1. Path parameters
    2. Query parameters

    Args:
        request (Request): The FastAPI `Request` object from which to extract the `project_id`.

    Returns:
        Optional[str]: The extracted `project_id` if found; otherwise, `None`.
    """

    logger.info("Retrieving project_id from request...")

    project_id_from_path_params = request.path_params.get("project_id")
    if project_id_from_path_params:
        logger.info("Project ID found in path params")
        return project_id_from_path_params

    project_id_from_query_params = request.query_params.get("project_id")
    if project_id_from_query_params:
        logger.info("Project ID found in query params")
        return project_id_from_query_params

    logger.info("No project ID found in the request")
    return None
