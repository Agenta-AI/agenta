# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "httpx",
# ]
# ///
"""Benchmark tracing analytics API against the current Timescale-backed dataset.

Usage:
  AGENTA_API_KEY=... uv run bench_analytics.py

Optional env vars:
  AGENTA_ANALYTICS_URL   (default: http://144.76.237.122:8580/api/tracing/analytics/query)
  BENCH_DAYS             (default: 14)
  BENCH_RUNS             (default: 7)
  BENCH_WARMUP           (default: 1)
  BENCH_RATE             (default: 0.02)
  BENCH_TIMEOUT_SECONDS  (default: 120)
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List

import httpx


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _percentile(values: List[float], p: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    sorted_vals = sorted(values)
    pos = (len(sorted_vals) - 1) * p
    lo = int(pos)
    hi = min(lo + 1, len(sorted_vals) - 1)
    if lo == hi:
        return sorted_vals[lo]
    weight = pos - lo
    return sorted_vals[lo] * (1.0 - weight) + sorted_vals[hi] * weight


def _iso_utc(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


@dataclass
class BenchmarkCase:
    name: str
    body: Dict[str, Any]
    metric_paths: List[str]


def _build_cases(*, oldest: str, newest: str, rate: float) -> List[BenchmarkCase]:
    common = {
        "oldest": oldest,
        "newest": newest,
        # IMPORTANT: API interprets interval in MINUTES
        "interval": 1440,
        "rate": rate,
        "filter": {
            "operator": "and",
            "conditions": [
                {
                    "field": "attributes.ag.type.span",
                    "operator": "is",
                    "value": "workflow",
                }
            ],
        },
    }

    return [
        BenchmarkCase(
            name="duration_cost_tokens_daily",
            body={
                **common,
                "specs": [
                    {
                        "type": "numeric/continuous",
                        "path": "attributes.ag.metrics.duration.cumulative",
                    },
                    {
                        "type": "numeric/continuous",
                        "path": "attributes.ag.metrics.costs.cumulative.total",
                    },
                    {
                        "type": "numeric/continuous",
                        "path": "attributes.ag.metrics.tokens.cumulative.total",
                    },
                ],
            },
            metric_paths=[
                "attributes.ag.metrics.duration.cumulative",
                "attributes.ag.metrics.costs.cumulative.total",
                "attributes.ag.metrics.tokens.cumulative.total",
            ],
        ),
        BenchmarkCase(
            name="duration_p95_daily",
            body={
                **common,
                "specs": [
                    {
                        "type": "numeric/continuous",
                        "path": "attributes.ag.metrics.duration.cumulative",
                    }
                ],
            },
            metric_paths=["attributes.ag.metrics.duration.cumulative"],
        ),
        BenchmarkCase(
            name="tokens_histogram_daily",
            body={
                **common,
                "specs": [
                    {
                        "type": "numeric/continuous",
                        "path": "attributes.ag.metrics.tokens.cumulative.total",
                        "bins": 15,
                        "vmin": 0,
                        "vmax": 6000,
                    }
                ],
            },
            metric_paths=["attributes.ag.metrics.tokens.cumulative.total"],
        ),
        BenchmarkCase(
            name="high_cost_duration_daily",
            body={
                **common,
                "rate": max(rate, 0.05),
                "filter": {
                    "operator": "and",
                    "conditions": [
                        {
                            "field": "attributes.ag.type.span",
                            "operator": "is",
                            "value": "workflow",
                        },
                        {
                            "field": "attributes.ag.metrics.costs.cumulative.total",
                            "operator": "gt",
                            "value": 0.005,
                        },
                    ],
                },
                "specs": [
                    {
                        "type": "numeric/continuous",
                        "path": "attributes.ag.metrics.duration.cumulative",
                    },
                    {
                        "type": "numeric/continuous",
                        "path": "attributes.ag.metrics.costs.cumulative.total",
                    },
                    {
                        "type": "categorical/single",
                        "path": "attributes.ag.type.span",
                    },
                ],
            },
            metric_paths=[
                "attributes.ag.metrics.duration.cumulative",
                "attributes.ag.metrics.costs.cumulative.total",
                "attributes.ag.type.span",
            ],
        ),
    ]


def _extract_snapshot(data: Dict[str, Any], metric_paths: List[str]) -> Dict[str, Any]:
    buckets = data.get("buckets") or []
    if not buckets:
        return {"bucket_count": 0}

    first = buckets[0]
    metrics = first.get("metrics") or {}
    out: Dict[str, Any] = {
        "bucket_count": len(buckets),
        "first_bucket_timestamp": first.get("timestamp"),
        "metrics": {},
    }

    for path in metric_paths:
        metric = metrics.get(path)
        if not metric:
            continue

        item: Dict[str, Any] = {"type": metric.get("type")}
        for key in ("count", "mean", "min", "max", "sum"):
            if key in metric:
                item[key] = metric.get(key)

        pcts = metric.get("pcts") or {}
        if "p95" in pcts:
            item["p95"] = pcts.get("p95")

        hist = metric.get("hist") or []
        if hist:
            item["hist_bins"] = len(hist)
            item["hist_first_bin"] = hist[0]

        freq = metric.get("freq") or []
        if freq:
            item["freq_top3"] = freq[:3]

        out["metrics"][path] = item

    return out


def main() -> None:
    api_key = os.getenv("AGENTA_API_KEY")
    if not api_key:
        raise SystemExit("Set AGENTA_API_KEY in your environment.")

    analytics_url = os.getenv(
        "AGENTA_ANALYTICS_URL",
        "http://144.76.237.122:8580/api/tracing/analytics/query",
    )
    days = _env_int("BENCH_DAYS", 14)
    runs = _env_int("BENCH_RUNS", 7)
    warmup = _env_int("BENCH_WARMUP", 1)
    rate = _env_float("BENCH_RATE", 0.02)
    timeout_seconds = _env_float("BENCH_TIMEOUT_SECONDS", 120.0)

    now = datetime.now(timezone.utc)
    oldest = _iso_utc(now - timedelta(days=days))
    newest = _iso_utc(now)
    cases = _build_cases(oldest=oldest, newest=newest, rate=rate)

    print("Analytics benchmark")
    print(f"- URL: {analytics_url}")
    print(f"- Window: {oldest} -> {newest} ({days} days)")
    print(f"- Runs: {runs} (warmup {warmup})")
    print(f"- Sampling rate: {rate}")

    headers = {
        "Authorization": f"ApiKey {api_key}",
        "Content-Type": "application/json",
    }

    all_results: List[Dict[str, Any]] = []

    with httpx.Client(timeout=timeout_seconds) as client:
        for case in cases:
            print(f"\nCase: {case.name}")

            for _ in range(warmup):
                client.post(analytics_url, headers=headers, json=case.body)

            latencies_ms: List[float] = []
            statuses: List[int] = []
            counts: List[int] = []
            bucket_counts: List[int] = []
            snapshots: List[Dict[str, Any]] = []

            for i in range(runs):
                t0 = time.perf_counter()
                response = client.post(analytics_url, headers=headers, json=case.body)
                elapsed_ms = (time.perf_counter() - t0) * 1000.0

                latencies_ms.append(elapsed_ms)
                statuses.append(response.status_code)

                payload: Dict[str, Any] = {}
                try:
                    payload = response.json()
                except Exception:
                    payload = {"parse_error": True}

                count = int(payload.get("count", 0)) if isinstance(payload, dict) else 0
                buckets = payload.get("buckets") if isinstance(payload, dict) else []
                bucket_count = len(buckets) if isinstance(buckets, list) else 0

                counts.append(count)
                bucket_counts.append(bucket_count)
                snapshots.append(_extract_snapshot(payload, case.metric_paths))

                print(
                    f"  run {i + 1:02d}: status={response.status_code} "
                    f"latency={elapsed_ms:.1f}ms count={count} buckets={bucket_count}"
                )

            ok_runs = sum(1 for s in statuses if s == 200)
            likely_timeout_runs = sum(
                1
                for s, c in zip(statuses, counts)
                if s == 200 and c == 0
            )

            summary = {
                "name": case.name,
                "latency_ms": {
                    "min": round(min(latencies_ms), 2),
                    "p50": round(_percentile(latencies_ms, 0.50), 2),
                    "p95": round(_percentile(latencies_ms, 0.95), 2),
                    "max": round(max(latencies_ms), 2),
                    "mean": round(sum(latencies_ms) / len(latencies_ms), 2),
                },
                "runs": runs,
                "ok_runs": ok_runs,
                "likely_timeout_runs": likely_timeout_runs,
                "avg_count": round(sum(counts) / len(counts), 2),
                "avg_bucket_count": round(sum(bucket_counts) / len(bucket_counts), 2),
                "sample_snapshot": snapshots[-1] if snapshots else {},
                "request": case.body,
            }
            all_results.append(summary)

            print(
                "  summary: "
                f"p50={summary['latency_ms']['p50']}ms "
                f"p95={summary['latency_ms']['p95']}ms "
                f"ok={ok_runs}/{runs} "
                f"timeouts={likely_timeout_runs}"
            )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = Path(f"bench_analytics_results_{stamp}.json")
    out_payload = {
        "generated_at": _iso_utc(datetime.now(timezone.utc)),
        "analytics_url": analytics_url,
        "window": {"oldest": oldest, "newest": newest, "days": days},
        "runs": runs,
        "warmup": warmup,
        "rate": rate,
        "results": all_results,
    }
    out_path.write_text(json.dumps(out_payload, indent=2), encoding="utf-8")

    print(f"\nSaved: {out_path}")


if __name__ == "__main__":
    main()
