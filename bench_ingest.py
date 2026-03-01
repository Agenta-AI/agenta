# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "httpx",
#     "opentelemetry-proto",
#     "protobuf",
#     "rich",
#     "redis",
# ]
# ///
"""
Benchmark OTLP trace ingestion into the Agenta API (backed by TimescaleDB).

Measures two rates:
  1. Ingest rate:  HTTP POST -> Redis Stream (how fast the API accepts)
  2. Drain rate:   Redis Stream -> Postgres  (how fast the worker writes)

Usage:
    uv run bench_ingest.py
"""

import asyncio
import os
import time
import uuid
import struct
import random
import json
from dataclasses import dataclass

import httpx
import redis
from rich.console import Console
from rich.table import Table

from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)
from opentelemetry.proto.trace.v1.trace_pb2 import (
    ResourceSpans,
    ScopeSpans,
    Span,
    Status,
)
from opentelemetry.proto.common.v1.common_pb2 import (
    AnyValue,
    KeyValue,
    ArrayValue,
)
from opentelemetry.proto.resource.v1.resource_pb2 import Resource

# ─── Configuration ───────────────────────────────────────────────────────────

API_URL = os.getenv("AGENTA_OTLP_URL", "http://localhost/api/otlp/v1/traces")
API_KEY = os.getenv("AGENTA_API_KEY", "")
USE_CURL = os.getenv("AGENTA_OTLP_USE_CURL", "false").lower() in {"1", "true"}
REDIS_URL = "redis://localhost:6381/0"
REDIS_STREAM = "streams:tracing"

# Test parameters
TRACES_PER_BATCH = 10      # traces per OTLP request
SPANS_PER_TRACE = 3        # spans per trace (1 root + 2 children)
TOTAL_TRACES = 5000        # total traces to send
CONCURRENCY_LEVELS = [1, 5, 10, 20, 50]

console = Console()

# ─── OTLP Payload Generation ────────────────────────────────────────────────

def uuid_to_bytes(u: uuid.UUID) -> bytes:
    return u.bytes


def make_trace_id() -> bytes:
    return uuid.uuid4().bytes


def make_span_id() -> bytes:
    return uuid.uuid4().bytes[:8]


def nano_now() -> int:
    return int(time.time() * 1e9)


def build_kv(key: str, value) -> KeyValue:
    """Build a KeyValue protobuf from a Python value."""
    kv = KeyValue(key=key)
    if isinstance(value, str):
        kv.value.CopyFrom(AnyValue(string_value=value))
    elif isinstance(value, bool):
        kv.value.CopyFrom(AnyValue(bool_value=value))
    elif isinstance(value, int):
        kv.value.CopyFrom(AnyValue(int_value=value))
    elif isinstance(value, float):
        kv.value.CopyFrom(AnyValue(double_value=value))
    return kv


def build_otlp_request(n_traces: int, spans_per_trace: int) -> bytes:
    """Build a serialized ExportTraceServiceRequest with n_traces traces."""
    resource = Resource(
        attributes=[
            build_kv("service.name", "bench-ingest"),
            build_kv("agenta.sdk.version", "0.1.0"),
        ]
    )

    all_spans = []
    now = nano_now()

    for _ in range(n_traces):
        trace_id = make_trace_id()
        root_span_id = make_span_id()
        start = now - random.randint(1_000_000_000, 5_000_000_000)
        end = start + random.randint(100_000_000, 3_000_000_000)

        # Root span (workflow type)
        root = Span(
            trace_id=trace_id,
            span_id=root_span_id,
            name="workflow",
            kind=Span.SPAN_KIND_INTERNAL,
            start_time_unix_nano=start,
            end_time_unix_nano=end,
            attributes=[
                build_kv("ag.type.span", "workflow"),
                build_kv("ag.type.trace", "generation"),
            ],
            status=Status(code=Status.STATUS_CODE_OK),
        )
        all_spans.append(root)

        # Child spans
        for j in range(spans_per_trace - 1):
            child_start = start + random.randint(10_000_000, 500_000_000)
            child_end = child_start + random.randint(50_000_000, 1_000_000_000)
            child = Span(
                trace_id=trace_id,
                span_id=make_span_id(),
                parent_span_id=root_span_id,
                name=f"llm-call-{j}",
                kind=Span.SPAN_KIND_CLIENT,
                start_time_unix_nano=child_start,
                end_time_unix_nano=child_end,
                attributes=[
                    build_kv("ag.type.span", "chat"),
                    build_kv("gen_ai.system", "openai"),
                    build_kv("gen_ai.usage.prompt_tokens", random.randint(100, 2000)),
                    build_kv("gen_ai.usage.completion_tokens", random.randint(50, 1000)),
                    build_kv("gen_ai.response.model", "gpt-4o"),
                ],
                status=Status(code=Status.STATUS_CODE_OK),
            )
            all_spans.append(child)

    scope_spans = ScopeSpans(spans=all_spans)
    resource_spans = ResourceSpans(resource=resource, scope_spans=[scope_spans])
    request = ExportTraceServiceRequest(resource_spans=[resource_spans])
    return request.SerializeToString()


async def send_with_curl(payload: bytes, headers: dict) -> int:
    args = [
        "curl",
        "-s",
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        API_URL,
        "-X",
        "POST",
        "-H",
        f"Authorization: {headers['Authorization']}",
        "-H",
        f"Content-Type: {headers['Content-Type']}",
        "--data-binary",
        "@-",
    ]
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate(payload)
    try:
        return int(out.decode().strip() or "0")
    except ValueError:
        return 0


# ─── Benchmark Runner ────────────────────────────────────────────────────────

@dataclass
class BenchResult:
    concurrency: int
    total_traces: int
    total_spans: int
    send_duration: float       # seconds to send all requests
    drain_duration: float      # seconds for Redis stream to drain
    total_duration: float      # end-to-end (send + drain)
    http_errors: int
    ingest_rate_tps: float     # traces/sec into API
    ingest_rate_sps: float     # spans/sec into API
    drain_rate_tps: float      # traces/sec from Redis to Postgres
    drain_rate_sps: float      # spans/sec from Redis to Postgres


def get_stream_length(r: redis.Redis) -> int:
    try:
        return r.xlen(REDIS_STREAM)
    except Exception:
        return 0


def get_db_count(client: httpx.Client) -> int:
    """Get approximate span count from Timescale (quick check)."""
    # We can't easily query the DB directly here, so we skip this.
    return -1


async def run_bench(
    concurrency: int,
    total_traces: int,
    traces_per_batch: int,
    spans_per_trace: int,
) -> BenchResult:
    total_spans = total_traces * spans_per_trace
    n_requests = total_traces // traces_per_batch

    # Pre-generate payloads (so generation time doesn't affect measurement)
    console.print(f"  Generating {n_requests} payloads ({traces_per_batch} traces each)...")
    payloads = [
        build_otlp_request(traces_per_batch, spans_per_trace)
        for _ in range(n_requests)
    ]
    payload_size = len(payloads[0])
    console.print(f"  Payload size: {payload_size:,} bytes ({payload_size/1024:.1f} KB)")

    # Connect to Redis to monitor stream depth
    r = redis.Redis.from_url(REDIS_URL, decode_responses=False)

    # Wait for any previous drain to complete
    while get_stream_length(r) > 0:
        await asyncio.sleep(0.1)

    if not API_KEY:
        raise SystemExit("AGENTA_API_KEY is required")

    if not API_KEY:
        raise SystemExit("AGENTA_API_KEY is required")

    headers = {
        "Authorization": f"ApiKey {API_KEY}",
        "Content-Type": "application/x-protobuf",
    }

    http_errors = 0
    sem = asyncio.Semaphore(concurrency)

    async def send_one(client: httpx.AsyncClient, payload: bytes):
        nonlocal http_errors
        async with sem:
            try:
                if USE_CURL:
                    code = await send_with_curl(payload, headers)
                    if code != 200:
                        http_errors += 1
                else:
                    resp = await client.post(API_URL, content=payload, headers=headers)
                    if resp.status_code != 200:
                        http_errors += 1
            except Exception:
                http_errors += 1

    # Phase 1: Send all requests
    console.print(f"  Sending {n_requests} requests (concurrency={concurrency})...")
    send_start = time.perf_counter()

    async with httpx.AsyncClient(timeout=30.0) as client:
        tasks = [send_one(client, p) for p in payloads]
        await asyncio.gather(*tasks)

    send_end = time.perf_counter()
    send_duration = send_end - send_start

    # Phase 2: Wait for Redis stream to drain
    console.print(f"  Waiting for drain (stream -> Postgres)...")
    stream_len = get_stream_length(r)
    max_seen = stream_len
    drain_start = time.perf_counter()

    while True:
        stream_len = get_stream_length(r)
        if stream_len > max_seen:
            max_seen = stream_len
        if stream_len == 0:
            break
        await asyncio.sleep(0.2)

    drain_end = time.perf_counter()
    drain_duration = drain_end - send_start  # from first send to fully drained
    total_duration = drain_end - send_start

    r.close()

    ingest_tps = total_traces / send_duration if send_duration > 0 else 0
    ingest_sps = total_spans / send_duration if send_duration > 0 else 0
    drain_tps = total_traces / total_duration if total_duration > 0 else 0
    drain_sps = total_spans / total_duration if total_duration > 0 else 0

    return BenchResult(
        concurrency=concurrency,
        total_traces=total_traces,
        total_spans=total_spans,
        send_duration=send_duration,
        drain_duration=drain_duration,
        total_duration=total_duration,
        http_errors=http_errors,
        ingest_rate_tps=ingest_tps,
        ingest_rate_sps=ingest_sps,
        drain_rate_tps=drain_tps,
        drain_rate_sps=drain_sps,
    )


async def main():
    console.rule("[bold cyan]OTLP Ingestion Benchmark")
    console.print(f"  API:             {API_URL}")
    console.print(f"  Traces/batch:    {TRACES_PER_BATCH}")
    console.print(f"  Spans/trace:     {SPANS_PER_TRACE}")
    console.print(f"  Total traces:    {TOTAL_TRACES}")
    console.print(f"  Concurrency:     {CONCURRENCY_LEVELS}")
    console.print()

    results = []

    for conc in CONCURRENCY_LEVELS:
        console.print(f"[bold]Concurrency = {conc}[/bold]")
        result = await run_bench(
            concurrency=conc,
            total_traces=TOTAL_TRACES,
            traces_per_batch=TRACES_PER_BATCH,
            spans_per_trace=SPANS_PER_TRACE,
        )

        console.print(
            f"  HTTP errors: {result.http_errors}\n"
            f"  Send time:   {result.send_duration:.2f}s "
            f"({result.ingest_rate_tps:.0f} traces/s, {result.ingest_rate_sps:.0f} spans/s)\n"
            f"  End-to-end:  {result.total_duration:.2f}s "
            f"({result.drain_rate_tps:.0f} traces/s, {result.drain_rate_sps:.0f} spans/s)"
        )
        console.print()
        results.append(result)

        # Brief cooldown between runs
        await asyncio.sleep(2)

    # ─── Summary ──────────────────────────────────────────────────────
    console.rule("[bold cyan]Summary")

    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Concurrency", justify="center", width=12)
    table.add_column("Send (s)", justify="right", width=10)
    table.add_column("E2E (s)", justify="right", width=10)
    table.add_column("Ingest tr/s", justify="right", width=12)
    table.add_column("Ingest sp/s", justify="right", width=12)
    table.add_column("Drain tr/s", justify="right", width=12)
    table.add_column("Drain sp/s", justify="right", width=12)
    table.add_column("Errors", justify="right", width=8)

    for r in results:
        table.add_row(
            str(r.concurrency),
            f"{r.send_duration:.2f}",
            f"{r.total_duration:.2f}",
            f"{r.ingest_rate_tps:.0f}",
            f"{r.ingest_rate_sps:.0f}",
            f"{r.drain_rate_tps:.0f}",
            f"{r.drain_rate_sps:.0f}",
            str(r.http_errors),
        )

    console.print(table)

    # Save results
    out = [
        {
            "concurrency": r.concurrency,
            "total_traces": r.total_traces,
            "total_spans": r.total_spans,
            "send_duration_s": round(r.send_duration, 3),
            "e2e_duration_s": round(r.total_duration, 3),
            "ingest_traces_per_s": round(r.ingest_rate_tps, 1),
            "ingest_spans_per_s": round(r.ingest_rate_sps, 1),
            "drain_traces_per_s": round(r.drain_rate_tps, 1),
            "drain_spans_per_s": round(r.drain_rate_sps, 1),
            "http_errors": r.http_errors,
        }
        for r in results
    ]
    with open("bench_ingest_results.json", "w") as f:
        json.dump(out, f, indent=2)
    console.print("\nResults saved to [bold]bench_ingest_results.json[/bold]")


if __name__ == "__main__":
    asyncio.run(main())
