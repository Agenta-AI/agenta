from celery import shared_task
import asyncio

from agenta_backend.services import llm_apps_service
from agenta_backend.services.db_manager import (
    fetch_app_variant_by_id,
    get_deployment_by_objectid,
    fetch_testset_by_id,
    create_new_evaluation_scenario
)
from agenta_backend.models.api.evaluation_model import NewEvaluation, EvaluationScenario, EvaluationScenarioOutput

from agenta_backend.models.db_models import (
    AppDB
)
# from agenta_backend.celery_init import celery_app

@shared_task(queue='agenta_backend.tasks.evaluations.evaluate')
def evaluate(app_data, new_evaluation_data):
    loop = asyncio.get_event_loop()
    new_evaluation = NewEvaluation(**new_evaluation_data)
    app = AppDB(**app_data)
    testset = loop.run_until_complete(fetch_testset_by_id(new_evaluation.testset_id))
    print("data is ready")
    print(testset)


