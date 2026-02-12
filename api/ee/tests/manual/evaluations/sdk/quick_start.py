"""
Agenta SDK Quick Start Tutorial
================================

This tutorial demonstrates how to:
1. Create a simple application that returns country capitals
2. Create evaluators to check if the application's output is correct
3. Run an evaluation to test your application

The new @application and @evaluator decorators make this simple and intuitive!
"""

from dotenv import load_dotenv

load_dotenv()

import asyncio  # noqa: E402
import random  # noqa: E402

from agenta.sdk.evaluations import aevaluate  # noqa: E402

import agenta as ag  # noqa: E402
from agenta.sdk.workflows import builtin  # noqa: E402

# Initialize Agenta SDK
ag.init()


# Test data: countries and their capitals
my_testcases_data = [
    {"country": "Germany", "capital": "Berlin"},
    {"country": "France", "capital": "Paris"},
    {"country": "Spain", "capital": "Madrid"},
    {"country": "Italy", "capital": "Rome"},
]


# ============================================================================
# STEP 1: Define your application
# ============================================================================


@ag.application(
    slug="capital_quiz_app",
    #
    name="Capital Quiz Application",
    description="Returns the capital of a given country (sometimes incorrectly for testing)",
)
async def capital_quiz_app(capital: str, country: str):
    """
    A simple application that returns country capitals.

    Args:
        capital: The expected capital (from testcase)
        country: The country name (from testcase)

    Returns:
        The capital city name (sometimes wrong for testing purposes)
    """
    # Randomly return wrong answer for testing
    chance = random.choice([True, False, True])
    return capital if chance else "Aloha"


# ============================================================================
# STEP 2: Define your evaluators
# ============================================================================


@ag.evaluator(
    slug="exact_match_evaluator",
    #
    name="Exact Match Evaluator",
    description="Checks if the application's output exactly matches the expected capital",
)
async def exact_match_evaluator(capital: str, outputs: str):
    """
    Evaluates if the application's output matches the expected answer.

    Args:
        capital: The expected capital (from testcase)
        outputs: What the application returned

    Returns:
        Dictionary with score and success flag
    """
    is_correct = outputs == capital
    return {
        "score": 1 if is_correct else 0,
        "success": is_correct,
    }


@ag.evaluator(
    slug="random_score_evaluator",
    #
    name="Random Score Evaluator",
    description="Assigns a random score (for demonstration purposes)",
)
async def random_score_evaluator(capital: str):
    """
    A demo evaluator that assigns random scores.

    Args:
        capital: The expected capital (from testcase, not used but shows it's available)

    Returns:
        Dictionary with random score
    """
    score = random.randint(0, 100)
    return {
        "myscore": score,
        "success": score > 30,
    }


# ============================================================================
# STEP 3: Use builtin evaluators
# ============================================================================

# You can also use Agenta's builtin evaluators like LLM-as-a-judge
llm_judge_evaluator = builtin.auto_ai_critique(
    slug="llm_judge_evaluator",
    #
    name="LLM Judge Evaluator",
    description="Uses an LLM to judge if the answer is correct",
    #
    correct_answer_key="capital",
    prompt_template=[
        {
            "role": "system",
            "content": "You are a judge that evaluates geography knowledge.",
        },
        {
            "role": "user",
            "content": (
                "The correct capital is: {{capital}}\n"
                "The student's answer is: {{outputs}}\n\n"
                "Is the student's answer correct?\n"
                "Respond with ONLY a number from 0.0 (completely wrong) to 1.0 (completely correct).\n"
                "Nothing else - just the number."
            ),
        },
    ],
)


# ============================================================================
# STEP 4: Run the evaluation
# ============================================================================


async def run_evaluation():
    """Create a testset and run evaluation with your app and evaluators."""

    # Create a testset from your test data
    print("Creating testset...")
    my_testset = await ag.testsets.aupsert(
        name="Country Capitals",
        data=my_testcases_data,
    )

    if not my_testset or not my_testset.id:
        print("❌ Failed to create testset")
        return None

    print(f"✅ Testset created with {len(my_testcases_data)} test cases\n")

    # Run evaluation
    print("Running evaluation...")
    eval_result = await aevaluate(
        name="My First Eval",
        testsets=[my_testset.id],
        applications=[capital_quiz_app],
        evaluators=[
            exact_match_evaluator,
            random_score_evaluator,
            llm_judge_evaluator,
        ],
    )

    return eval_result


async def main():
    """Main entry point."""
    print("=" * 70)
    print("Agenta SDK Quick Start Tutorial")
    print("=" * 70)
    print()

    eval_data = await run_evaluation()

    if not eval_data:
        print("❌ Evaluation failed")
        exit(1)

    print("\n" + "=" * 70)
    print("Evaluation Results")
    print("=" * 70)
    # await display(eval_data)

    print("\n✅ Tutorial complete!")


if __name__ == "__main__":
    asyncio.run(main())
