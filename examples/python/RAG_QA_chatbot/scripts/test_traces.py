"""
Generate sample traces for the Agenta demo account.

Usage:
  # Run locally (from RAG_QA_chatbot directory):
  source .venv/bin/activate && python scripts/test_traces.py

  # Run with custom number of queries:
  python scripts/test_traces.py --count 5

  # Run specific queries (by index):
  python scripts/test_traces.py --indices 0 1 2
"""

import argparse
import asyncio
import json
import os
import random
import sys
from pathlib import Path

# Add parent directory to path so we can import backend
sys.path.insert(0, str(Path(__file__).parent.parent))

# Load environment variables
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

import agenta as ag  # noqa: E402
import litellm  # noqa: E402
from backend.rag import retrieve, generate  # noqa: E402

# Initialize Agenta
ag.init()

# Set the Agenta LiteLLM callback for token/cost tracking
litellm.callbacks = [ag.callbacks.litellm_handler()]

# Load queries from JSON file
QUERIES_FILE = Path(__file__).parent / "queries.json"


def load_queries() -> list[str]:
    """Load test queries from JSON file."""
    with open(QUERIES_FILE) as f:
        data = json.load(f)
    return data["queries"]


@ag.instrument(spankind="WORKFLOW")
async def rag_query(query: str) -> str:
    """
    Full RAG pipeline: retrieve then generate.
    This is the parent span that wraps retrieve and generate.
    """
    # Retrieve docs (will be a child span)
    docs = retrieve(query)

    # Generate response (will be a child span)
    response_chunks = []
    async for chunk in generate(query, docs):
        response_chunks.append(chunk)

    return "".join(response_chunks)


async def run_query(query: str, index: int, total: int) -> str:
    """Run a single RAG query and print output."""
    print(f"\n[{index + 1}/{total}] {'=' * 50}")
    print(f"Query: {query[:80]}{'...' if len(query) > 80 else ''}")
    print("=" * 56)

    try:
        response = await rag_query(query)
        print(f"Response: {response[:200]}{'...' if len(response) > 200 else ''}")
        return response
    except Exception as e:
        print(f"Error: {e}")
        import traceback

        traceback.print_exc()
        return ""


async def main():
    """Run test queries to generate traces."""
    parser = argparse.ArgumentParser(description="Generate demo traces for Agenta")
    parser.add_argument(
        "--count",
        "-c",
        type=int,
        default=12,
        help="Number of random queries to run (default: 12)",
    )
    parser.add_argument(
        "--indices",
        "-i",
        type=int,
        nargs="+",
        help="Specific query indices to run (overrides --count)",
    )
    parser.add_argument(
        "--list", "-l", action="store_true", help="List all available queries and exit"
    )
    args = parser.parse_args()

    # Load queries
    all_queries = load_queries()

    # List mode
    if args.list:
        print(f"Available queries ({len(all_queries)} total):\n")
        for i, q in enumerate(all_queries):
            print(f"  [{i:3d}] {q[:70]}{'...' if len(q) > 70 else ''}")
        return

    # Select queries
    if args.indices:
        selected_indices = args.indices
        queries = [
            (i, all_queries[i]) for i in selected_indices if i < len(all_queries)
        ]
    else:
        # Random selection
        count = min(args.count, len(all_queries))
        selected_indices = random.sample(range(len(all_queries)), count)
        queries = [(i, all_queries[i]) for i in selected_indices]

    print("=" * 60)
    print("Agenta Demo - Generating Sample Traces")
    print("=" * 60)
    print(f"Host: {os.getenv('AGENTA_HOST', 'https://cloud.agenta.ai')}")
    print(f"Queries: {len(queries)} (from pool of {len(all_queries)})")
    print(f"Selected indices: {[q[0] for q in queries]}")

    # Run queries
    for idx, (query_idx, query) in enumerate(queries):
        await run_query(query, idx, len(queries))
        # Small delay between queries to avoid rate limiting
        if idx < len(queries) - 1:
            await asyncio.sleep(1)

    print("\n" + "=" * 60)
    print(f"Done! Generated {len(queries)} traces.")
    print("View at: https://cloud.agenta.ai/observability")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
