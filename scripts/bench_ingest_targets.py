# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "httpx",
# ]
# ///

import asyncio
import os
import random
import statistics
import time
import uuid
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

import httpx


BASE_URL = os.getenv("AGENTA_BASE_URL", "http://144.76.237.122:8480").rstrip("/")
API_KEY = os.getenv("AGENTA_API_KEY", "")

PROJECT_ID = os.getenv("AGENTA_PROJECT_ID", "")
TARGETS = [int(x) for x in os.getenv("BENCH_TARGETS", "100,1000").split(",") if x]
DURATION_S = float(os.getenv("BENCH_DURATION_S", "10"))
TRACES_PER_REQUEST = int(os.getenv("BENCH_TRACES_PER_REQUEST", "10"))
CONCURRENCY = int(os.getenv("BENCH_CONCURRENCY", "120"))
VISIBILITY_SAMPLE = int(os.getenv("BENCH_VISIBILITY_SAMPLE", "20"))
VISIBILITY_TIMEOUT_S = float(os.getenv("BENCH_VISIBILITY_TIMEOUT_S", "30"))
HTTP_MAX_CONNECTIONS = int(os.getenv("BENCH_HTTP_MAX_CONNECTIONS", "800"))
HTTP_MAX_KEEPALIVE = int(os.getenv("BENCH_HTTP_KEEPALIVE", "400"))


def make_span(trace_id: str) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    span_id = uuid.uuid4().hex[:16]
    return {
        "trace_id": trace_id,
        "span_id": span_id,
        "span_name": "bench_ingest_target",
        "start_time": now,
        "end_time": now,
        "attributes": {
            "ag": {
                "type": {"trace": "invocation", "span": "task"},
                "data": {
                    "inputs": {"prompt": "bench"},
                    "outputs": "ok",
                    "metrics": {"duration": {"cumulative": 1}},
                },
            }
        },
    }


async def post_batch(
    client: httpx.AsyncClient,
    headers: Dict[str, str],
    trace_ids: List[str],
) -> Tuple[int, float]:
    payload = {"spans": [make_span(tid) for tid in trace_ids]}
    t0 = time.perf_counter()
    resp = await client.post(
        f"{BASE_URL}/api/preview/tracing/spans/ingest",
        headers=headers,
        json=payload,
    )
    latency = time.perf_counter() - t0
    return resp.status_code, latency


async def wait_visible(
    client: httpx.AsyncClient,
    headers: Dict[str, str],
    trace_id: str,
) -> bool:
    deadline = time.perf_counter() + VISIBILITY_TIMEOUT_S
    while time.perf_counter() < deadline:
        resp = await client.get(
            f"{BASE_URL}/api/preview/tracing/traces/{trace_id}",
            params={"project_id": PROJECT_ID},
            headers=headers,
        )
        if resp.status_code == 200:
            try:
                body = resp.json()
                if body.get("count", 0) > 0:
                    return True
            except Exception:
                pass
        await asyncio.sleep(0.5)
    return False


async def run_target(
    client: httpx.AsyncClient,
    headers: Dict[str, str],
    target_tps: int,
) -> None:
    req_rate = target_tps / TRACES_PER_REQUEST
    total_requests = int(req_rate * DURATION_S)
    total_traces = total_requests * TRACES_PER_REQUEST

    sem = asyncio.Semaphore(CONCURRENCY)
    statuses: List[int] = []
    latencies: List[float] = []
    all_trace_ids: List[str] = []
    accepted_trace_ids: List[str] = []

    async def one_request(i: int) -> None:
        target_time = i / req_rate
        now = time.perf_counter() - start
        if target_time > now:
            await asyncio.sleep(target_time - now)

        trace_ids = [uuid.uuid4().hex for _ in range(TRACES_PER_REQUEST)]
        all_trace_ids.extend(trace_ids)
        async with sem:
            status, latency = await post_batch(client, headers, trace_ids)
            statuses.append(status)
            latencies.append(latency)
            if status == 202:
                accepted_trace_ids.extend(trace_ids)

    print(
        f"\nTarget {target_tps}/s for {DURATION_S:.0f}s "
        f"({total_requests} requests, {TRACES_PER_REQUEST} traces/req)"
    )

    start = time.perf_counter()
    await asyncio.gather(*(one_request(i) for i in range(total_requests)))
    elapsed = time.perf_counter() - start

    status_counts = Counter(statuses)
    ok = status_counts.get(202, 0)
    errors = len(statuses) - ok
    achieved_tps = (ok * TRACES_PER_REQUEST) / elapsed if elapsed else 0.0
    achieved_rps = ok / elapsed if elapsed else 0.0

    vis_sample = random.sample(
        accepted_trace_ids,
        min(VISIBILITY_SAMPLE, len(accepted_trace_ids)),
    )
    vis_ok = 0
    vis_start = time.perf_counter()
    for tid in vis_sample:
        if await wait_visible(client, headers, tid):
            vis_ok += 1
    vis_elapsed = time.perf_counter() - vis_start

    print(
        f"accepted={ok}/{len(statuses)} requests, errors={errors}, "
        f"elapsed={elapsed:.2f}s"
    )
    print(f"status_counts={dict(sorted(status_counts.items()))}")
    print(f"achieved ~{achieved_tps:.1f} traces/s ({achieved_rps:.1f} req/s)")
    if latencies:
        print(
            "ingest latency (request): "
            f"mean={statistics.mean(latencies):.3f}s, "
            f"p95={sorted(latencies)[int(0.95 * (len(latencies) - 1))]:.3f}s"
        )
    print(
        f"visibility sample={vis_ok}/{len(vis_sample)} within {VISIBILITY_TIMEOUT_S:.0f}s "
        f"(check time {vis_elapsed:.2f}s)"
    )


async def main() -> None:
    if not API_KEY:
        raise SystemExit("AGENTA_API_KEY is required")

    headers = {
        "Authorization": f"ApiKey {API_KEY}",
        "Content-Type": "application/json",
    }

    limits = httpx.Limits(
        max_connections=HTTP_MAX_CONNECTIONS,
        max_keepalive_connections=HTTP_MAX_KEEPALIVE,
    )
    async with httpx.AsyncClient(timeout=60.0, limits=limits) as client:
        global PROJECT_ID
        if not PROJECT_ID:
            r = await client.get(f"{BASE_URL}/api/projects", headers=headers)
            r.raise_for_status()
            rows = r.json()
            if not rows:
                raise RuntimeError("No projects found for API key")
            PROJECT_ID = rows[0]["project_id"]

        print(f"base_url={BASE_URL}")
        print(f"project_id={PROJECT_ID}")
        print(
            f"targets={TARGETS}, duration={DURATION_S}s, traces/req={TRACES_PER_REQUEST}, "
            f"concurrency={CONCURRENCY}, max_connections={HTTP_MAX_CONNECTIONS}"
        )

        for target in TARGETS:
            await run_target(client, headers, target)


if __name__ == "__main__":
    asyncio.run(main())
