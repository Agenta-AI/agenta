"""
Factual Accuracy Evaluator (LLM-as-a-Judge)
============================================

Uses OpenAI API to evaluate factual accuracy of outputs.
"""

from typing import Dict, Union, Any
import json
import os


def evaluate(
    app_params: Dict[str, str],
    inputs: Dict[str, str],
    output: Union[str, Dict[str, Any]],
    correct_answer: str
) -> float:
    """
    Uses OpenAI LLM-as-a-judge to evaluate factual accuracy.

    Makes an actual OpenAI API call with a hardcoded prompt to assess
    whether the output is factually accurate compared to the expected answer.

    Args:
        app_params: Should contain 'openai_api_key' (or uses env var)
        inputs: Original input/question
        output: LLM output to evaluate
        correct_answer: Expected correct answer

    Returns:
        float: Score between 0.0 and 1.0 based on factual accuracy

    Example:
        output = "Paris is the capital of France"
        correct_answer = "Paris"
        Returns: 1.0 (factually accurate)
    """
    try:
        from openai import OpenAI
    except ImportError:
        # OpenAI not installed, return neutral score
        return 0.5

    try:
        # Get API key
        api_key = app_params.get('openai_api_key') or os.environ.get('OPENAI_API_KEY')
        if not api_key:
            return 0.0

        # Initialize client
        client = OpenAI(api_key=api_key)

        # Convert output to string
        if isinstance(output, dict):
            output_str = json.dumps(output)
        else:
            output_str = str(output)

        # Hardcoded LLM-as-a-judge prompt
        judge_prompt = f"""You are an expert evaluator assessing the factual accuracy of an AI response.

INPUT QUESTION:
{inputs.get('question', inputs.get('prompt', 'N/A'))}

EXPECTED ANSWER:
{correct_answer}

ACTUAL OUTPUT:
{output_str}

TASK:
Evaluate if the actual output is factually accurate compared to the expected answer.
Consider:
- Are the key facts correct?
- Is the information aligned with the expected answer?
- Are there any factual errors or hallucinations?

Respond with ONLY a JSON object in this exact format:
{{"score": <float between 0.0 and 1.0>, "reasoning": "<brief explanation>"}}

Where:
- 1.0 = Completely factually accurate
- 0.7-0.9 = Mostly accurate with minor issues
- 0.4-0.6 = Partially accurate
- 0.1-0.3 = Mostly inaccurate
- 0.0 = Completely inaccurate or wrong"""

        # Make API call
        response = client.chat.completions.create(
            model=app_params.get('model', 'gpt-4o-mini'),
            messages=[
                {"role": "system", "content": "You are a precise evaluator. Respond only with valid JSON."},
                {"role": "user", "content": judge_prompt}
            ],
            temperature=0.0,
            max_tokens=500
        )

        # Parse response
        result_text = response.choices[0].message.content.strip()

        # Try to extract JSON
        if '```json' in result_text:
            result_text = result_text.split('```json')[1].split('```')[0].strip()
        elif '```' in result_text:
            result_text = result_text.split('```')[1].split('```')[0].strip()

        result = json.loads(result_text)
        score = float(result.get('score', 0.0))

        # Ensure score is in valid range
        return max(0.0, min(1.0, score))

    except Exception as e:
        # On any error, return 0.0
        return 0.0
