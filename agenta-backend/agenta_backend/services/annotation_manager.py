import os
import secrets
from typing import List, Dict

from bson import ObjectId
from fastapi import HTTPException

from agenta_backend.services import db_manager
from agenta_backend.models import converters
from agenta_backend.models.api.annotation_models import (
    Annotation,
    AnnotationScenario,
    AnnotationScenarioInput,
    AnnotationStatusEnum,
    NewAnnotation,
    AnnotationScenarioUpdate,
)


from agenta_backend.models.db_models import (
    AnnotationsDB,
    AppDB,
)

from agenta_backend.utils.common import engine, check_access_to_app


async def _fetch_annotation_and_check_access(
    annotation_id: str, **user_org_data: dict
) -> AnnotationsDB:

    annotation = await db_manager.fetch_annotation_by_id(annotation_id=annotation_id)

    if annotation is None:
        raise HTTPException(
            status_code=404,
            detail=f"Annotation with id {annotation_id} not found",
        )

    access = await check_access_to_app(
        user_org_data=user_org_data, app_id=annotation.app.id
    )
    if not access:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have access to this app: {str(annotation.app.id)}",
        )
    return annotation


async def fetch_list_annotations(
    app_id: str,
    **user_org_data: dict,
) -> List[Annotation]:
    """
    Fetches a list of annotations based on the provided filtering criteria.

    Args:
        app_id (str): The app ID to filter the annotations.
        user_org_data (dict): User and organization data.

    Returns:
        List[Annotation]: A list of annotations.
    """

    access = await check_access_to_app(user_org_data=user_org_data, app_id=app_id)
    if not access:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have access to this app: {app_id}",
        )

    annotations_db = await db_manager.fetch_annotations_by_app_id(app_id=app_id)

    return [
        converters.annotation_db_to_pydantic(annotation)
        for annotation in annotations_db
    ]


async def fetch_annotation(annotation_id: str, **user_org_data: dict) -> Annotation:
    """
    Fetches a single annotation based on its ID.

    Args:
        annotation_id (str): The ID of the annotation.
        user_org_data (dict): User and organization data.

    Returns:
        Annotation: The fetched annotation.
    """
    annotation = await _fetch_annotation_and_check_access(
        annotation_id=annotation_id, **user_org_data
    )
    return converters.annotation_db_to_pydantic(annotation)


async def create_new_annotation(
    app_data: dict, new_annotation_data: dict
) -> Annotation:
    """
    Create a new annotation.

    Args:
        app_data (dict): Required app data
        new_annotation_data (dict): Required new annotation data

    Returns:
        Annotation
    """

    new_annotation = NewAnnotation(**new_annotation_data)
    app = AppDB(**app_data)

    annotation_db = await db_manager.create_new_annotation(
        app=app,
        organization=app.organization,
        user=app.user,
        annotation_name=new_annotation.annotation_name,
        testset_id=new_annotation.testset_id,
        status=AnnotationStatusEnum.ANNOTATION_STARTED,
        variants_ids=new_annotation.variants_ids,
    )
    return converters.annotation_db_to_pydantic(annotation_db)

