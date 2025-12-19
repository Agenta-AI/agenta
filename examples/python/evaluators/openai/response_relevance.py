"""
Response Relevance Evaluator (LLM-as-a-Judge)
==============================================

Uses OpenAI API to evaluate how relevant the output is to the input.
"""

from typing import Dict, Union, Any
import json
import os


def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],
    correct_answer: str,
) -> float:
    """
    Uses OpenAI LLM-as-a-judge to evaluate response relevance.

    Makes an actual OpenAI API call to assess whether the output is
    relevant and responsive to the input question/prompt.

    Args:
        app_params: Should contain 'openai_api_key' (or uses env var)
        inputs: Original input/question
        output: LLM output to evaluate
        correct_answer: Not used (can be empty)

    Returns:
        float: Score between 0.0 and 1.0 based on relevance

    Example:
        inputs = {"question": "What is the capital of France?"}
        output = "Paris is the capital of France."
        Returns: 1.0 (highly relevant)
    """
    try:
        from openai import OpenAI
    except ImportError:
        return 0.5

    try:
        # Get API key
        api_key = app_params.get("openai_api_key") or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            return 0.0

        # Initialize client
        client = OpenAI(api_key=api_key)

        # Convert output to string
        if isinstance(output, dict):
            output_str = json.dumps(output)
        else:
            output_str = str(output)

        # Get input question/prompt
        question = inputs.get(
            "question", inputs.get("prompt", inputs.get("input", "N/A"))
        )

        # Hardcoded LLM-as-a-judge prompt
        judge_prompt = f"""
You are an expert evaluator assessing the relevance of an AI response.

ORIGINAL QUESTION/INPUT:
{question}

AI RESPONSE:
{output_str}

TASK:
Evaluate how relevant and responsive the AI response is to the original question.
Consider:
- Does the response directly address the question?
- Is the information provided on-topic?
- Does it answer what was asked?
- Is there unnecessary information or tangents?

Respond with ONLY a JSON object in this exact format:
{{"score": <float between 0.0 and 1.0>, "reasoning": "<brief explanation>"}}

Where:
- 1.0 = Perfectly relevant, directly answers the question
- 0.7-0.9 = Mostly relevant with minor off-topic elements
- 0.4-0.6 = Partially relevant
- 0.1-0.3 = Mostly irrelevant
- 0.0 = Completely irrelevant or doesn't address the question
"""

        # Make API call
        response = client.chat.completions.create(
            model=app_params.get("model", "gpt-4o-mini"),
            messages=[
                {
                    "role": "system",
                    "content": "You are a precise evaluator. Respond only with valid JSON.",
                },
                {"role": "user", "content": judge_prompt},
            ],
            temperature=0.0,
            max_tokens=500,
        )

        # Parse response
        result_text = response.choices[0].message.content.strip()

        # Try to extract JSON
        if "```json" in result_text:
            result_text = result_text.split("```json")[1].split("```")[0].strip()
        elif "```" in result_text:
            result_text = result_text.split("```")[1].split("```")[0].strip()

        result = json.loads(result_text)
        score = float(result.get("score", 0.0))

        return max(0.0, min(1.0, score))

    except Exception:
        return 0.0
