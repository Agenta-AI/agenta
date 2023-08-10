from fastapi import HTTPException, APIRouter, Body
from agenta_backend.models.api.evaluation_model import (
    Evaluation,
    EvaluationScenario,
    EvaluationScenarioUpdate,
    NewEvaluation,
    DeleteEvaluation,
    EvaluationType,
)
from agenta_backend.services.db_mongo import (
    evaluations,
    evaluation_scenarios,
    testsets,
)
from datetime import datetime
from bson import ObjectId
from typing import List, Optional

router = APIRouter()


@router.post("/", response_model=Evaluation)
async def create_evaluation(
    newEvaluationData: NewEvaluation = Body(...),
):
    """Creates a new comparison table document

    Raises:
        HTTPException: _description_

    Returns:
        _description_
    """
    evaluation = newEvaluationData.dict()
    evaluation["created_at"] = evaluation["updated_at"] = datetime.utcnow()

    newEvaluation = await evaluations.insert_one(evaluation)

    if newEvaluation.acknowledged:
        testsetId = evaluation["testset"]["_id"]
        testset = await testsets.find_one({"_id": ObjectId(testsetId)})
        csvdata = testset["csvdata"]
        for datum in csvdata:
            try:
                inputs = [
                    {"input_name": name, "input_value": datum[name]}
                    for name in evaluation["inputs"]
                ]
            except KeyError:
                await evaluations.delete_one({"_id": newEvaluation.inserted_id})
                msg = f"""
                Columns in the test set should match the names of the inputs in the variant.
                Inputs names in variant are: {evaluation['inputs']} while
                columns in test set are: {[col for col in datum.keys() if col != 'correct_answer']}
                """
                raise HTTPException(
                    status_code=400,
                    detail=msg,
                )
            evaluation_scenario = {
                "evaluation_id": str(newEvaluation.inserted_id),
                "inputs": inputs,
                "outputs": [],
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
            }

            if newEvaluationData.evaluation_type == EvaluationType.auto_exact_match:
                evaluation_scenario["score"] = ""
                if "correct_answer" in datum:
                    evaluation_scenario["correct_answer"] = datum["correct_answer"]

            if (
                newEvaluationData.evaluation_type
                == EvaluationType.auto_similarity_match
            ):
                evaluation_scenario["score"] = ""
                if "correct_answer" in datum:
                    evaluation_scenario["correct_answer"] = datum["correct_answer"]

            if newEvaluationData.evaluation_type == EvaluationType.human_a_b_testing:
                evaluation_scenario["vote"] = ""

            await evaluation_scenarios.insert_one(evaluation_scenario)

        evaluation["id"] = str(newEvaluation.inserted_id)
        return evaluation
    else:
        raise HTTPException(
            status_code=500, detail="Failed to create evaluation_scenario"
        )


@router.get(
    "/{evaluation_id}/evaluation_scenarios",
    response_model=List[EvaluationScenario],
)
async def fetch_evaluation_scenarios(evaluation_id: str):
    """Creates an empty evaluation row

    Arguments:
        evaluation_scenario -- _description_

    Raises:
        HTTPException: _description_

    Returns:
        _description_
    """
    cursor = evaluation_scenarios.find({"evaluation_id": evaluation_id})
    items = await cursor.to_list(length=100)  # limit length to 100 for the example
    for item in items:
        item["id"] = str(item["_id"])
    return items


@router.post("/{evaluation_id}/evaluation_scenario", response_model=EvaluationScenario)
async def create_evaluation_scenario(evaluation_scenario: EvaluationScenario):
    """Creates an empty evaluation row

    Arguments:
        evaluation_scenario -- _description_

    Raises:
        HTTPException: _description_

    Returns:
        _description_
    """
    evaluation_scenario_dict = evaluation_scenario.dict()
    evaluation_scenario_dict.pop("id", None)

    evaluation_scenario_dict["created_at"] = evaluation_scenario_dict[
        "updated_at"
    ] = datetime.utcnow()
    result = await evaluation_scenarios.insert_one(evaluation_scenario_dict)
    if result.acknowledged:
        evaluation_scenario_dict["id"] = str(result.inserted_id)
        return evaluation_scenario_dict
    else:
        raise HTTPException(
            status_code=500, detail="Failed to create evaluation_scenario"
        )


@router.put(
    "/{evaluation_id}/evaluation_scenario/{evaluation_scenario_id}/{evaluation_type}"
)
async def update_evaluation_scenario(
    evaluation_scenario_id: str,
    evaluation_scenario: EvaluationScenarioUpdate,
    evaluation_type: EvaluationType,
):
    """Updates an evaluation row with a vote

    Arguments:
        evaluation_scenario_id -- _description_
        evaluation_scenario -- _description_

    Raises:
        HTTPException: _description_

    Returns:
        _description_
    """
    evaluation_scenario_dict = evaluation_scenario.dict()
    evaluation_scenario_dict["updated_at"] = datetime.utcnow()

    new_evaluation_set = {"outputs": evaluation_scenario_dict["outputs"]}

    if (
        evaluation_type == EvaluationType.auto_exact_match
        or evaluation_type == EvaluationType.auto_similarity_match
    ):
        new_evaluation_set["score"] = evaluation_scenario_dict["score"]
    elif evaluation_type == EvaluationType.human_a_b_testing:
        new_evaluation_set["vote"] = evaluation_scenario_dict["vote"]

    result = await evaluation_scenarios.update_one(
        {"_id": ObjectId(evaluation_scenario_id)}, {"$set": new_evaluation_set}
    )
    if result.acknowledged:
        return evaluation_scenario_dict
    else:
        raise HTTPException(
            status_code=500, detail="Failed to create evaluation_scenario"
        )


@router.get("/", response_model=List[Evaluation])
async def fetch_list_evaluations(app_name: Optional[str] = None):
    """lists of all comparison tables

    Returns:
        _description_
    """
    cursor = evaluations.find({"app_name": app_name}).sort("created_at", -1)
    items = await cursor.to_list(length=100)  # limit length to 100 for the example
    for item in items:
        item["id"] = str(item["_id"])
    return items


@router.get("/{evaluation_id}", response_model=Evaluation)
async def fetch_evaluation(evaluation_id: str):
    """Fetch one comparison table

    Returns:
        _description_
    """
    evaluation = await evaluations.find_one({"_id": ObjectId(evaluation_id)})
    if evaluation:
        evaluation["id"] = str(evaluation["_id"])
        return evaluation
    else:
        raise HTTPException(
            status_code=404, detail=f"dataset with id {evaluation_id} not found"
        )


@router.delete("/", response_model=List[str])
async def delete_evaluations(delete_evaluations: DeleteEvaluation):
    """
    Delete specific comparison tables based on their unique IDs.

    Args:
    delete_evaluations (List[str]): The unique identifiers of the comparison tables to delete.

    Returns:
    A list of the deleted comparison tables' IDs.
    """
    deleted_ids = []

    for evaluations_id in delete_evaluations.evaluations_ids:
        evaluation = await evaluations.find_one({"_id": ObjectId(evaluations_id)})

        if evaluation is not None:
            result = await evaluations.delete_one({"_id": ObjectId(evaluations_id)})
            if result:
                deleted_ids.append(evaluations_id)
        else:
            raise HTTPException(
                status_code=404,
                detail=f"Comparison table {evaluations_id} not found",
            )

    return deleted_ids


@router.get("/{evaluation_id}/results")
async def fetch_results(evaluation_id: str):
    """Fetch all the results for one the comparison table

    Arguments:
        evaluation_id -- _description_

    Returns:
        _description_
    """
    evaluation = await evaluations.find_one({"_id": ObjectId(evaluation_id)})

    if evaluation["evaluation_type"] == EvaluationType.human_a_b_testing:
        results = await fetch_results_for_human_a_b_testing_evaluation(
            evaluation_id, evaluation.get("variants", [])
        )
        # TODO: replace votes_data by results_data
        return {"votes_data": results}

    elif evaluation["evaluation_type"] == EvaluationType.auto_exact_match:
        results = await fetch_results_for_auto_exact_match_evaluation(
            evaluation_id, evaluation.get("variant", [])
        )
        return {"scores_data": results}

    elif evaluation["evaluation_type"] == EvaluationType.auto_similarity_match:
        results = await fetch_results_for_auto_similarity_match_evaluation(
            evaluation_id, evaluation.get("variant", [])
        )
        return {"scores_data": results}


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
