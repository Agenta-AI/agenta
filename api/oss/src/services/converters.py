import uuid
from typing import List

from oss.src.models.api.evaluation_model import (
    CorrectAnswer,
    Evaluation,
    EvaluationScenario,
    EvaluationScenarioInput,
    EvaluationScenarioOutput,
)
from oss.src.models.db_models import (
    EvaluationDB,
    EvaluationScenarioDB,
)


async def evaluation_db_to_pydantic(
    evaluation_db: EvaluationDB,
) -> Evaluation:
    variant_name = (
        evaluation_db.variant.variant_name
        if evaluation_db.variant.variant_name
        else str(evaluation_db.variant_id)
    )
    aggregated_results = aggregated_result_of_evaluation_to_pydantic(
        evaluation_db.aggregated_results
    )

    # Fall back to created_at if no update has occurred
    updated_at = evaluation_db.updated_at or evaluation_db.created_at

    return Evaluation(
        id=str(evaluation_db.id),
        app_id=str(evaluation_db.app_id),
        project_id=str(evaluation_db.project_id),
        status=evaluation_db.status,
        variant_ids=[str(evaluation_db.variant_id)],
        variant_revision_ids=[str(evaluation_db.variant_revision_id)],
        revisions=[str(evaluation_db.variant_revision.revision)],
        variant_names=[variant_name],
        testset_id=str(evaluation_db.testset_id),
        testset_name=evaluation_db.testset.name,
        aggregated_results=aggregated_results,
        created_at=str(evaluation_db.created_at) if evaluation_db.created_at else None,
        updated_at=str(updated_at) if updated_at else None,
        average_cost=evaluation_db.average_cost,
        total_cost=evaluation_db.total_cost,
        average_latency=evaluation_db.average_latency,
    )


def aggregated_result_of_evaluation_to_pydantic(
    evaluation_aggregated_results: List,
) -> List[dict]:
    transformed_results = []
    for aggregated_result in evaluation_aggregated_results:
        evaluator_config_dict = None
        if isinstance(aggregated_result.evaluator_config_id, uuid.UUID):
            config = aggregated_result.evaluator_config
            # Fall back to created_at if no update has occurred
            config_updated_at = config.updated_at or config.created_at
            evaluator_config_dict = {
                "id": str(config.id),
                "name": config.name,
                "evaluator_key": config.evaluator_key,
                "settings_values": config.settings_values,
                "created_at": str(config.created_at) if config.created_at else None,
                "updated_at": str(config_updated_at) if config_updated_at else None,
            }
        transformed_results.append(
            {
                "evaluator_config": (
                    {} if evaluator_config_dict is None else evaluator_config_dict
                ),
                "result": aggregated_result.result,
            }
        )
    return transformed_results


async def evaluation_scenario_db_to_pydantic(
    evaluation_scenario_db: EvaluationScenarioDB, evaluation_id: str
) -> EvaluationScenario:
    scenario_results = [
        {
            "evaluator_config": str(scenario_result.evaluator_config_id),
            "result": scenario_result.result,
        }
        for scenario_result in evaluation_scenario_db.results
    ]
    return EvaluationScenario(
        id=str(evaluation_scenario_db.id),
        evaluation_id=evaluation_id,
        inputs=[
            EvaluationScenarioInput(**scenario_input)  # type: ignore
            for scenario_input in evaluation_scenario_db.inputs
        ],
        outputs=[
            EvaluationScenarioOutput(**scenario_output)  # type: ignore
            for scenario_output in evaluation_scenario_db.outputs
        ],
        correct_answers=[
            CorrectAnswer(**correct_answer)  # type: ignore
            for correct_answer in evaluation_scenario_db.correct_answers
        ],
        is_pinned=evaluation_scenario_db.is_pinned or False,  # type: ignore
        note=evaluation_scenario_db.note or "",  # type: ignore
        results=scenario_results,  # type: ignore
    )
