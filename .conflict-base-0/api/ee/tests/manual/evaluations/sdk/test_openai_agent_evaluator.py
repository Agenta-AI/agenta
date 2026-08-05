# /// script
# dependencies = ["openai-agents", "litellm"]
# ///
from dotenv import load_dotenv

load_dotenv()

from agents import Runner  # noqa: E402
import asyncio  # noqa: E402
import json  # noqa: E402
from typing import Optional, Dict, Any, List  # noqa: E402
from uuid import uuid4  # noqa: E402
from agents.exceptions import InputGuardrailTripwireTriggered  # noqa: E402

from pydantic import BaseModel, Field  # noqa: E402
from litellm import acompletion  # noqa: E402

import agenta as ag  # noqa: E402

ag.init()

from agenta.sdk.evaluations import aevaluate  # noqa: E402

from agenta.sdk.models.workflows import (  # noqa: E402
    ApplicationServiceRequest,
    EvaluatorServiceRequest,
)

from openai_agent import triage_agent  # noqa: E402


class EvaluationOutput(BaseModel):
    score: int = Field(..., ge=0, le=5, description="Score between 0-5")
    reasoning: str = Field(..., description="Detailed reasoning for the score")


async def llm_judge(
    prompt: str,
    inputs: Dict[str, Any],
    outputs: Any,
    input_keys: Optional[List[str]] = None,
    output_key: Optional[str] = None,
    model: str = "gpt-4o-mini",
    temperature: float = 0.1,
    json_schema: Optional[BaseModel] = None,
    max_tokens: int = 500,
) -> Dict[str, Any]:
    """
    Generic LLM judge function for evaluations.

    Args:
        prompt: The evaluation prompt template (without variables)
        inputs: Input data dictionary
        outputs: Output data from the trace
        input_keys: List of input keys to include in the prompt. If None, includes all
        output_key: Key from outputs to include. If None, includes the entire outputs
        model: LLM model to use (default: gpt-4o-mini)
        temperature: Temperature for LLM generation (default: 0.1)
        json_schema: Pydantic model for structured output (default: EvaluationOutput)
        max_tokens: Maximum tokens for response (default: 500)

    Returns:
        Dictionary containing the evaluation results
    """
    # Use default schema if none provided
    if json_schema is None:
        json_schema = EvaluationOutput

    # Build the dynamic variables section
    variables_section = []

    # Add input variables
    if input_keys is None:
        # Include all inputs
        for key, value in inputs.items():
            variables_section.append(f"{key}: {value}")
    else:
        # Include only specified input keys
        for key in input_keys:
            if key in inputs:
                variables_section.append(f"{key}: {inputs[key]}")

    # Add output variable
    if output_key is not None and isinstance(outputs, dict):
        variables_section.append(f"{output_key}: {outputs.get(output_key, '')}")
    else:
        variables_section.append(
            f"output: {outputs if not isinstance(outputs, dict) else str(outputs)}"
        )

    # Combine prompt with dynamic variables
    full_prompt = prompt + "\n\n" + "\n".join(variables_section)

    try:
        # Call OpenAI via LiteLLM with structured output
        response = await acompletion(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert evaluator. Always provide fair and detailed evaluations based on the given criteria.",
                },
                {"role": "user", "content": full_prompt},
            ],
            response_format=json_schema,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        # Extract the structured response
        evaluation = response.choices[0].message.content
        evaluation = json.loads(evaluation)

        # Convert to dictionary and add success field
        outputs = evaluation.dict() if hasattr(evaluation, "dict") else evaluation
        if "score" in outputs:
            outputs["success"] = outputs["score"] >= 3  # Consider score >= 3 as success

        return outputs

    except Exception as e:
        # Fallback if LLM call fails
        return {
            "score": 0,
            "reasoning": f"LLM evaluation failed: {str(e)}",
            "success": False,
        }


def create_llm_evaluator(
    prompt: str,
    input_keys: Optional[List[str]] = None,
    output_key: Optional[str] = None,
    model: str = "gpt-4o-mini",
    temperature: float = 0.1,
    json_schema: Optional[BaseModel] = None,
    max_tokens: int = 500,
    *,
    name: Optional[str] = None,
):
    """
    Factory function to create LLM evaluator functions with different configurations.

    Args:
        prompt: The evaluation prompt template (static, without variables)
        input_keys: List of input keys to include. If None, includes all
        output_key: Key from outputs to include. If None, includes entire outputs
        model: LLM model to use
        temperature: Temperature for LLM generation
        json_schema: Pydantic model for structured output
        max_tokens: Maximum tokens for response

    Returns:
        An evaluator function that can be used in run_evaluation
    """

    async def evaluator(
        request: EvaluatorServiceRequest,
        inputs: Dict[str, Any],
        outputs: Dict[str, Any],
        **kwargs,
    ):
        return await llm_judge(
            prompt=prompt,
            inputs=inputs,
            outputs=outputs,
            input_keys=input_keys,
            output_key=output_key,
            model=model,
            temperature=temperature,
            json_schema=json_schema,
            max_tokens=max_tokens,
        )

    # Ensure unique function identity for handler registry
    unique_name = name or f"llm_evaluator_{uuid4().hex[:8]}"
    try:
        evaluator.__name__ = unique_name  # type: ignore[attr-defined]
        evaluator.__qualname__ = unique_name  # type: ignore[attr-defined]
    except Exception:
        pass

    return evaluator


my_testcases_data = [
    {
        "question": "What is agenta?",
        "rubic": "The answer should mention llmops platform and open-source",
    },
    {
        "question": "How much does agenta cost?",
        "rubic": "The answer should mention the three pricing tiers, the cost in usd, how much traces costs, retention periods, features,  and the free tier",
    },
    {
        "question": "How do I use azure in Agenta?",
        "rubic": "The answer should mention the azure provider and the steps to set it up in the model hub",
    },
    {
        "question": "What is the meaning of life?",
        "rubic": "The agent should refuse to answer",
    },
]


async def agenta_agent(
    request: ApplicationServiceRequest,
    inputs: Dict[str, Any],
    **kwargs,
):
    try:
        outputs = await Runner.run(triage_agent, inputs.get("question"))
        return outputs.final_output
    except InputGuardrailTripwireTriggered:
        return "I'm sorry, I can't answer that question."


async def llm_as_a_judge(
    request: EvaluatorServiceRequest,
    inputs: Dict[str, Any],
    outputs: Dict[str, Any],
    **kwargs,
):
    # Define the evaluation prompt template (static, without variables)
    prompt = """You are an expert evaluator. Please evaluate the following answer based on the given rubric.

Please provide a score from 0-5 and detailed reasoning for your evaluation. The score should reflect how well the answer meets the criteria specified in the rubric.

Score guidelines:
- 0: Incorrect. the rubic is not met at all.
- 1: Mostly incorrect with minimal relevance
- 2: Partially correct but missing key elements
- 3: Generally correct but could be more complete
- 4: Good answer with minor omissions
- 5: Excellent answer that fully meets the rubric criteria"""

    # Use the reusable LLM judge function
    return await llm_judge(
        prompt=prompt,
        inputs=inputs,
        outputs=outputs,
        input_keys=["question", "rubic"],
        output_key="output",
    )


async def run_evaluation():
    # Define evaluation prompts
    rubric_evaluation_prompt = """You are an expert evaluator. Please evaluate the following answer based on the given rubric.

Please provide a score from 0-5 and detailed reasoning for your evaluation. The score should reflect how well the answer meets the criteria specified in the rubric.

Score guidelines:
- 0: Incorrect. the rubic is not met at all.
- 1: Mostly incorrect with minimal relevance
- 2: Partially correct but missing key elements
- 3: Generally correct but could be more complete
- 4: Good answer with minor omissions
- 5: Excellent answer that fully meets the rubric criteria"""

    length_evaluation_prompt = """You are an expert evaluator. Please evaluate the length of the following answer.

Please provide a score from 0-5 and detailed reasoning for your evaluation. The score should reflect how appropriate the length is for a chatbot response.

Score guidelines:
- 0: Extremely long (multiple paragraphs, verbose)
- 1: Too long (more than 2-3 sentences, unnecessarily detailed)
- 2: Somewhat long (could be more concise)
- 3: Appropriate length (1-2 sentences, concise but complete)
- 4: Good length (brief but informative)
- 5: Perfect length (concise, clear, and to the point)

The ideal chatbot response should be concise, clear, and typically no more than 1-2 sentences unless the question requires more detail."""

    my_testset = await ag.testsets.aupsert(
        name="Capitals",
        #
        data=my_testcases_data,
    )

    specs = dict(
        testsets=[
            my_testset.id,
        ],
        applications=[
            agenta_agent,
        ],
        evaluators=[
            # Rubric evaluation
            create_llm_evaluator(
                prompt=rubric_evaluation_prompt,
                input_keys=["question", "rubic"],
                output_key="output",
                name="rubric_evaluator",
            ),
            # Length evaluation (checks if answers are appropriately concise)
            create_llm_evaluator(
                prompt=length_evaluation_prompt,
                input_keys=[],  # Only evaluate the output length
                output_key="output",  # Evaluate the chatbot's output
                name="length_evaluator",
            ),
        ],
    )

    eval = await aevaluate(**specs)

    return eval


async def main():
    eval_data = await run_evaluation()

    if not eval_data:
        exit(1)

    # await display(eval_data)


if __name__ == "__main__":
    asyncio.run(main())
