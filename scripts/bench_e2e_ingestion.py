# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "httpx",
# ]
# ///

import asyncio
import os
import statistics
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx


BASE_URL = os.getenv("AGENTA_BASE_URL", "http://144.76.237.122:8480").rstrip("/")
API_KEY = os.getenv("AGENTA_API_KEY", "")
APP_SLUG = os.getenv("AGENTA_APP_SLUG", "test")
ENV_SLUG = os.getenv("AGENTA_ENV_SLUG", "development")

TOTAL_RUNS = int(os.getenv("BENCH_TOTAL_RUNS", "8"))
CONCURRENCY = int(os.getenv("BENCH_CONCURRENCY", "2"))
VISIBILITY_TIMEOUT_S = float(os.getenv("BENCH_VISIBILITY_TIMEOUT_S", "60"))
POLL_INTERVAL_S = float(os.getenv("BENCH_POLL_INTERVAL_S", "1.0"))


def pct(values: List[float], p: float) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    idx = int(round((p / 100.0) * (len(sorted_values) - 1)))
    return sorted_values[idx]


async def fetch_project_id(client: httpx.AsyncClient, headers: Dict[str, str]) -> str:
    resp = await client.get(f"{BASE_URL}/api/projects", headers=headers)
    resp.raise_for_status()
    rows = resp.json()
    if not rows:
        raise RuntimeError("No projects returned for API key")
    return rows[0]["project_id"]


async def fetch_app_id(
    client: httpx.AsyncClient, headers: Dict[str, str], project_id: str
) -> Optional[str]:
    resp = await client.get(
        f"{BASE_URL}/api/apps",
        params={"project_id": project_id},
        headers=headers,
    )
    resp.raise_for_status()
    rows = resp.json()
    for row in rows:
        if row.get("app_name") == APP_SLUG:
            return row.get("app_id")
    return None


async def run_one(
    idx: int,
    client: httpx.AsyncClient,
    headers: Dict[str, str],
) -> Dict[str, Any]:
    payload = {
        "inputs": {"country": f"bench-e2e-{idx}"},
        "environment": ENV_SLUG,
        "app": APP_SLUG,
    }
    started = time.perf_counter()
    resp = await client.post(
        f"{BASE_URL}/services/completion/run",
        headers=headers,
        json=payload,
    )
    ended = time.perf_counter()
    latency_s = ended - started

    body: Dict[str, Any] = {}
    try:
        body = resp.json()
    except Exception:
        body = {}

    trace_id = body.get("trace_id")
    return {
        "status": resp.status_code,
        "latency_s": latency_s,
        "trace_id": trace_id,
        "ok": resp.status_code == 200 and bool(trace_id),
    }


async def wait_visible(
    client: httpx.AsyncClient,
    headers: Dict[str, str],
    project_id: str,
    trace_id: str,
) -> Dict[str, Any]:
    started = time.perf_counter()
    deadline = started + VISIBILITY_TIMEOUT_S
    last_status = None

    while time.perf_counter() < deadline:
        resp = await client.get(
            f"{BASE_URL}/api/preview/tracing/traces/{trace_id}",
            params={"project_id": project_id},
            headers=headers,
        )
        last_status = resp.status_code
        if resp.status_code == 200:
            try:
                data = resp.json()
                if data.get("count", 0) > 0:
                    return {
                        "visible": True,
                        "lag_s": time.perf_counter() - started,
                        "last_status": last_status,
                    }
            except Exception:
                pass
        await asyncio.sleep(POLL_INTERVAL_S)

    return {
        "visible": False,
        "lag_s": VISIBILITY_TIMEOUT_S,
        "last_status": last_status,
    }


async def fetch_analytics(
    client: httpx.AsyncClient,
    headers: Dict[str, str],
    project_id: str,
    app_id: Optional[str],
) -> Dict[str, Any]:
    oldest = (datetime.now(timezone.utc) - timedelta(hours=1)).replace(microsecond=0)
    params = {"project_id": project_id}
    if app_id:
        params["application_id"] = app_id

    resp = await client.post(
        f"{BASE_URL}/api/preview/tracing/spans/analytics",
        params=params,
        headers=headers,
        json={
            "focus": "trace",
            "oldest": oldest.isoformat().replace("+00:00", "Z"),
            "interval": 15,
        },
    )
    resp.raise_for_status()
    data = resp.json()
    buckets = data.get("buckets", [])
    total_count = sum((b.get("total") or {}).get("count", 0) for b in buckets)
    return {
        "bucket_count": len(buckets),
        "total_count": total_count,
    }


async def main() -> None:
    if not API_KEY:
        raise SystemExit("AGENTA_API_KEY is required")

    headers = {
        "Authorization": f"ApiKey {API_KEY}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=90.0) as client:
        project_id = await fetch_project_id(client, headers)
        app_id = await fetch_app_id(client, headers, project_id)

        print(f"base_url={BASE_URL}")
        print(f"project_id={project_id}")
        print(f"app_slug={APP_SLUG}")
        print(f"app_id={app_id}")
        print(f"runs={TOTAL_RUNS}, concurrency={CONCURRENCY}")

        sem = asyncio.Semaphore(CONCURRENCY)
        run_results: List[Dict[str, Any]] = []

        async def wrapped_run(i: int) -> None:
            async with sem:
                run_results.append(await run_one(i, client, headers))

        t0 = time.perf_counter()
        await asyncio.gather(*(wrapped_run(i) for i in range(TOTAL_RUNS)))
        send_elapsed = time.perf_counter() - t0

        successful = [r for r in run_results if r["ok"]]
        trace_ids = [r["trace_id"] for r in successful]

        visibility_results: List[Dict[str, Any]] = []

        async def wrapped_visibility(tid: str) -> None:
            async with sem:
                visibility_results.append(
                    await wait_visible(client, headers, project_id, tid)
                )

        t1 = time.perf_counter()
        await asyncio.gather(*(wrapped_visibility(tid) for tid in trace_ids))
        visibility_elapsed = time.perf_counter() - t1

        analytics = await fetch_analytics(client, headers, project_id, app_id)

    http_200 = sum(1 for r in run_results if r["status"] == 200)
    http_errors = TOTAL_RUNS - http_200
    run_latencies = [r["latency_s"] for r in run_results if r["status"] == 200]
    visible_count = sum(1 for r in visibility_results if r["visible"])
    visibility_lags = [r["lag_s"] for r in visibility_results if r["visible"]]

    print("\n--- benchmark summary ---")
    print(f"http_200={http_200}/{TOTAL_RUNS}, http_errors={http_errors}")
    print(
        f"send_elapsed_s={send_elapsed:.3f}, send_rate_rps={TOTAL_RUNS/send_elapsed:.2f}"
    )
    if run_latencies:
        print(
            "run_latency_s: "
            f"mean={statistics.mean(run_latencies):.3f}, "
            f"p50={pct(run_latencies, 50):.3f}, "
            f"p95={pct(run_latencies, 95):.3f}"
        )
    print(
        f"trace_visible={visible_count}/{len(trace_ids)} "
        f"(timeout={VISIBILITY_TIMEOUT_S:.0f}s), verify_elapsed_s={visibility_elapsed:.3f}"
    )
    if visibility_lags:
        print(
            "visibility_lag_s: "
            f"mean={statistics.mean(visibility_lags):.3f}, "
            f"p50={pct(visibility_lags, 50):.3f}, "
            f"p95={pct(visibility_lags, 95):.3f}"
        )
    print(
        f"analytics_last_1h_total_count={analytics['total_count']} "
        f"across {analytics['bucket_count']} buckets"
    )


if __name__ == "__main__":
    asyncio.run(main())
