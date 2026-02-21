import asyncio

import agenta as ag

from agenta.sdk.evaluations import aevaluate

# Initialize SDK
ag.init()

# Define test data
test_data = [
    {"country": "Germany", "capital": "Berlin"},
    {"country": "France", "capital": "Paris"},
    {"country": "Spain", "capital": "Madrid"},
    {"country": "Italy", "capital": "Rome"},
]


# Create application
@ag.application(
    slug="capital_finder",
    name="Capital Finder",
)
async def capital_finder(country: str):
    capitals = {
        "Germany": "Berlin",
        "France": "Paris",
        "Spain": "Madrid",
        "Italy": "Rome",
    }
    return capitals.get(country, "Unknown")


# Create evaluator
@ag.evaluator(
    slug="exact_match",
    name="Exact Match",
)
async def exact_match(capital: str, outputs: str):
    is_correct = outputs == capital
    return {
        "score": 1.0 if is_correct else 0.0,
        "success": is_correct,
    }


# Run evaluation
async def main():
    testset = await ag.testsets.acreate(
        name="Country Capitals",
        data=test_data,
    )

    await aevaluate(
        testsets=[testset.id],
        applications=[capital_finder],
        evaluators=[exact_match],
    )

    print("Evaluation complete!")


if __name__ == "__main__":
    asyncio.run(main())
