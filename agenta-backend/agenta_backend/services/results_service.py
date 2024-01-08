from agenta_backend.models.db_models import (
    EvaluationScenarioDB,
    EvaluationDB,
    HumanEvaluationDB,
    HumanEvaluationScenarioDB,
)
from agenta_backend.services import evaluation_service
from agenta_backend.services import db_manager
from agenta_backend.models.api.evaluation_model import EvaluationType
from bson import ObjectId


async def fetch_results_for_evaluation(evaluation: HumanEvaluationDB):
    evaluation_scenarios = await HumanEvaluationScenarioDB.find(
        HumanEvaluationScenarioDB.evaluation.id == ObjectId(evaluation.id),
    ).to_list()

    results = {}
    if len(evaluation_scenarios) == 0:
        return results

    results["variants"] = [str(variant) for variant in evaluation.variants]
    variant_names = []
    for variant_id in evaluation.variants:
        variant = await db_manager.get_app_variant_instance_by_id(str(variant_id))
        variant_name = variant.variant_name if variant else str(variant_id)
        variant_names.append(str(variant_name))
    results["variant_names"] = variant_names
    results["nb_of_rows"] = len(evaluation_scenarios)
    if evaluation.evaluation_type == EvaluationType.human_a_b_testing:
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


async def _compute_stats_for_human_a_b_testing_evaluation(evaluation_scenarios: list):
    results = {}
    results["variants_votes_data"] = {}
    results["flag_votes"] = {}

    flag_votes_nb = [
        scenario for scenario in evaluation_scenarios if scenario.vote == "0"
    ]
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
    results = await HumanEvaluationScenarioDB.find(
        HumanEvaluationScenarioDB.evaluation.id == ObjectId(evaluation_id)
    ).to_list()
    scores_and_counts = {}
    for result in results:
        score = result.score
        scores_and_counts[score] = scores_and_counts.get(score, 0) + 1
    return scores_and_counts


async def fetch_average_score_for_custom_code_run(evaluation_id: str) -> float:
    eval_scenarios = await EvaluationScenarioDB.find(
        EvaluationScenarioDB.evaluation.id == ObjectId(evaluation_id)
    ).to_list()

    list_of_scores = []
    for scenario in eval_scenarios:
        score = scenario.score
        if not scenario.score:
            score = 0
        list_of_scores.append(round(float(score), 2))

    average_score = sum(list_of_scores) / len(list_of_scores)
    return average_score
