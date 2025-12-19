"""
Coherence & Quality Evaluator (LLM-as-a-Judge)
===============================================

Uses OpenAI API to evaluate coherence and overall quality of outputs.
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
    Uses OpenAI LLM-as-a-judge to evaluate coherence and quality.

    Makes an actual OpenAI API call to assess the overall quality,
    coherence, and readability of the output.

    Args:
        app_params: Should contain 'openai_api_key' (or uses env var)
        inputs: Original input/question
        output: LLM output to evaluate
        correct_answer: Not used (can be empty)

    Returns:
        float: Score between 0.0 and 1.0 based on coherence/quality

    Example:
        output = "The sky is blue. It contains nitrogen and oxygen."
        Returns: ~0.9 (coherent and well-written)
    """
    try:
        from openai import OpenAI
    except ImportError:
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
        judge_prompt = f"""You are an expert evaluator assessing the coherence and quality of an AI response.

AI RESPONSE TO EVALUATE:
{output_str}

TASK:
Evaluate the overall coherence and quality of the response.
Consider:
- Is the response coherent and logically structured?
- Is the language clear and well-written?
- Are sentences properly formed?
- Is the information presented in a logical flow?
- Is it easy to understand?
- Are there grammatical or spelling errors?

Respond with ONLY a JSON object in this exact format:
{{"score": <float between 0.0 and 1.0>, "reasoning": "<brief explanation>"}}

Where:
- 1.0 = Excellent quality, perfectly coherent
- 0.7-0.9 = Good quality with minor issues
- 0.4-0.6 = Acceptable but has coherence problems
- 0.1-0.3 = Poor quality, hard to follow
- 0.0 = Incoherent or unintelligible"""

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

        return max(0.0, min(1.0, score))

    except Exception:
        return 0.0
