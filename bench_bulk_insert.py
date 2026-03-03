# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "asyncpg",
# ]
# ///
"""
Bulk-insert ~1M traces (3M spans) into TimescaleDB hypertable via asyncpg COPY.
Target: 2-5 GB of realistic trace data with token/cost metrics.
"""

import asyncio
import asyncpg
import io
import json
import random
import ssl as ssl_mod
import time
import uuid
from datetime import datetime, timedelta, timezone

# --- Config ---
TARGET_TRACES = 1_000_000
SPANS_PER_TRACE = 3  # workflow -> embedding + chat
BATCH_SIZE = 10_000  # spans per COPY batch
PROJECT_ID = None  # will be read from existing data
USER_ID = None

MODELS = [
    ("gpt-4o", 0.0025, 0.010),
    ("gpt-4o-mini", 0.00015, 0.0006),
    ("claude-sonnet-4-20250514", 0.003, 0.015),
    ("gpt-3.5-turbo", 0.0005, 0.0015),
    ("claude-haiku", 0.00025, 0.00125),
    ("gemini-1.5-pro", 0.00125, 0.005),
]

TOPICS = [
    "machine learning", "kubernetes", "database optimization",
    "API design", "security best practices", "monitoring",
    "CI/CD pipelines", "microservices", "caching strategies",
    "load balancing", "data modeling", "error handling",
    "authentication", "rate limiting", "distributed systems",
    "message queues", "search indexing", "feature flags",
    "A/B testing", "deployment strategies",
]

USERS = [str(uuid.uuid4()) for _ in range(50)]
SESSIONS = [str(uuid.uuid4()) for _ in range(200)]

# Filler text to make attributes realistic size
FILLER_PROMPTS = [
    "You are a helpful assistant that provides detailed technical guidance. "
    "Please analyze the following question and provide a comprehensive answer "
    "with code examples where appropriate. Consider edge cases and best practices.",
    "As an expert software engineer, help me understand the following concept. "
    "Provide real-world examples, potential pitfalls, and recommendations for "
    "production deployments. Include relevant configuration snippets.",
    "I need detailed help with a production system. Please provide step-by-step "
    "instructions, monitoring recommendations, and rollback strategies. "
    "Consider high availability and disaster recovery scenarios.",
]

FILLER_RESPONSES = [
    "Based on my analysis, here are the key recommendations for your production system: "
    "1) Implement proper circuit breakers to handle cascading failures. "
    "2) Use connection pooling with appropriate timeout configurations. "
    "3) Set up comprehensive monitoring with alerting thresholds. "
    "4) Implement graceful degradation patterns for non-critical services. "
    "5) Use blue-green or canary deployments for zero-downtime releases. "
    "Here's a detailed implementation guide with code examples...",
    "The approach you should take depends on your specific requirements, but "
    "I recommend the following architecture: Use an event-driven design with "
    "message queues for async processing. Implement CQRS for read-heavy workloads. "
    "Deploy behind a load balancer with health checks. Use database read replicas "
    "for query distribution. Implement proper caching at multiple layers.",
]


def make_workflow_attrs(topic, session_id, user_id, embed_cost, embed_tokens,
                        chat_cost, chat_prompt_tokens, chat_completion_tokens,
                        chat_total_tokens, duration_ms):
    return json.dumps({
        "ag": {
            "type": {"trace": "invocation", "span": "workflow"},
            "node": {"name": "rag_pipeline"},
            "data": {
                "inputs": {"query": f"How do I implement {topic} in production?"},
                "outputs": {"result": random.choice(FILLER_RESPONSES)[:200]},
            },
            "meta": {"session": {"id": session_id}, "user": {"id": user_id}},
            "metrics": {
                "costs": {
                    "cumulative": {
                        "total": round(embed_cost + chat_cost, 8),
                        "prompt": round(chat_cost * 0.4 + embed_cost, 8),
                        "completion": round(chat_cost * 0.6, 8),
                    },
                },
                "tokens": {
                    "cumulative": {
                        "total": embed_tokens + chat_total_tokens,
                        "prompt": embed_tokens + chat_prompt_tokens,
                        "completion": chat_completion_tokens,
                    },
                },
                "duration": {"cumulative": duration_ms},
                "errors": {},
            },
        }
    })


def make_embedding_attrs(topic, tokens):
    cost = tokens * 0.0001 / 1000
    return json.dumps({
        "ag": {
            "type": {"trace": "invocation", "span": "embedding"},
            "node": {"name": "retrieve"},
            "data": {
                "inputs": {"query": f"How do I implement {topic} in production?"},
                "outputs": {"result": f"Retrieved context from {random.randint(2, 10)} documents about {topic}."},
            },
            "metrics": {
                "costs": {
                    "incremental": {"total": round(cost, 8)},
                    "cumulative": {"total": round(cost, 8)},
                },
                "tokens": {
                    "incremental": {"total": tokens, "prompt": tokens, "completion": 0},
                    "cumulative": {"total": tokens, "prompt": tokens, "completion": 0},
                },
                "duration": {"cumulative": random.randint(5, 50)},
                "errors": {},
            },
        }
    })


def make_chat_attrs(topic, model, prompt_tokens, completion_tokens,
                    prompt_cost, completion_cost, total_cost):
    return json.dumps({
        "ag": {
            "type": {"trace": "invocation", "span": "chat"},
            "node": {"name": "generate", "model": model},
            "data": {
                "inputs": {
                    "query": f"How do I implement {topic} in production?",
                    "context": random.choice(FILLER_PROMPTS),
                },
                "outputs": {"result": random.choice(FILLER_RESPONSES)},
            },
            "metrics": {
                "costs": {
                    "incremental": {
                        "total": round(total_cost, 8),
                        "prompt": round(prompt_cost, 8),
                        "completion": round(completion_cost, 8),
                    },
                    "cumulative": {
                        "total": round(total_cost, 8),
                        "prompt": round(prompt_cost, 8),
                        "completion": round(completion_cost, 8),
                    },
                },
                "tokens": {
                    "incremental": {
                        "total": prompt_tokens + completion_tokens,
                        "prompt": prompt_tokens,
                        "completion": completion_tokens,
                    },
                    "cumulative": {
                        "total": prompt_tokens + completion_tokens,
                        "prompt": prompt_tokens,
                        "completion": completion_tokens,
                    },
                },
                "duration": {"cumulative": random.randint(50, 3000)},
                "errors": {},
            },
        }
    })


def escape_copy(val):
    """Escape a value for PostgreSQL COPY TEXT format."""
    if val is None:
        return "\\N"
    s = str(val)
    return s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def generate_batch(project_id, user_id, batch_num, count, base_time):
    """Generate `count` traces (count * 3 span rows) as COPY-ready text."""
    buf = io.StringIO()

    for i in range(count):
        trace_id = uuid.uuid4()
        workflow_span_id = uuid.uuid4()
        embed_span_id = uuid.uuid4()
        chat_span_id = uuid.uuid4()

        # Spread traces over 90 days
        offset_secs = random.uniform(0, 90 * 86400)
        trace_time = base_time + timedelta(seconds=offset_secs)

        topic = random.choice(TOPICS)
        session_id = random.choice(SESSIONS)
        uid = random.choice(USERS)
        model, prompt_price, completion_price = random.choice(MODELS)

        # Embedding metrics
        embed_tokens = random.randint(5, 30)
        embed_cost = embed_tokens * 0.0001 / 1000

        # Chat metrics
        prompt_tokens = random.randint(150, 2000)
        completion_tokens = random.randint(30, 1000)
        prompt_cost = prompt_tokens * prompt_price / 1000
        completion_cost = completion_tokens * completion_price / 1000
        total_cost = prompt_cost + completion_cost

        # Timing
        embed_start = trace_time + timedelta(milliseconds=random.randint(1, 5))
        embed_end = embed_start + timedelta(milliseconds=random.randint(10, 80))
        chat_start = embed_end + timedelta(milliseconds=random.randint(1, 5))
        chat_end = chat_start + timedelta(milliseconds=random.randint(50, 3000))
        workflow_start = trace_time
        workflow_end = chat_end + timedelta(milliseconds=random.randint(1, 5))
        duration_ms = (workflow_end - workflow_start).total_seconds() * 1000

        created_at = workflow_end + timedelta(milliseconds=random.randint(10, 100))

        # columns: project_id, created_at, updated_at, deleted_at, created_by_id,
        #          updated_by_id, deleted_by_id, trace_id, span_id, parent_id,
        #          span_kind, span_name, start_time, end_time,
        #          status_code, status_message, attributes, events, links,
        #          references, trace_type, span_type, hashes, exception

        def fmt_ts(dt):
            return dt.strftime("%Y-%m-%d %H:%M:%S.%f%z") if dt else "\\N"

        # Workflow span (root, no parent)
        wf_attrs = make_workflow_attrs(
            topic, session_id, uid, embed_cost, embed_tokens,
            total_cost, prompt_tokens, completion_tokens,
            prompt_tokens + completion_tokens, duration_ms,
        )
        row = "\t".join([
            str(project_id), fmt_ts(created_at), "\\N", "\\N",
            str(user_id), "\\N", "\\N",
            str(trace_id), str(workflow_span_id), "\\N",
            "SPAN_KIND_SERVER", "rag_pipeline",
            fmt_ts(workflow_start), fmt_ts(workflow_end),
            "STATUS_CODE_OK", "\\N",
            escape_copy(wf_attrs), "\\N", "\\N", "\\N",
            "INVOCATION", "WORKFLOW", "\\N", "\\N",
        ])
        buf.write(row + "\n")

        # Embedding span
        emb_attrs = make_embedding_attrs(topic, embed_tokens)
        row = "\t".join([
            str(project_id), fmt_ts(created_at + timedelta(microseconds=1)), "\\N", "\\N",
            str(user_id), "\\N", "\\N",
            str(trace_id), str(embed_span_id), str(workflow_span_id),
            "SPAN_KIND_CLIENT", "retrieve",
            fmt_ts(embed_start), fmt_ts(embed_end),
            "STATUS_CODE_OK", "\\N",
            escape_copy(emb_attrs), "\\N", "\\N", "\\N",
            "INVOCATION", "EMBEDDING", "\\N", "\\N",
        ])
        buf.write(row + "\n")

        # Chat span
        ch_attrs = make_chat_attrs(
            topic, model, prompt_tokens, completion_tokens,
            prompt_cost, completion_cost, total_cost,
        )
        row = "\t".join([
            str(project_id), fmt_ts(created_at + timedelta(microseconds=2)), "\\N", "\\N",
            str(user_id), "\\N", "\\N",
            str(trace_id), str(chat_span_id), str(workflow_span_id),
            "SPAN_KIND_CLIENT", "generate",
            fmt_ts(chat_start), fmt_ts(chat_end),
            "STATUS_CODE_OK", "\\N",
            escape_copy(ch_attrs), "\\N", "\\N", "\\N",
            "INVOCATION", "CHAT", "\\N", "\\N",
        ])
        buf.write(row + "\n")

    return buf.getvalue()


async def main():
    ssl_ctx = ssl_mod.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl_mod.CERT_NONE

    conn = await asyncpg.connect(
        host="p8m4busixa.ciet06s68p.tsdb.cloud.timescale.com",
        port=32877,
        user="tsdbadmin",
        password="di1pfjy4if9kiumq",
        database="tsdb",
        ssl=ssl_ctx,
    )

    # Get project_id and user_id from existing spans
    row = await conn.fetchrow("SELECT project_id, created_by_id FROM spans LIMIT 1")
    if not row:
        print("ERROR: No existing spans found. Run bench_traces.py first to seed initial data.")
        return
    project_id = row["project_id"]
    user_id = row["created_by_id"]
    print(f"Using project_id={project_id}, user_id={user_id}")

    # Check starting count
    row = await conn.fetchrow("SELECT count(*) as cnt FROM spans")
    start_count = row["cnt"]
    print(f"Starting span count: {start_count}")

    base_time = datetime.now(timezone.utc) - timedelta(days=90)
    total_traces = TARGET_TRACES
    traces_per_batch = BATCH_SIZE // SPANS_PER_TRACE
    total_spans = total_traces * SPANS_PER_TRACE

    print(f"\nTarget: {total_traces:,} traces = {total_spans:,} spans")
    print(f"Batch size: {traces_per_batch:,} traces ({BATCH_SIZE:,} spans)")
    print()

    t0 = time.time()
    inserted = 0

    for batch_num in range(0, total_traces, traces_per_batch):
        batch_count = min(traces_per_batch, total_traces - batch_num)
        data = generate_batch(project_id, user_id, batch_num, batch_count, base_time)

        result = await conn.copy_to_table(
            "spans",
            source=io.BytesIO(data.encode("utf-8")),
            format="text",
            columns=[
                "project_id", "created_at", "updated_at", "deleted_at",
                "created_by_id", "updated_by_id", "deleted_by_id",
                "trace_id", "span_id", "parent_id",
                "span_kind", "span_name", "start_time", "end_time",
                "status_code", "status_message", "attributes", "events",
                "links", "references", "trace_type", "span_type",
                "hashes", "exception",
            ],
        )

        inserted += batch_count * SPANS_PER_TRACE
        elapsed = time.time() - t0
        rate = inserted / elapsed
        pct = inserted / total_spans * 100
        print(f"  [{inserted:>10,}/{total_spans:,}] {pct:5.1f}%  {rate:,.0f} spans/sec  ({result})")

    elapsed = time.time() - t0
    print(f"\nDone! Inserted {inserted:,} spans in {elapsed:.1f}s ({inserted/elapsed:,.0f} spans/sec)")

    # Final stats
    row = await conn.fetchrow("SELECT count(*) as cnt FROM spans")
    print(f"Total spans now: {row['cnt']:,}")

    row = await conn.fetchrow("SELECT pg_size_pretty(pg_total_relation_size('spans')) as size")
    print(f"Table size: {row['size']}")

    rows = await conn.fetch("""
        SELECT chunk_name, range_start::text, range_end::text
        FROM timescaledb_information.chunks
        WHERE hypertable_name = 'spans'
        ORDER BY range_start
    """)
    print(f"Chunks: {len(rows)}")
    for r in rows:
        print(f"  {r['chunk_name']}: {r['range_start']} -> {r['range_end']}")

    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
