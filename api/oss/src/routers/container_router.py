from fastapi import Request

from oss.src.utils.common import APIRouter


router = APIRouter()


@router.get("/templates/", operation_id="container_templates")
async def container_templates(request: Request):
    """
    Returns a list of templates available for creating new containers.
    """

    # Frontend expects these exact names: web/oss/src/components/pages/app-management/assets/helpers.ts
    COMPLETION_SERVICE_TITLE = "Completion Prompt"
    CHAT_SERVICE_TITLE = "Chat Prompt"

    return [
        {
            "id": "1",
            "image": {
                "name": "completion",
                "size": None,
                "digest": None,
                "title": COMPLETION_SERVICE_TITLE,
                "description": "Single prompt application useful for one-turn completions (text generation, classification, etc.)",
                "last_pushed": "2024-10-22T13:11:28.993403Z",
                "repo_name": None,
                "template_uri": None,
            },
        },
        {
            "id": "2",
            "image": {
                "name": "chat",
                "size": None,
                "digest": None,
                "title": CHAT_SERVICE_TITLE,
                "description": "Chat application useful for multi-turn conversations",
                "last_pushed": "2024-10-22T13:11:29.008086Z",
                "repo_name": None,
                "template_uri": None,
            },
        },
    ]
