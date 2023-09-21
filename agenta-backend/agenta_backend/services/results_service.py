from agenta_backend.utills.common import engine
from agenta_backend.services.db_manager import query
from agenta_backend.models.db_models import EvaluationScenarioDB


async def fetch_results_for_human_a_b_testing_evaluation(
    evaluation_id: str, variants: list
):
    results = {}

    # Construct query expression builder for evaluation_rows_nb
    query_exp_one = query.eq(
        EvaluationScenarioDB.evaluation_id, evaluation_id
    ) & query.ne(EvaluationScenarioDB.vote, "")
    evaluation_rows_nb = await engine.count(EvaluationScenarioDB, query_exp_one)
    if evaluation_rows_nb == 0:
        return results

    results["variants"] = variants
    results["variants_votes_data"] = {}
    results["nb_of_rows"] = evaluation_rows_nb

    # Construct query expression builder for flag_votes_nb
    query_exp_two = query.eq(EvaluationScenarioDB.vote, "0") & query.eq(
        EvaluationScenarioDB.evaluation_id, evaluation_id
    )
    flag_votes_nb = await engine.count(EvaluationScenarioDB, query_exp_two)

    # Update results dict
    results["flag_votes"] = {}
    results["flag_votes"]["number_of_votes"] = flag_votes_nb
    results["flag_votes"]["percentage"] = (
        round(flag_votes_nb / evaluation_rows_nb * 100, 2) if evaluation_rows_nb else 0
    )

    for item in variants:
        results["variants_votes_data"][item] = {}

        # Construct query expression builder for variant_votes_nb
        query_exp_three = query.eq(EvaluationScenarioDB.vote, item) & query.eq(
            EvaluationScenarioDB.evaluation_id, evaluation_id
        )
        variant_votes_nb: int = await engine.count(
            EvaluationScenarioDB, query_exp_three
        )
        results["variants_votes_data"][item]["number_of_votes"] = variant_votes_nb
        results["variants_votes_data"][item]["percentage"] = (
            round(variant_votes_nb / evaluation_rows_nb * 100, 2)
            if evaluation_rows_nb
            else 0
        )
    return results


async def fetch_results_for_auto_exact_match_evaluation(
    evaluation_id: str, variant: str
):
    results = {}

    # Construct query expression builder for evaluation_rows_nb
    query_exp_one = query.eq(
        EvaluationScenarioDB.evaluation_id, evaluation_id
    ) & query.ne(EvaluationScenarioDB.score, "")
    evaluation_rows_nb = await engine.count(EvaluationScenarioDB, query_exp_one)

    if evaluation_rows_nb == 0:
        return results

    results["variant"] = variant
    # results["variants_scores_data"] = {}
    results["nb_of_rows"] = evaluation_rows_nb

    # Construct query expression builder for correct_scores_nb
    query_exp_two = query.eq(EvaluationScenarioDB.score, "correct") & query.eq(
        EvaluationScenarioDB.evaluation_id, evaluation_id
    )
    correct_scores_nb = await engine.count(EvaluationScenarioDB, query_exp_two)

    # Construct query expression builder for wrong_scores_nb
    query_exp_three = query.eq(EvaluationScenarioDB.score, "wrong") & query.eq(
        EvaluationScenarioDB.evaluation_id, evaluation_id
    )
    wrong_scores_nb: int = await engine.count(EvaluationScenarioDB, query_exp_three)

    # Update results dict
    results["scores"] = {}
    results["scores"]["correct"] = correct_scores_nb
    results["scores"]["wrong"] = wrong_scores_nb
    return results


async def fetch_results_for_auto_similarity_match_evaluation(
    evaluation_id: str, variant: str
):
    results = {}
    # Construct query expression builder for evaluation_rows_nb
    query_exp_one = query.eq(
        EvaluationScenarioDB.evaluation_id, evaluation_id
    ) & query.ne(EvaluationScenarioDB.score, "")
    evaluation_rows_nb = await engine.count(EvaluationScenarioDB, query_exp_one)

    if evaluation_rows_nb == 0:
        return results

    results["variant"] = variant
    results["nb_of_rows"] = evaluation_rows_nb

    # Construct query expression builder for similar_scores_nb
    query_exp_two = query.eq(EvaluationScenarioDB.score, "true") & query.eq(
        EvaluationScenarioDB.evaluation_id, evaluation_id
    )
    similar_scores_nb = await engine.count(EvaluationScenarioDB, query_exp_two)

    # Construct query expression builder for wrong_scores_nb
    query_exp_three = query.eq(EvaluationScenarioDB.score, "false") & query.eq(
        EvaluationScenarioDB.evaluation_id, evaluation_id
    )
    dissimilar_scores_nb: int = await engine.count(
        EvaluationScenarioDB, query_exp_three
    )

    # Update results dict
    results["scores"] = {}
    results["scores"]["true"] = similar_scores_nb
    results["scores"]["false"] = dissimilar_scores_nb
    return results


async def fetch_results_for_auto_regex_test(evaluation_id: str, variant: str):
    results = {}
    # Construct query expression builder for evaluation_rows_nb
    query_exp_one = query.eq(
        EvaluationScenarioDB.evaluation_id, evaluation_id
    ) & query.ne(EvaluationScenarioDB.score, "")
    evaluation_rows_nb = await engine.count(EvaluationScenarioDB, query_exp_one)

    if evaluation_rows_nb == 0:
        return results

    results["variant"] = variant
    results["nb_of_rows"] = evaluation_rows_nb

    # Construct query expression builder for similar_scores_nb
    query_exp_two = query.eq(EvaluationScenarioDB.score, "correct") & query.eq(
        EvaluationScenarioDB.evaluation_id, evaluation_id
    )
    correct_score = await engine.count(EvaluationScenarioDB, query_exp_two)

    # Construct query expression builder for wrong_scores_nb
    query_exp_three = query.eq(EvaluationScenarioDB.score, "wrong") & query.eq(
        EvaluationScenarioDB.evaluation_id, evaluation_id
    )
    incorrect_score: int = await engine.count(EvaluationScenarioDB, query_exp_three)

    # Update results dict
    results["scores"] = {}
    results["scores"]["correct"] = correct_score
    results["scores"]["wrong"] = incorrect_score
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
