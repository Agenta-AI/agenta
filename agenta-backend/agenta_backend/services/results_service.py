from agenta_backend.services.db_mongo import evaluation_scenarios
from bson import ObjectId


async def fetch_results_for_human_a_b_testing_evaluation(
    evaluation_id: str, variants: list
):
    results = {}
    evaluation_rows_nb = await evaluation_scenarios.count_documents(
        {"evaluation_id": evaluation_id, "vote": {"$ne": ""}}
    )

    if evaluation_rows_nb == 0:
        return results

    results["variants"] = variants
    results["variants_votes_data"] = {}
    results["nb_of_rows"] = evaluation_rows_nb

    flag_votes_nb = await evaluation_scenarios.count_documents(
        {"vote": "0", "evaluation_id": evaluation_id}
    )
    results["flag_votes"] = {}
    results["flag_votes"]["number_of_votes"] = flag_votes_nb
    results["flag_votes"]["percentage"] = (
        round(flag_votes_nb / evaluation_rows_nb * 100, 2) if evaluation_rows_nb else 0
    )

    for item in variants:
        results["variants_votes_data"][item] = {}
        variant_votes_nb: int = await evaluation_scenarios.count_documents(
            {"vote": item, "evaluation_id": evaluation_id}
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
    evaluation_rows_nb = await evaluation_scenarios.count_documents(
        {"evaluation_id": evaluation_id, "score": {"$ne": ""}}
    )

    if evaluation_rows_nb == 0:
        return results

    results["variant"] = variant
    # results["variants_scores_data"] = {}
    results["nb_of_rows"] = evaluation_rows_nb

    correct_scores_nb: int = await evaluation_scenarios.count_documents(
        {"score": "correct", "evaluation_id": evaluation_id}
    )

    wrong_scores_nb: int = await evaluation_scenarios.count_documents(
        {"score": "wrong", "evaluation_id": evaluation_id}
    )
    results["scores"] = {}
    results["scores"]["correct"] = correct_scores_nb
    results["scores"]["wrong"] = wrong_scores_nb
    return results


async def fetch_results_for_auto_similarity_match_evaluation(
    evaluation_id: str, variant: str
):
    results = {}
    evaluation_rows_nb = await evaluation_scenarios.count_documents(
        {"evaluation_id": evaluation_id, "score": {"$ne": ""}}
    )

    if evaluation_rows_nb == 0:
        return results

    results["variant"] = variant
    results["nb_of_rows"] = evaluation_rows_nb

    similar_scores_nb: int = await evaluation_scenarios.count_documents(
        {"score": "true", "evaluation_id": evaluation_id}
    )

    dissimilar_scores_nb: int = await evaluation_scenarios.count_documents(
        {"score": "false", "evaluation_id": evaluation_id}
    )
    results["scores"] = {}
    results["scores"]["true"] = similar_scores_nb
    results["scores"]["false"] = dissimilar_scores_nb
    return results


async def fetch_results_for_auto_ai_critique(evaluation_id: str):
    pipeline = [
        {"$match": {"evaluation_id": evaluation_id}},
        {"$group": {
            "_id": "$evaluation",
            "count": {"$sum": 1}
        }}
    ]

    results = {}
    aggregation_cursor = evaluation_scenarios.aggregate(pipeline)

    async for doc in aggregation_cursor:
        results[doc["_id"]] = doc["count"]

    return results
