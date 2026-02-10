# /// script
# dependencies = [
#     "agenta",
#     "openai",
#     "opentelemetry.instrumentation.openai",
# ]
# ///

"""Example script demonstrating how to create annotations in Agenta.

This script shows how to:
1. Initialize Agenta for tracing
2. Run an instrumented function (with OpenAI API call)
3. Annotate the generated trace with evaluation data
"""

import os
import requests

# Agenta SDK for tracing and instrumentation
import agenta as ag

# OpenAI client and instrumentation
import openai
from openai import OpenAI
from opentelemetry.instrumentation.openai import OpenAIInstrumentor

os.environ["AGENTA_API_KEY"] = "your_agenta_api_key"
os.environ["AGENTA_HOST"] = "https://cloud.agenta.ai"
os.environ["OPENAI_API_KEY"] = "your_openai_api_key"

# Initialize Agenta for tracing
ag.init()


def annotate(trace_id, span_id, score, comment, evaluator_slug):
    """Create an annotation for a specific trace/span with evaluation data.

    Args:
        trace_id: The ID of the trace to annotate
        span_id: The ID of the span to annotate
        score: Numeric evaluation score
        comment: Text comment about the evaluation
        evaluator_slug: Identifier of the evaluator used
    """
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"ApiKey {os.environ['AGENTA_API_KEY']}",
    }

    annotation_data = {
        "annotation": {
            "data": {"outputs": {"score": score, "comment": comment}},
            "references": {"evaluator": {"slug": evaluator_slug}},
            "links": {"invocation": {"trace_id": trace_id, "span_id": span_id}},
        }
    }

    response = requests.post(
        f"{os.environ.get('AGENTA_HOST', 'https://cloud.agenta.ai')}/api/preview/annotations/",
        headers=headers,
        json=annotation_data,
    )

    if response.status_code == 200:
        print("Annotation created successfully")
        return response.json()
    else:
        print(f"Error creating annotation: {response.status_code}")
        print(response.text)
        return None


@ag.instrument()
def generate(topic="witches", genre="comedy"):
    """Generate a story using OpenAI and annotate the trace.

    Args:
        topic: The topic of the story
        genre: The genre of the story

    Returns:
        The OpenAI response
    """
    client = OpenAI()  # noqa: F841

    # Instrument OpenAI library to capture traces
    OpenAIInstrumentor().instrument()

    response = openai.chat.completions.create(
        model="gpt-5",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {
                "role": "user",
                "content": f"Write a short {genre} story about {topic}.",
            },
        ],
    )

    # OPTION 1: Annotate the last completed span (the OpenAI span)
    # span_ctx = ag.tracing.get_last_span_context()
    # trace_id = f"{span_ctx.trace_id:032x}"
    # span_id = f"{span_ctx.span_id:016x}"

    # OPTION 2: Annotate the current span (the generate span instrumented with ag.instrument)
    # span_ctx = ag.tracing.get_span_context()
    # trace_id = f"{span_ctx.trace_id:032x}"
    # span_id = f"{span_ctx.span_id:016x}"

    # OPTION 3 (Recommended): Use the helper function (annotates the current span)
    link = ag.tracing.build_invocation_link()

    # Create an annotation for this invocation
    annotate(
        trace_id=link.trace_id,
        span_id=link.span_id,
        score=1,  # Example score
        comment="This is an example annotation comment",
        evaluator_slug="simple-score",  # Your evaluator slug
    )

    return response


if __name__ == "__main__":
    result = generate(topic="witches", genre="comedy")
    print("\nGeneration complete with trace annotation.")
