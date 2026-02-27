"""
End-to-end RAG evaluation using DeepEval metrics + Agenta runtime.

Runs the full RAG pipeline (retrieve → generate) against a test set,
then scores each output with DeepEval's RAG metrics. Results (with full
traces) land in the Agenta UI.

Usage:
    cd ~/code/agenta/agenta/examples/python/RAG_QA_chatbot
    .venv/bin/python eval_e2e.py
"""

import asyncio
import sys
from pathlib import Path

# ── Environment ──────────────────────────────────────────
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import agenta as ag
import litellm
from agenta.sdk.evaluations import aevaluate
from deepeval.metrics import (
    AnswerRelevancyMetric,
    ContextualRelevancyMetric,
    FaithfulnessMetric,
)
from deepeval.test_case import LLMTestCase

from backend.rag import format_context, generate, retrieve

# ── Init ─────────────────────────────────────────────────
ag.init()

# Auto-instrument LiteLLM calls for token/cost tracking in traces
litellm.callbacks = [ag.callbacks.litellm_handler()]


# ── Application: full RAG pipeline ──────────────────────
@ag.application(slug="rag_e2e", name="RAG E2E Pipeline")
async def rag_pipeline(query: str):
    """Run retrieve → generate and return answer + retrieval context."""
    docs = retrieve(query)

    chunks = []
    async for chunk in generate(query, format_context(docs)):
        chunks.append(chunk)

    return {
        "answer": "".join(chunks),
        "retrieval_context": [doc.content for doc in docs],
    }


# ── Evaluators: DeepEval metrics wrapped in Agenta ──────
EVAL_MODEL = "gpt-4o-mini"


@ag.evaluator(slug="deepeval_faithfulness", name="Faithfulness (DeepEval)")
async def eval_faithfulness(query: str, expected_answer: str, outputs: dict):
    """Does the answer stick to the retrieved context? (no hallucination)"""
    tc = LLMTestCase(
        input=query,
        actual_output=outputs["answer"],
        expected_output=expected_answer,
        retrieval_context=outputs["retrieval_context"],
    )
    metric = FaithfulnessMetric(model=EVAL_MODEL, threshold=0.7)
    metric.measure(tc)
    return {
        "score": metric.score,
        "reason": metric.reason,
        "success": metric.is_successful(),
    }


@ag.evaluator(slug="deepeval_answer_relevancy", name="Answer Relevancy (DeepEval)")
async def eval_answer_relevancy(query: str, outputs: dict):
    """Is the answer actually helpful for the query?"""
    tc = LLMTestCase(
        input=query,
        actual_output=outputs["answer"],
        retrieval_context=outputs["retrieval_context"],
    )
    metric = AnswerRelevancyMetric(model=EVAL_MODEL, threshold=0.7)
    metric.measure(tc)
    return {
        "score": metric.score,
        "reason": metric.reason,
        "success": metric.is_successful(),
    }


@ag.evaluator(
    slug="deepeval_contextual_relevancy", name="Contextual Relevancy (DeepEval)"
)
async def eval_contextual_relevancy(query: str, outputs: dict):
    """Did retrieval fetch relevant chunks? (tests top-k / chunk size)"""
    tc = LLMTestCase(
        input=query,
        actual_output=outputs["answer"],
        retrieval_context=outputs["retrieval_context"],
    )
    metric = ContextualRelevancyMetric(model=EVAL_MODEL, threshold=0.7)
    metric.measure(tc)
    return {
        "score": metric.score,
        "reason": metric.reason,
        "success": metric.is_successful(),
    }


# ── Test data ────────────────────────────────────────────
# Small hand-curated set: query + expected_answer (ground truth)
TEST_DATA = [
    {
        "query": "How do I add tracing to my LLM application with Agenta?",
        "expected_answer": (
            "Install the Agenta SDK, call ag.init() to initialize, "
            "then use the @ag.instrument() decorator on functions you want to trace. "
            "Each decorated function becomes a span in the trace."
        ),
    },
    {
        "query": "What is prompt management in Agenta?",
        "expected_answer": (
            "Prompt management in Agenta lets you store, version, and deploy prompts "
            "from the UI. You can create prompt templates, deploy them to environments "
            "like staging and production, and fetch them in your application code "
            "without redeploying."
        ),
    },
    {
        "query": "How do I create an evaluator in Agenta?",
        "expected_answer": (
            "You can create evaluators from the UI by going to the Evaluators page. "
            "Agenta supports LLM-as-a-judge evaluators where you write a prompt that "
            "scores the output, as well as code evaluators for programmatic checks."
        ),
    },
    {
        "query": "What is the difference between staging and production environments?",
        "expected_answer": (
            "Environments in Agenta let you deploy different prompt versions to "
            "different stages. Staging is for testing before going live, and production "
            "is the live environment your users interact with. You can promote a prompt "
            "from staging to production when ready."
        ),
    },
    {
        "query": "How do I run an evaluation in Agenta?",
        "expected_answer": (
            "You can run evaluations from the UI by selecting an application, "
            "a test set, and one or more evaluators. Agenta runs each test case "
            "through the application and scores the outputs. You can also run "
            "evaluations programmatically using the SDK with the aevaluate function."
        ),
    },
]


# ── Main ─────────────────────────────────────────────────
async def main():
    print("=" * 60)
    print("RAG E2E Evaluation — DeepEval metrics + Agenta runtime")
    print("=" * 60)
    print(f"Test cases: {len(TEST_DATA)}")
    print(f"Eval model: {EVAL_MODEL}")
    print()

    # Create testset
    testset = await ag.testsets.acreate(
        name="RAG E2E Eval",
        data=TEST_DATA,
    )
    print(f"Testset created: {testset.id}")

    # Run evaluation
    result = await aevaluate(
        name="RAG E2E — DeepEval Metrics",
        testsets=[testset.id],
        applications=[rag_pipeline],
        evaluators=[
            eval_faithfulness,
            eval_answer_relevancy,
            eval_contextual_relevancy,
        ],
    )

    print("\nEvaluation complete!")
    print(f"View results: https://eu.cloud.agenta.ai/evaluations")


if __name__ == "__main__":
    asyncio.run(main())
