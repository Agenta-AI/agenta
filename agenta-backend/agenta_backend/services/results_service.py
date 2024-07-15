import uuid
from typing import Sequence

from agenta_backend.services import db_manager
from agenta_backend.utils.common import isCloudEE
from agenta_backend.models.api.evaluation_model import EvaluationType

if isCloudEE():
    from agenta_backend.commons.models.db_models import (
        HumanEvaluationDB_ as HumanEvaluationDB,
        EvaluationScenarioDB_ as EvaluationScenarioDB,
        HumanEvaluationScenarioDB_ as HumanEvaluationScenarioDB,
    )
else:
    from agenta_backend.models.db_models import (
        HumanEvaluationDB,
        EvaluationScenarioDB,
        HumanEvaluationScenarioDB,
    )


async def fetch_results_for_evaluation(evaluation: HumanEvaluationDB):
    evaluation_scenarios = await db_manager.fetch_human_evaluation_scenarios(
        evaluation_id=str(evaluation.id)
    )

    results = {}
    if len(evaluation_scenarios) == 0:
        return results

    evaluation_variants = await db_manager.fetch_human_evaluation_variants(
        human_evaluation_id=str(evaluation.id)
    )
    results["variants"] = [
        str(evaluation_variant.variant_id) for evaluation_variant in evaluation_variants
    ]

    variant_names: list[str] = []
    for evaluation_variant in evaluation_variants:
        variant_name = (
            evaluation_variant.variant.variant_name
            if isinstance(evaluation_variant.variant_id, uuid.UUID)
            else str(evaluation_variant.variant_id)
        )
        variant_names.append(str(variant_name))

    results["variant_names"] = variant_names
    results["nb_of_rows"] = len(evaluation_scenarios)

    if evaluation.evaluation_type == EvaluationType.human_a_b_testing:  # type: ignore
        results.update(
            await _compute_stats_for_human_a_b_testing_evaluation(evaluation_scenarios)
        )

    return results


async def _compute_stats_for_evaluation(evaluation_scenarios: list, classes: list):
    results = {}
    for cl in classes:
        results[cl] = [
            scenario for scenario in evaluation_scenarios if scenario.score == cl
        ]
    return results


async def _compute_stats_for_human_a_b_testing_evaluation(
    evaluation_scenarios: Sequence[EvaluationScenarioDB],
):
    results = {}
    results["variants_votes_data"] = {}
    results["flag_votes"] = {}
    results["positive_votes"] = {}

    flag_votes_nb = [
        scenario for scenario in evaluation_scenarios if scenario.vote == "0"
    ]

    positive_votes_nb = [
        scenario for scenario in evaluation_scenarios if scenario.vote == "1"
    ]

    results["positive_votes"]["number_of_votes"] = len(positive_votes_nb)
    results["positive_votes"]["percentage"] = (
        round(len(positive_votes_nb) / len(evaluation_scenarios) * 100, 2)
        if len(evaluation_scenarios)
        else 0
    )

    results["flag_votes"]["number_of_votes"] = len(flag_votes_nb)
    results["flag_votes"]["percentage"] = (
        round(len(flag_votes_nb) / len(evaluation_scenarios) * 100, 2)
        if len(evaluation_scenarios)
        else 0
    )

    for scenario in evaluation_scenarios:
        if scenario.vote not in results["variants_votes_data"]:
            results["variants_votes_data"][scenario.vote] = {}
            results["variants_votes_data"][scenario.vote]["number_of_votes"] = 1
        else:
            results["variants_votes_data"][scenario.vote]["number_of_votes"] += 1

    for key, value in results["variants_votes_data"].items():
        value["percentage"] = round(
            value["number_of_votes"] / len(evaluation_scenarios) * 100, 2
        )
    return results


async def fetch_results_for_single_model_test(evaluation_id: str):
    evaluation_scenarios = await db_manager.fetch_human_evaluation_scenarios(
        evaluation_id=str(evaluation_id)
    )
    scores_and_counts = {}
    for evaluation_scenario in evaluation_scenarios:
        score = evaluation_scenario.score
        if isinstance(score, str):
            if score.isdigit():  # Check if the string is a valid integer
                score = int(score)
            else:
                continue  # Skip if the string is not a valid integer

        scores_and_counts[score] = scores_and_counts.get(score, 0) + 1

    return scores_and_counts
