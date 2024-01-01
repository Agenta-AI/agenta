import asyncio
from typing import List
from bson import ObjectId
from celery import shared_task
from collections import defaultdict

from agenta_backend.services import llm_apps_service
from agenta_backend.services.db_manager import (
    fetch_annotation_by_id,
    fetch_app_variant_by_id,
    get_deployment_by_objectid,
    fetch_testset_by_id,
    create_new_annotation_scenario,
)
from agenta_backend.models.db_models import (
    AppDB,
    AnnotationScenarioInputDB,
    AnnotationScenarioOutputDB,
    AnnotationScenarioInputDB,
    AnnotationScenarioResult,
)

from agenta_backend.models.api.annotation_models import NewAnnotation


@shared_task(queue="agenta_backend.tasks.annotations.prepare_scenarios")
def prepare_scenarios(
    app_data: dict, new_annotation_data: dict, annotation_id: str, testset_id: str
):
    loop = asyncio.get_event_loop()
    app = AppDB(**app_data)
    annotation = NewAnnotation(**new_annotation_data)

    testset = loop.run_until_complete(fetch_testset_by_id(testset_id))
    new_annotation_db = loop.run_until_complete(fetch_annotation_by_id(annotation_id))

    for variant_id in annotation.variants_ids:
        variant_id = str(variant_id)

        app_variant_db = loop.run_until_complete(fetch_app_variant_by_id(variant_id))
        deployment = loop.run_until_complete(
            get_deployment_by_objectid(app_variant_db.base.deployment)
        )

        uri = deployment.uri.replace("http://localhost", "http://host.docker.internal")

        for data_point in testset.csvdata:
            # 1. We prepare the inputs
            raw_inputs = (
                app_variant_db.parameters.get("inputs", [])
                if app_variant_db.parameters
                else []
            )
            inputs = []
            if raw_inputs:
                inputs = [
                    AnnotationScenarioInputDB(
                        name=input_item["name"],
                        type="text",
                        value=data_point[input_item["name"]],
                    )
                    for input_item in raw_inputs
                ]

            # 2. We get the output from the llm app
            # TODO: make outputs for all variants
            variant_output = llm_apps_service.get_llm_app_output(uri, data_point)

            # 3. We create a new annotation scenario
            annotation_scenario = loop.run_until_complete(
                create_new_annotation_scenario(
                    app=app,
                    user=app.user,
                    organization=app.organization,
                    annotation_id=new_annotation_db.id,
                    inputs=inputs,
                    outputs=[
                        AnnotationScenarioOutputDB(type="text", value=variant_output)
                    ],
                    isPinned=False,
                    note="",
                )
            )
