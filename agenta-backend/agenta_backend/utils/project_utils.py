from typing import Optional

from fastapi import Request


def get_project_id(request: Request, project_id: Optional[str] = None) -> str:
    """
    Retrieve the project_id from the request or use the default from the request state.

    Args:
        request (Request): The current request object containing state information.
        project_id (Optional[str]): The provided project_id from the API endpoint.

    Returns:
        str: The project_id to use for the operation.

    Raises:
        ValueError: If no project_id is provided and no default is found in the request state.
    """

    if project_id is not None:
        return project_id

    default_project_id: str = getattr(request.state, "project_id", None)
    if default_project_id is None:
        raise ValueError(
            "No project_id provided and no default project_id found in the request state."
        )

    return default_project_id
