# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "asyncpg",
#     "rich",
# ]
# ///
"""
Direct SQL benchmark: raw hypertable queries vs continuous aggregate queries.

Tests the same logical queries against:
1. Raw spans hypertable (what the Agenta API does)
2. daily_trace_stats continuous aggregate (pre-computed)

Usage:
    uv run bench_sql.py
"""

import asyncio
import ssl
import time
import json
import statistics
from typing import Any

import asyncpg
from rich.console import Console
from rich.table import Table

# ─── Configuration ───────────────────────────────────────────────────────────

DSN = "postgresql://tsdbadmin:di1pfjy4if9kiumq@p8m4busixa.ciet06s68p.tsdb.cloud.timescale.com:32877/tsdb"
PROJECT_ID = "019ca07e-1356-7793-a78e-132432eef0ce"

WARMUP = 1
RUNS = 3

console = Console()

# ─── Queries ─────────────────────────────────────────────────────────────────

QUERIES = [
    # ══════════════════════════════════════════════════════════════════════
    # 1. Simple count — 30 days
    # ══════════════════════════════════════════════════════════════════════
    {
        "name": "Count root spans — 30 days",
        "raw": """
            SELECT count(*)
            FROM spans
            WHERE project_id = $1
              AND created_at >= '2026-01-29T00:00:00Z'
              AND created_at < '2026-02-28T00:00:00Z'
              AND parent_id IS NULL
        """,
        "cagg": """
            SELECT sum(trace_count)
            FROM daily_trace_stats
            WHERE project_id = $1
              AND bucket >= '2026-01-29T00:00:00Z'
              AND bucket < '2026-02-28T00:00:00Z'
        """,
    },
    # ══════════════════════════════════════════════════════════════════════
    # 2. Simple count — 90 days
    # ══════════════════════════════════════════════════════════════════════
    {
        "name": "Count root spans — 90 days",
        "raw": """
            SELECT count(*)
            FROM spans
            WHERE project_id = $1
              AND created_at >= '2025-11-29T00:00:00Z'
              AND created_at < '2026-02-28T00:00:00Z'
              AND parent_id IS NULL
        """,
        "cagg": """
            SELECT sum(trace_count)
            FROM daily_trace_stats
            WHERE project_id = $1
              AND bucket >= '2025-11-29T00:00:00Z'
              AND bucket < '2026-02-28T00:00:00Z'
        """,
    },
    # ══════════════════════════════════════════════════════════════════════
    # 3. Avg/sum/min/max duration — 30 days
    # ══════════════════════════════════════════════════════════════════════
    {
        "name": "Duration stats — 30 days",
        "raw": """
            SELECT
                count(*),
                avg((attributes #>> '{ag,metrics,duration,cumulative}')::double precision),
                min((attributes #>> '{ag,metrics,duration,cumulative}')::double precision),
                max((attributes #>> '{ag,metrics,duration,cumulative}')::double precision),
                sum((attributes #>> '{ag,metrics,duration,cumulative}')::double precision)
            FROM spans
            WHERE project_id = $1
              AND created_at >= '2026-01-29T00:00:00Z'
              AND created_at < '2026-02-28T00:00:00Z'
              AND parent_id IS NULL
              AND jsonb_typeof(attributes #> '{ag,metrics,duration,cumulative}') = 'number'
        """,
        "cagg": """
            SELECT
                sum(trace_count),
                sum(sum_duration) / sum(trace_count),
                min(min_duration),
                max(max_duration),
                sum(sum_duration)
            FROM daily_trace_stats
            WHERE project_id = $1
              AND bucket >= '2026-01-29T00:00:00Z'
              AND bucket < '2026-02-28T00:00:00Z'
        """,
    },
    # ══════════════════════════════════════════════════════════════════════
    # 4. Avg/sum/min/max duration — 90 days
    # ══════════════════════════════════════════════════════════════════════
    {
        "name": "Duration stats — 90 days",
        "raw": """
            SELECT
                count(*),
                avg((attributes #>> '{ag,metrics,duration,cumulative}')::double precision),
                min((attributes #>> '{ag,metrics,duration,cumulative}')::double precision),
                max((attributes #>> '{ag,metrics,duration,cumulative}')::double precision),
                sum((attributes #>> '{ag,metrics,duration,cumulative}')::double precision)
            FROM spans
            WHERE project_id = $1
              AND created_at >= '2025-11-29T00:00:00Z'
              AND created_at < '2026-02-28T00:00:00Z'
              AND parent_id IS NULL
              AND jsonb_typeof(attributes #> '{ag,metrics,duration,cumulative}') = 'number'
        """,
        "cagg": """
            SELECT
                sum(trace_count),
                sum(sum_duration) / sum(trace_count),
                min(min_duration),
                max(max_duration),
                sum(sum_duration)
            FROM daily_trace_stats
            WHERE project_id = $1
              AND bucket >= '2025-11-29T00:00:00Z'
              AND bucket < '2026-02-28T00:00:00Z'
        """,
    },
    # ══════════════════════════════════════════════════════════════════════
    # 5. Daily time series of avg duration — 30 days
    # ══════════════════════════════════════════════════════════════════════
    {
        "name": "Daily duration time series — 30 days",
        "raw": """
            SELECT
                date_bin('1 day', created_at, '2026-01-29T00:00:00Z'::timestamptz) AS bucket,
                count(*),
                avg((attributes #>> '{ag,metrics,duration,cumulative}')::double precision),
                sum((attributes #>> '{ag,metrics,duration,cumulative}')::double precision)
            FROM spans
            WHERE project_id = $1
              AND created_at >= '2026-01-29T00:00:00Z'
              AND created_at < '2026-02-28T00:00:00Z'
              AND parent_id IS NULL
              AND jsonb_typeof(attributes #> '{ag,metrics,duration,cumulative}') = 'number'
            GROUP BY bucket
            ORDER BY bucket
        """,
        "cagg": """
            SELECT
                bucket,
                trace_count,
                avg_duration,
                sum_duration
            FROM daily_trace_stats
            WHERE project_id = $1
              AND bucket >= '2026-01-29T00:00:00Z'
              AND bucket < '2026-02-28T00:00:00Z'
            ORDER BY bucket
        """,
    },
    # ══════════════════════════════════════════════════════════════════════
    # 6. Daily time series of avg duration — 90 days
    # ══════════════════════════════════════════════════════════════════════
    {
        "name": "Daily duration time series — 90 days",
        "raw": """
            SELECT
                date_bin('1 day', created_at, '2025-11-29T00:00:00Z'::timestamptz) AS bucket,
                count(*),
                avg((attributes #>> '{ag,metrics,duration,cumulative}')::double precision),
                sum((attributes #>> '{ag,metrics,duration,cumulative}')::double precision)
            FROM spans
            WHERE project_id = $1
              AND created_at >= '2025-11-29T00:00:00Z'
              AND created_at < '2026-02-28T00:00:00Z'
              AND parent_id IS NULL
              AND jsonb_typeof(attributes #> '{ag,metrics,duration,cumulative}') = 'number'
            GROUP BY bucket
            ORDER BY bucket
        """,
        "cagg": """
            SELECT
                bucket,
                trace_count,
                avg_duration,
                sum_duration
            FROM daily_trace_stats
            WHERE project_id = $1
              AND bucket >= '2025-11-29T00:00:00Z'
              AND bucket < '2026-02-28T00:00:00Z'
            ORDER BY bucket
        """,
    },
    # ══════════════════════════════════════════════════════════════════════
    # 7. Multi-metric daily time series — 30 days
    # ══════════════════════════════════════════════════════════════════════
    {
        "name": "Multi-metric daily series — 30 days",
        "raw": """
            SELECT
                date_bin('1 day', created_at, '2026-01-29T00:00:00Z'::timestamptz) AS bucket,
                count(*),
                avg((attributes #>> '{ag,metrics,duration,cumulative}')::double precision) AS avg_dur,
                sum((attributes #>> '{ag,metrics,costs,cumulative,total}')::double precision) AS sum_cost,
                sum((attributes #>> '{ag,metrics,tokens,cumulative,total}')::double precision) AS sum_tokens
            FROM spans
            WHERE project_id = $1
              AND created_at >= '2026-01-29T00:00:00Z'
              AND created_at < '2026-02-28T00:00:00Z'
              AND parent_id IS NULL
            GROUP BY bucket
            ORDER BY bucket
        """,
        "cagg": """
            SELECT
                bucket,
                trace_count,
                avg_duration AS avg_dur,
                sum_cost,
                sum_tokens
            FROM daily_trace_stats
            WHERE project_id = $1
              AND bucket >= '2026-01-29T00:00:00Z'
              AND bucket < '2026-02-28T00:00:00Z'
            ORDER BY bucket
        """,
    },
    # ══════════════════════════════════════════════════════════════════════
    # 8. Multi-metric daily time series — 90 days
    # ══════════════════════════════════════════════════════════════════════
    {
        "name": "Multi-metric daily series — 90 days",
        "raw": """
            SELECT
                date_bin('1 day', created_at, '2025-11-29T00:00:00Z'::timestamptz) AS bucket,
                count(*),
                avg((attributes #>> '{ag,metrics,duration,cumulative}')::double precision) AS avg_dur,
                sum((attributes #>> '{ag,metrics,costs,cumulative,total}')::double precision) AS sum_cost,
                sum((attributes #>> '{ag,metrics,tokens,cumulative,total}')::double precision) AS sum_tokens
            FROM spans
            WHERE project_id = $1
              AND created_at >= '2025-11-29T00:00:00Z'
              AND created_at < '2026-02-28T00:00:00Z'
              AND parent_id IS NULL
            GROUP BY bucket
            ORDER BY bucket
        """,
        "cagg": """
            SELECT
                bucket,
                trace_count,
                avg_duration AS avg_dur,
                sum_cost,
                sum_tokens
            FROM daily_trace_stats
            WHERE project_id = $1
              AND bucket >= '2025-11-29T00:00:00Z'
              AND bucket < '2026-02-28T00:00:00Z'
            ORDER BY bucket
        """,
    },
    # ══════════════════════════════════════════════════════════════════════
    # 9. Percentile query (p50, p90, p95, p99) — 30 days
    #    (No CAGG equivalent — percentiles need raw data or tdigest)
    # ══════════════════════════════════════════════════════════════════════
    {
        "name": "Percentiles (p50/90/95/99) — 30 days",
        "raw": """
            SELECT
                percentile_cont(ARRAY[0.5, 0.9, 0.95, 0.99])
                    WITHIN GROUP (ORDER BY (attributes #>> '{ag,metrics,duration,cumulative}')::double precision)
            FROM spans
            WHERE project_id = $1
              AND created_at >= '2026-01-29T00:00:00Z'
              AND created_at < '2026-02-28T00:00:00Z'
              AND parent_id IS NULL
              AND jsonb_typeof(attributes #> '{ag,metrics,duration,cumulative}') = 'number'
        """,
        "cagg": None,  # No CAGG equivalent without tdigest/uddsketch
    },
    # ══════════════════════════════════════════════════════════════════════
    # 10. Percentile query — 90 days
    # ══════════════════════════════════════════════════════════════════════
    {
        "name": "Percentiles (p50/90/95/99) — 90 days",
        "raw": """
            SELECT
                percentile_cont(ARRAY[0.5, 0.9, 0.95, 0.99])
                    WITHIN GROUP (ORDER BY (attributes #>> '{ag,metrics,duration,cumulative}')::double precision)
            FROM spans
            WHERE project_id = $1
              AND created_at >= '2025-11-29T00:00:00Z'
              AND created_at < '2026-02-28T00:00:00Z'
              AND parent_id IS NULL
              AND jsonb_typeof(attributes #> '{ag,metrics,duration,cumulative}') = 'number'
        """,
        "cagg": None,
    },
    # ══════════════════════════════════════════════════════════════════════
    # 11. Approximate percentiles using TimescaleDB Toolkit (if available)
    # ══════════════════════════════════════════════════════════════════════
    {
        "name": "approx_percentile (uddsketch) — 90 days",
        "raw": """
            SELECT
                approx_percentile(0.5, percentile_agg((attributes #>> '{ag,metrics,duration,cumulative}')::double precision)) AS p50,
                approx_percentile(0.9, percentile_agg((attributes #>> '{ag,metrics,duration,cumulative}')::double precision)) AS p90,
                approx_percentile(0.95, percentile_agg((attributes #>> '{ag,metrics,duration,cumulative}')::double precision)) AS p95,
                approx_percentile(0.99, percentile_agg((attributes #>> '{ag,metrics,duration,cumulative}')::double precision)) AS p99
            FROM spans
            WHERE project_id = $1
              AND created_at >= '2025-11-29T00:00:00Z'
              AND created_at < '2026-02-28T00:00:00Z'
              AND parent_id IS NULL
              AND jsonb_typeof(attributes #> '{ag,metrics,duration,cumulative}') = 'number'
        """,
        "cagg": None,
        "optional": True,  # May not be available
    },
    # ══════════════════════════════════════════════════════════════════════
    # 12. width_bucket histogram — 30 days
    # ══════════════════════════════════════════════════════════════════════
    {
        "name": "Histogram (width_bucket) — 30 days",
        "raw": """
            WITH stats AS (
                SELECT min((attributes #>> '{ag,metrics,duration,cumulative}')::double precision) AS vmin,
                       max((attributes #>> '{ag,metrics,duration,cumulative}')::double precision) AS vmax
                FROM spans
                WHERE project_id = $1
                  AND created_at >= '2026-01-29T00:00:00Z'
                  AND created_at < '2026-02-28T00:00:00Z'
                  AND parent_id IS NULL
                  AND jsonb_typeof(attributes #> '{ag,metrics,duration,cumulative}') = 'number'
            )
            SELECT
                width_bucket(
                    (attributes #>> '{ag,metrics,duration,cumulative}')::double precision,
                    s.vmin, s.vmax + 0.001, 100
                ) AS bucket,
                count(*)
            FROM spans, stats s
            WHERE project_id = $1
              AND created_at >= '2026-01-29T00:00:00Z'
              AND created_at < '2026-02-28T00:00:00Z'
              AND parent_id IS NULL
              AND jsonb_typeof(attributes #> '{ag,metrics,duration,cumulative}') = 'number'
            GROUP BY bucket
            ORDER BY bucket
        """,
        "cagg": None,
    },
    # ══════════════════════════════════════════════════════════════════════
    # 13. width_bucket histogram — 90 days
    # ══════════════════════════════════════════════════════════════════════
    {
        "name": "Histogram (width_bucket) — 90 days",
        "raw": """
            WITH stats AS (
                SELECT min((attributes #>> '{ag,metrics,duration,cumulative}')::double precision) AS vmin,
                       max((attributes #>> '{ag,metrics,duration,cumulative}')::double precision) AS vmax
                FROM spans
                WHERE project_id = $1
                  AND created_at >= '2025-11-29T00:00:00Z'
                  AND created_at < '2026-02-28T00:00:00Z'
                  AND parent_id IS NULL
                  AND jsonb_typeof(attributes #> '{ag,metrics,duration,cumulative}') = 'number'
            )
            SELECT
                width_bucket(
                    (attributes #>> '{ag,metrics,duration,cumulative}')::double precision,
                    s.vmin, s.vmax + 0.001, 100
                ) AS bucket,
                count(*)
            FROM spans, stats s
            WHERE project_id = $1
              AND created_at >= '2025-11-29T00:00:00Z'
              AND created_at < '2026-02-28T00:00:00Z'
              AND parent_id IS NULL
              AND jsonb_typeof(attributes #> '{ag,metrics,duration,cumulative}') = 'number'
            GROUP BY bucket
            ORDER BY bucket
        """,
        "cagg": None,
    },
]


# ─── Runner ──────────────────────────────────────────────────────────────────

async def run_query(conn: asyncpg.Connection, sql: str, params: list) -> tuple[float, int]:
    """Returns (elapsed_seconds, row_count)."""
    t0 = time.perf_counter()
    rows = await conn.fetch(sql, *params)
    elapsed = time.perf_counter() - t0
    return elapsed, len(rows)


async def main():
    console.rule("[bold cyan]SQL Benchmark: Raw Hypertable vs Continuous Aggregate")
    console.print(f"  Warmup: {WARMUP} run(s)   Bench: {RUNS} run(s)")
    console.print()

    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    conn = await asyncpg.connect(DSN, ssl=ssl_ctx)
    await conn.execute("SET statement_timeout = '120s'")

    results = []

    for i, q in enumerate(QUERIES, 1):
        name = q["name"]
        raw_sql = q["raw"]
        cagg_sql = q.get("cagg")
        is_optional = q.get("optional", False)
        params = [PROJECT_ID]

        console.print(f"[{i}/{len(QUERIES)}] [bold]{name}[/bold]")

        # ─── Raw query ────────────────────────────────────────────────
        raw_timings = []
        raw_rows = 0
        raw_error = None
        try:
            for _ in range(WARMUP):
                await run_query(conn, raw_sql, params)
            for _ in range(RUNS):
                elapsed, raw_rows = await run_query(conn, raw_sql, params)
                raw_timings.append(elapsed)
        except Exception as e:
            raw_error = str(e)
            if is_optional:
                raw_timings = []
            else:
                raise

        if raw_error:
            console.print(f"  [red]RAW   ERROR: {raw_error[:80]}[/red]")
        else:
            avg = statistics.mean(raw_timings)
            console.print(
                f"  RAW   rows={raw_rows:>4}  "
                f"avg={avg:.4f}s  min={min(raw_timings):.4f}s  max={max(raw_timings):.4f}s"
            )

        # ─── CAGG query ──────────────────────────────────────────────
        cagg_timings = []
        cagg_rows = 0
        cagg_error = None
        if cagg_sql:
            try:
                for _ in range(WARMUP):
                    await run_query(conn, cagg_sql, params)
                for _ in range(RUNS):
                    elapsed, cagg_rows = await run_query(conn, cagg_sql, params)
                    cagg_timings.append(elapsed)
            except Exception as e:
                cagg_error = str(e)

            if cagg_error:
                console.print(f"  [red]CAGG  ERROR: {cagg_error[:80]}[/red]")
            else:
                avg = statistics.mean(cagg_timings)
                console.print(
                    f"  CAGG  rows={cagg_rows:>4}  "
                    f"avg={avg:.4f}s  min={min(cagg_timings):.4f}s  max={max(cagg_timings):.4f}s"
                )
        else:
            console.print("  CAGG  [dim]n/a (requires raw data)[/dim]")

        # Speedup
        if raw_timings and cagg_timings:
            raw_avg = statistics.mean(raw_timings)
            cagg_avg = statistics.mean(cagg_timings)
            speedup = raw_avg / cagg_avg if cagg_avg > 0 else float("inf")
            console.print(f"  [bold green]→ CAGG is {speedup:.1f}x faster[/bold green]")

        results.append({
            "name": name,
            "raw_avg": statistics.mean(raw_timings) if raw_timings else None,
            "raw_min": min(raw_timings) if raw_timings else None,
            "raw_max": max(raw_timings) if raw_timings else None,
            "raw_rows": raw_rows,
            "raw_error": raw_error,
            "cagg_avg": statistics.mean(cagg_timings) if cagg_timings else None,
            "cagg_min": min(cagg_timings) if cagg_timings else None,
            "cagg_max": max(cagg_timings) if cagg_timings else None,
            "cagg_rows": cagg_rows,
            "cagg_error": cagg_error,
        })
        console.print()

    await conn.close()

    # ─── Summary table ────────────────────────────────────────────────
    console.rule("[bold cyan]Summary")

    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Query", style="bold", min_width=38)
    table.add_column("Raw Avg", justify="right", width=10)
    table.add_column("CAGG Avg", justify="right", width=10)
    table.add_column("Speedup", justify="right", width=10)

    for r in results:
        raw_str = f"{r['raw_avg']:.4f}s" if r['raw_avg'] is not None else (r["raw_error"] or "err")[:10]
        cagg_str = f"{r['cagg_avg']:.4f}s" if r['cagg_avg'] is not None else "n/a"

        if r['raw_avg'] and r['cagg_avg']:
            speedup = r['raw_avg'] / r['cagg_avg']
            color = "green" if speedup > 5 else ("yellow" if speedup > 2 else "white")
            speedup_str = f"[{color}]{speedup:.1f}x[/{color}]"
        else:
            speedup_str = "—"

        raw_color = "green" if r['raw_avg'] and r['raw_avg'] < 2 else ("yellow" if r['raw_avg'] and r['raw_avg'] < 10 else "red")
        table.add_row(
            r["name"],
            f"[{raw_color}]{raw_str}[/{raw_color}]",
            f"[green]{cagg_str}[/green]",
            speedup_str,
        )

    console.print(table)

    with open("bench_sql_results.json", "w") as f:
        json.dump(results, f, indent=2, default=str)
    console.print("\nResults saved to [bold]bench_sql_results.json[/bold]")


if __name__ == "__main__":
    asyncio.run(main())
