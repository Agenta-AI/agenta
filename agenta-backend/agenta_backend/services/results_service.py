from agenta_backend.utils.common import engine
from agenta_backend.services.db_manager import query
from agenta_backend.models.db_models import EvaluationScenarioDB, EvaluationDB
from agenta_backend.services import evaluation_service
from agenta_backend.models.api.evaluation_model import EvaluationType
from bson import ObjectId


async def fetch_results_for_evaluation(evaluation: EvaluationDB):
    evaluation_scenarios = await engine.find(
        EvaluationScenarioDB, EvaluationScenarioDB.evaluation == ObjectId(evaluation.id)
    )

    results = {}
    if len(evaluation_scenarios) == 0:
        return results

    results["variants"] = [str(variant) for variant in evaluation.variants]
    results["nb_of_rows"] = len(evaluation_scenarios)
    if evaluation.evaluation_type == EvaluationType.human_a_b_testing:
        results.update(
            await _compute_stats_for_human_a_b_testing_evaluation(evaluation_scenarios)
        )
    elif evaluation.evaluation_type == EvaluationType.auto_exact_match:
        results.update(
            await _compute_stats_for_evaluation(
                evaluation_scenarios, classes=["correct", "wrong"]
            )
        )
    elif evaluation.evaluation_type == EvaluationType.auto_similarity_match:
        results.update(
            await _compute_stats_for_evaluation(
                evaluation_scenarios, classes=["true", "false"]
            )
        )
    elif evaluation.evaluation_type == EvaluationType.auto_regex_test:
        results.update(
            await _compute_stats_for_evaluation(
                evaluation_scenarios, classes=["correct", "wrong"]
            )
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


async def fetch_results_for_auto_webhook_test(evaluation_id: str):
    pipeline = [
        {"$match": {"evaluation_id": evaluation_id}},
        {"$group": {"_id": "$score", "count": {"$sum": 1}}},
    ]

    results = {}
    collection = engine.get_collection(EvaluationScenarioDB)
    aggregation_cursor = await collection.aggregate(pipeline).to_list(length=None)
    for doc in aggregation_cursor:
        results[doc["_id"]] = doc["count"]
    return results


async def fetch_results_for_auto_ai_critique(evaluation_id: str):
    pipeline = [
        {"$match": {"evaluation_id": evaluation_id}},
        {"$group": {"_id": "$evaluation", "count": {"$sum": 1}}},
    ]

    results = {}
    collection = engine.get_collection(EvaluationScenarioDB)
    aggregation_cursor = await collection.aggregate(pipeline).to_list(length=None)
    for doc in aggregation_cursor:
        results[doc["_id"]] = doc["count"]
    return results


async def fetch_average_score_for_custom_code_run(evaluation_id: str) -> float:
    query_exp = query.eq(EvaluationScenarioDB.evaluation_id, evaluation_id)
    eval_scenarios = await engine.find(EvaluationScenarioDB, query_exp)

    list_of_scores = []
    for scenario in eval_scenarios:
        score = scenario.score
        if not scenario.score:
            score = 0
        list_of_scores.append(round(float(score), 2))

    average_score = sum(list_of_scores) / len(list_of_scores)
    return average_score
