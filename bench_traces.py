# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "agenta",
# ]
# ///
"""
Send ~1000 realistic LLM traces with token/cost data to an Agenta instance
backed by Timescale Cloud, to verify the ingestion pipeline works end-to-end.
"""

import asyncio
import random
import time
import agenta as ag

ag.init(
    host="http://144.76.237.122:8580",
    api_key="nlBY6hpQ.038854693ef4eba54c0dcdc23acc4725d1de9c2072dee628f70a834afa92d035",
)

MODELS = [
    ("gpt-4o", 0.0025, 0.010),
    ("gpt-4o-mini", 0.00015, 0.0006),
    ("claude-sonnet-4-20250514", 0.003, 0.015),
    ("gpt-3.5-turbo", 0.0005, 0.0015),
]

TOPICS = [
    "machine learning", "kubernetes", "database optimization",
    "API design", "security best practices", "monitoring",
    "CI/CD pipelines", "microservices", "caching strategies",
    "load balancing", "data modeling", "error handling",
]

USERS = [f"user-{i}" for i in range(20)]
SESSIONS = [f"session-{i}" for i in range(50)]


@ag.instrument(spankind="workflow")
async def rag_pipeline(query: str):
    ag.tracing.store_session(session_id=random.choice(SESSIONS))
    ag.tracing.store_user(user_id=random.choice(USERS))

    context = await retrieve(query)
    response = await generate(query, context)
    return response


@ag.instrument(spankind="embedding")
async def retrieve(query: str):
    await asyncio.sleep(random.uniform(0.01, 0.03))

    prompt_tokens = random.randint(5, 20)
    ag.tracing.store_metrics({
        "costs.incremental.total": prompt_tokens * 0.0001 / 1000,
        "tokens.incremental.prompt": prompt_tokens,
        "tokens.incremental.completion": 0,
        "tokens.incremental.total": prompt_tokens,
    })

    return f"Retrieved context about {query} from {random.randint(2, 8)} documents."


@ag.instrument(spankind="chat")
async def generate(query: str, context: str):
    await asyncio.sleep(random.uniform(0.02, 0.08))

    model, prompt_price, completion_price = random.choice(MODELS)
    prompt_tokens = random.randint(200, 1500)
    completion_tokens = random.randint(50, 800)
    total_tokens = prompt_tokens + completion_tokens

    prompt_cost = prompt_tokens * prompt_price / 1000
    completion_cost = completion_tokens * completion_price / 1000
    total_cost = prompt_cost + completion_cost

    ag.tracing.store_metrics({
        "costs.incremental.total": total_cost,
        "costs.incremental.prompt": prompt_cost,
        "costs.incremental.completion": completion_cost,
        "tokens.incremental.prompt": prompt_tokens,
        "tokens.incremental.completion": completion_tokens,
        "tokens.incremental.total": total_tokens,
    })

    return f"Here is a response about {query} using {model}."


async def main():
    total = 1000
    batch_size = 20
    sent = 0
    t0 = time.time()

    print(f"Sending {total} traces to http://144.76.237.122:8580 ...")

    for batch_start in range(0, total, batch_size):
        batch_end = min(batch_start + batch_size, total)
        tasks = []
        for _ in range(batch_start, batch_end):
            topic = random.choice(TOPICS)
            query = f"How do I implement {topic} in production?"
            tasks.append(rag_pipeline(query))

        await asyncio.gather(*tasks)
        sent += len(tasks)

        elapsed = time.time() - t0
        rate = sent / elapsed if elapsed > 0 else 0
        print(f"  [{sent}/{total}] {rate:.1f} traces/sec")

    elapsed = time.time() - t0
    print(f"\nDone! Sent {total} traces in {elapsed:.1f}s ({total/elapsed:.1f} traces/sec)")
    print("Waiting 5s for async flush...")
    await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())
