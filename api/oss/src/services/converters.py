import uuid
from typing import List, Dict, Any
from datetime import datetime, timezone

from oss.src.services import db_manager
from oss.src.models.api.evaluation_model import (
    CorrectAnswer,
    Evaluation,
    HumanEvaluation,
    EvaluationScenario,
    SimpleEvaluationOutput,
    EvaluationScenarioInput,
    HumanEvaluationScenario,
    EvaluationScenarioOutput,
)
from oss.src.models.db_models import (
    EvaluationDB,
    HumanEvaluationDB,
    EvaluationScenarioDB,
    HumanEvaluationScenarioDB,
)


async def human_evaluation_db_to_simple_evaluation_output(
    human_evaluation_db: HumanEvaluationDB,
) -> SimpleEvaluationOutput:
    evaluation_variants = await db_manager.fetch_human_evaluation_variants(
        human_evaluation_id=str(human_evaluation_db.id)
    )
    return SimpleEvaluationOutput(
        id=str(human_evaluation_db.id),
        app_id=str(human_evaluation_db.app_id),
        project_id=str(human_evaluation_db.project_id),
        status=human_evaluation_db.status,  # type: ignore
        evaluation_type=human_evaluation_db.evaluation_type,  # type: ignore
        variant_ids=[
            str(evaluation_variant.variant_id)
            for evaluation_variant in evaluation_variants
        ],
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


async def human_evaluation_db_to_pydantic(
    evaluation_db: HumanEvaluationDB,
) -> HumanEvaluation:
    evaluation_variants = await db_manager.fetch_human_evaluation_variants(
        human_evaluation_id=str(evaluation_db.id)  # type: ignore
    )

    revisions = []
    variants_ids = []
    variants_names = []
    variants_revision_ids = []
    for evaluation_variant in evaluation_variants:
        variant_name = (
            evaluation_variant.variant.variant_name
            if isinstance(evaluation_variant.variant_id, uuid.UUID)
            else str(evaluation_variant.variant_id)
        )
        variants_names.append(str(variant_name))
        variants_ids.append(str(evaluation_variant.variant_id))
        variant_revision = (
            str(evaluation_variant.variant_revision.revision)
            if isinstance(evaluation_variant.variant_revision_id, uuid.UUID)
            else " None"
        )
        revisions.append(variant_revision)
        variants_revision_ids.append(str(evaluation_variant.variant_revision_id))

    # Fall back to created_at if no update has occurred
    updated_at = evaluation_db.updated_at or evaluation_db.created_at

    return HumanEvaluation(
        id=str(evaluation_db.id),
        app_id=str(evaluation_db.app_id),
        project_id=str(evaluation_db.project_id),
        status=evaluation_db.status,  # type: ignore
        evaluation_type=evaluation_db.evaluation_type,  # type: ignore
        variant_ids=variants_ids,
        variant_names=variants_names,
        testset_id=str(evaluation_db.testset_id),
        testset_name=evaluation_db.testset.name,
        variants_revision_ids=variants_revision_ids,
        revisions=revisions,
        created_at=str(evaluation_db.created_at) if evaluation_db.created_at else None,  # type: ignore
        updated_at=str(updated_at) if updated_at else None,  # type: ignore
    )


def human_evaluation_scenario_db_to_pydantic(
    evaluation_scenario_db: HumanEvaluationScenarioDB, evaluation_id: str
) -> HumanEvaluationScenario:
    return HumanEvaluationScenario(
        id=str(evaluation_scenario_db.id),
        evaluation_id=evaluation_id,
        inputs=evaluation_scenario_db.inputs,  # type: ignore
        outputs=evaluation_scenario_db.outputs,  # type: ignore
        vote=evaluation_scenario_db.vote,  # type: ignore
        score=evaluation_scenario_db.score,  # type: ignore
        correct_answer=evaluation_scenario_db.correct_answer,  # type: ignore
        is_pinned=evaluation_scenario_db.is_pinned or False,  # type: ignore
        note=evaluation_scenario_db.note or "",  # type: ignore
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
