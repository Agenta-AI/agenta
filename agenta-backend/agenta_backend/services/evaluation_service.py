from typing import Dict
from datetime import datetime
from agenta_backend.models.api.evaluation_model import (
    Evaluation,
    EvaluationType,
    NewEvaluation,
    EvaluationScenarioUpdate,
    EvaluationStatus,
)
from fastapi import HTTPException
from bson import ObjectId
from agenta_backend.services.db_mongo import (
    evaluations,
    evaluation_scenarios,
    testsets,
)

from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate


class UpdateEvaluationScenarioError(Exception):
    """Custom exception for update evaluation scenario errors."""

    pass


async def create_new_evaluation(newEvaluationData: NewEvaluation) -> Dict:
    evaluation = newEvaluationData.dict()
    evaluation["created_at"] = evaluation["updated_at"] = datetime.utcnow()

    newEvaluation = await evaluations.insert_one(evaluation)

    if not newEvaluation.acknowledged:
        raise HTTPException(
            status_code=500, detail="Failed to create evaluation_scenario"
        )

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
                status_code=400, detail=msg,
            )

        evaluation_scenario = {
            "evaluation_id": str(newEvaluation.inserted_id),
            "inputs": inputs,
            "outputs": [],
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }

        evaluation_scenario = {
            **evaluation_scenario,
            **extend_with_evaluation(newEvaluationData.evaluation_type),
            **extend_with_correct_answer(newEvaluationData.evaluation_type, datum),
        }

        await evaluation_scenarios.insert_one(evaluation_scenario)

    evaluation["id"] = str(newEvaluation.inserted_id)
    return evaluation


async def update_evaluation_status(
    evaluation_id: str, status: EvaluationStatus
) -> Evaluation:
    result = await evaluations.update_one(
        {"_id": ObjectId(evaluation_id)}, {"$set": {"status": status.value}}
    )
    if result.acknowledged:
        doc = await evaluations.find_one({"_id": ObjectId(evaluation_id)})
        if doc:
            doc["id"] = str(doc["_id"])
            del doc["_id"]
            return Evaluation(**doc)
    else:
        raise UpdateEvaluationScenarioError("Failed to update evaluation status")


async def update_evaluation_scenario(
    evaluation_scenario_id: str,
    evaluation_scenario_data: EvaluationScenarioUpdate,
    evaluation_type: EvaluationType,
) -> Dict:
    evaluation_scenario_dict = evaluation_scenario_data.dict()
    evaluation_scenario_dict["updated_at"] = datetime.utcnow()

    new_evaluation_set = {"outputs": evaluation_scenario_dict["outputs"]}

    if (
        evaluation_type == EvaluationType.auto_exact_match
        or evaluation_type == EvaluationType.auto_similarity_match
    ):
        new_evaluation_set["score"] = evaluation_scenario_dict["score"]
    elif evaluation_type == EvaluationType.human_a_b_testing:
        new_evaluation_set["vote"] = evaluation_scenario_dict["vote"]
    elif evaluation_type == EvaluationType.auto_ai_critique:
        current_evaluation_scenario = await evaluation_scenarios.find_one(
            {"_id": ObjectId(evaluation_scenario_id)}
        )
        current_evaluation = await evaluations.find_one(
            {"_id": ObjectId(current_evaluation_scenario["evaluation_id"])}
        )

        evaluation = evaluate_with_ai_critique(
            llm_app_prompt_template=current_evaluation["llm_app_prompt_template"],
            llm_app_inputs=current_evaluation_scenario["inputs"],
            correct_answer=current_evaluation_scenario["correct_answer"],
            app_variant_output=new_evaluation_set["outputs"][0]["variant_output"],
            evaluation_prompt_template=evaluation_scenario_dict[
                "evaluation_prompt_template"
            ],
            open_ai_key=evaluation_scenario_dict["open_ai_key"],
        )

        new_evaluation_set["evaluation"] = evaluation

    result = await evaluation_scenarios.update_one(
        {"_id": ObjectId(evaluation_scenario_id)}, {"$set": new_evaluation_set}
    )
    if result.acknowledged:
        evaluation_scenario = await evaluation_scenarios.find_one(
            {"_id": ObjectId(evaluation_scenario_id)}
        )

        if evaluation_scenario:
            evaluation_scenario["id"] = str(evaluation_scenario["_id"])
            del evaluation_scenario["_id"]
            return evaluation_scenario

    raise UpdateEvaluationScenarioError("Failed to create evaluation_scenario")


def evaluate_with_ai_critique(
    llm_app_prompt_template: str,
    llm_app_inputs: dict,
    correct_answer: str,
    app_variant_output: str,
    evaluation_prompt_template: str,
    open_ai_key: str,
    temperature: float = 0.9,
) -> str:
    """Evaluate a response using an AI critique based on provided
     - An evaluation prompt,
     - An LLM App prompt,
     - An LLM App output,
     - a correct answer.

    Args:
        llm_app_prompt_template (str): the prompt template of the llm app variant
        llm_app_inputs (dict): parameters
        correct_answer (str): correct answer
        app_variant_output (str): the output of an ll app variant with given parameters
        evaluation_prompt_template (str): evaluation prompt set by an agenta user in the ai evaluation view

    Returns:
        str: returns an evaluation
    """
    llm = OpenAI(openai_api_key=open_ai_key, temperature=temperature)

    input_variables = [
        "app_variant_output",
        "llm_app_prompt_template",
        "correct_answer",
    ]

    for input_item in llm_app_inputs:
        input_variables.append(input_item["input_name"])

    chain_run_args = {
        "llm_app_prompt_template": llm_app_prompt_template,
        "correct_answer": correct_answer,
        "app_variant_output": app_variant_output,
    }

    for input_item in llm_app_inputs:
        chain_run_args[input_item["input_name"]] = input_item["input_value"]

    prompt = PromptTemplate(
        input_variables=input_variables, template=evaluation_prompt_template
    )
    chain = LLMChain(llm=llm, prompt=prompt)

    output = chain.run(**chain_run_args)
    return output.strip()


def extend_with_evaluation(evaluation_type: EvaluationType):
    evaluation = {}
    if (
        evaluation_type == EvaluationType.auto_exact_match
        or evaluation_type == EvaluationType.auto_similarity_match
    ):
        evaluation["score"] = ""

    if evaluation_type == EvaluationType.human_a_b_testing:
        evaluation["vote"] = ""

    if evaluation_type == EvaluationType.auto_ai_critique:
        evaluation["evaluation"] = ""
    return evaluation


def extend_with_correct_answer(evaluation_type: EvaluationType, row: dict):
    correct_answer = {}
    if (
        evaluation_type == EvaluationType.auto_exact_match
        or evaluation_type == EvaluationType.auto_similarity_match
        or evaluation_type == EvaluationType.auto_ai_critique
    ):
        if row["correct_answer"]:
            correct_answer["correct_answer"] = row["correct_answer"]
    return correct_answer
