import os
import secrets
from typing import List, Dict

from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from fastapi import HTTPException, APIRouter, Body, Request, status, Response

from agenta_backend.models.api.annotation_models import (
    Annotation,
    AnnotationScenario,
    NewAnnotation,
    AnnotationScenarioUpdate,
)

from agenta_backend.services.annotation_manager import update_annotation_scenario
from agenta_backend.tasks.evaluations import evaluate

from agenta_backend.utils.common import check_access_to_app
from agenta_backend.services import db_manager, annotation_manager

from agenta_backend.tasks.annotations import prepare_scenarios

if os.environ["FEATURE_FLAG"] in ["cloud", "ee"]:
    from agenta_backend.commons.services.selectors import (  # noqa pylint: disable-all
        get_user_and_org_id,
    )
else:
    from agenta_backend.services.selectors import get_user_and_org_id

router = APIRouter()


@router.post("/")
async def create_annotation(
    payload: NewAnnotation,
    request: Request,
) -> Annotation:
    """Creates a new annotation document
    Raises:
        HTTPException: _description_
    Returns:
        _description_
    """
    try:
        user_org_data: dict = await get_user_and_org_id(request.state.user_id)
        access_app = await check_access_to_app(
            user_org_data=user_org_data,
            app_id=payload.app_id,
            check_owner=False,
        )
        if not access_app:
            error_msg = f"You do not have access to this app: {payload.app_id}"
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        app = await db_manager.fetch_app_by_id(app_id=payload.app_id)
        if app is None:
            raise HTTPException(status_code=404, detail="App not found")

        app_data = jsonable_encoder(app)
        new_annotation_data = payload.dict()
        annotation = await annotation_manager.create_new_annotation(
            app_data=app_data,
            new_annotation_data=new_annotation_data,
        )

        prepare_scenarios.delay(
            app_data, new_annotation_data, annotation.id, annotation.testset_id
        )

        return annotation
    except KeyError:
        raise HTTPException(
            status_code=400,
            detail="columns in the annotation set should match the names of the inputs in the variant",
        )


@router.get("/", response_model=List[Annotation])
async def fetch_list_annotations(
    app_id: str,
    request: Request,
):
    """Fetches a list of annotations, optionally filtered by an app ID.

    Args:
        app_id (Optional[str]): An optional app ID to filter the annotations.

    Returns:
        List[Annotation]: A list of annotations.
    """
    user_org_data = await get_user_and_org_id(request.state.user_id)
    return await annotation_manager.fetch_list_annotations(
        app_id=app_id, **user_org_data
    )


@router.get("/{annotation_id}/", response_model=Annotation)
async def fetch_annotation(
    annotation_id: str,
    request: Request,
):
    """Fetches a single annotation based on its ID.

    Args:
        annotation_id (str): The ID of the annotation to fetch.

    Returns:
        Annotation: The fetched annotation.
    """
    user_org_data = await get_user_and_org_id(request.state.user_id)
    return await annotation_manager.fetch_annotation(annotation_id, **user_org_data)


@router.get("/{annotation_id}/annotations_scenarios/", response_model=List[AnnotationScenario])
async def fetch_annotations_scenarios(
    annotation_id: str,
    request: Request,
):
    """Fetches a single annotation based on its ID.

    Args:
        annotation_id (str): The ID of the annotation to fetch.

    Returns:
        Annotation: The fetched annotation.
    """
    user_org_data = await get_user_and_org_id(request.state.user_id)
    return await annotation_manager.fetch_annotations_scenarios(annotation_id, **user_org_data)


@router.put("/{annotation_id}/annotations_scenarios/{annotation_scenario_id}/")
async def update_annotation_scenario_router(
    annotation_id: str,
    annotation_scenario_id: str,
    annotation_scenario: AnnotationScenarioUpdate,
    request: Request,
):
    """Updates an annotation scenario's data.

    Raises:
        HTTPException: If update fails or unauthorized.

    Returns:
        None: 204 No Content status code upon successful update.
    """
    user_org_data = await get_user_and_org_id(request.state.user_id)

    await update_annotation_scenario(
        annotation_scenario_id,
        annotation_scenario,
        **user_org_data,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
