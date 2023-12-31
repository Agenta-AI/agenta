import datetime
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
    AnnotationsScenariosDB,
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


async def _fetch_annotation_scenario_and_check_access(
    annotation_scenario_id: str, **user_org_data: dict
) -> AnnotationsScenariosDB:
    # Fetch the annotation scenario by ID
    annotation_scenario = await db_manager.fetch_annotation_scenario_by_id(
        annotation_scenario_id=annotation_scenario_id
    )
    if annotation_scenario is None:
        raise HTTPException(
            status_code=404,
            detail=f"Annotation scenario with id {annotation_scenario_id} not found",
        )
    annotation = annotation_scenario.annotation

    # Check if the annotation exists
    if annotation is None:
        raise HTTPException(
            status_code=404,
            detail=f"Annotation scenario for annotation scenario with id {annotation_scenario_id} not found",
        )

    # Check for access rights
    access = await check_access_to_app(
        user_org_data=user_org_data, app_id=annotation.app.id
    )
    if not access:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have access to this app: {str(annotation.app.id)}",
        )
    return annotation_scenario


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

    testset = await db_manager.fetch_testset_by_id(new_annotation.testset_id)

    annotation_db = await db_manager.create_new_annotation(
        app=app,
        organization=app.organization,
        user=app.user,
        annotation_name=new_annotation.annotation_name,
        testset_id=new_annotation.testset_id,
        status=AnnotationStatusEnum.ANNOTATION_STARTED,
        variants_ids=new_annotation.variants_ids,
    )

    annotations_scenarios = []
    for datapoint in testset.csvdata:
        # TODO: make inputs dynamic
        annotation_scenario = {
            "annotation_id": ObjectId(annotation_db.id),
            "inputs": [{"input_name": "country", "input_value": datapoint["country"]}],
            "user": ObjectId(app.user.id),
            "organization": ObjectId(app.organization.id),
        }
        annotations_scenarios.append(annotation_scenario)

    db_manager.insert_many_documents_using_driver(
        annotations_scenarios, "annotations_scenarios_db"
    )

    return converters.annotation_db_to_pydantic(annotation_db)


async def create_annotation_scenario(
    annotation_id: str, payload: AnnotationScenario, **user_org_data: dict
) -> None:
    """
    Create a new annotation scenario.

    Args:
        annotation_id (str): The ID of the annotation.
        payload (AnnotationScenario): Annotation scenario data.
        user_org_data (dict): User and organization data.

    Raises:
        HTTPException: If annotation not found or access denied.
    """

    scenario_inputs = [
        AnnotationScenarioInput(
            input_name=input_item.input_name,
            input_value=input_item.input_value,
        )
        for input_item in payload.inputs
    ]

    new_annotation_scenario = AnnotationsScenariosDB(
        user=new_annotation_scenario.user,
        organization=new_annotation_scenario.organization,
        annotation_id=annotation_id,
        inputs=scenario_inputs,
        outputs=[],
        is_pinned=False,
        note="",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    await engine.save(new_annotation_scenario)


async def update_annotation_scenario(
    annotation_scenario_id: str,
    annotation_scenario_data: AnnotationScenarioUpdate,
    **user_org_data,
) -> None:
    """
    Updates an annotation scenario.

    Args:
        annotation_scenario_id (str): The ID of the annotation scenario.
        annotation_scenario_data (AnnotationScenarioUpdate): New data for the scenario.
        annotation_type (AnnotationType): Type of the annotation.
        user_org_data (dict): User and organization data.

    Raises:
        HTTPException: If annotation scenario not found or access denied.
    """
    annotation_scenario = await _fetch_annotation_scenario_and_check_access(
        annotation_scenario_id=annotation_scenario_id,
        **user_org_data,
    )

    updated_data = annotation_scenario_data.dict()
    updated_data["updated_at"] = datetime.utcnow()

    await engine.save(annotation_scenario)
