# /// script
# dependencies = ["agenta"]
# ///
import agenta as ag
from dotenv import load_dotenv
import asyncio
import random
import string
import time

load_dotenv(override=True)
ag.init()


@ag.instrument(spankind="LLM_CALL")
def llm_function(topic: str, genre: str, count: int = 5, iteration: int = 0):
    # Generate some random data to make each call unique
    random_data = {
        "topic2": topic,
        "genre2": genre,
        "count2": count,
        "iteration": iteration,
        "random_id": "".join(
            random.choices(string.ascii_letters + string.digits, k=10)
        ),
        "timestamp": time.time(),
    }
    ag.tracing.store_internals(random_data)

    return topic, genre, count, iteration


@ag.instrument(spankind="WORKFLOW")
async def process_batch(topic: str, genre: str, count: int = 5, batch_id: int = 0):
    # Store metadata about this batch
    ag.tracing.store_internals(
        {
            "topic": topic,
            "genre": genre,
            "count": count,
            "batch_id": batch_id,
            "batch_start_time": time.time(),
        }
    )
    ag.tracing.store_meta(
        {"topic": topic, "genre": genre, "count": count, "batch_id": batch_id}
    )
    ag.tracing.store_refs({"environment.slug": "production"})

    results = []
    # Call llm_function multiple times in a loop
    for i in range(10):  # 10 calls per batch
        result = llm_function(
            topic=f"{topic}_{batch_id}",
            genre=f"{genre}_{i}",
            count=count + i,
            iteration=i,
        )
        results.append(result)

        # Small delay to spread out the calls slightly
        await asyncio.sleep(0.01)

    return results


async def run_concurrent_batches(num_batches=100):
    # Create a list of tasks to run concurrently
    tasks = []
    for i in range(num_batches):
        # Vary the parameters slightly for each batch
        task = process_batch(
            topic=f"topic_{i}", genre=f"genre_{i}", count=i % 10, batch_id=i
        )
        tasks.append(task)

    # Run all tasks concurrently
    results = await asyncio.gather(*tasks)
    return results


if __name__ == "__main__":
    print("Starting high throughput test with multiple concurrent batches...")
    start_time = time.time()

    # Run the concurrent batches
    asyncio.run(run_concurrent_batches(1000))  # 100 concurrent batches

    end_time = time.time()
    print(f"Completed in {end_time - start_time:.2f} seconds")
