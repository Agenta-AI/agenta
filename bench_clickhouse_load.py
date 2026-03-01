# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "requests",
# ]
# ///
"""Load a small sample of spans into ClickHouse.

Usage:
  uv run bench_clickhouse_load.py

Env vars:
  CLICKHOUSE_URL (default: https://er3fulih5c.eu-central-1.aws.clickhouse.cloud:8443)
  CLICKHOUSE_USER (default: default)
  CLICKHOUSE_PASSWORD
  CLICKHOUSE_DATABASE (default: default)
  TABLE_NAME (default: spans)
  TOTAL_TRACES (default: 1000)
  SPANS_PER_TRACE (default: 3)
  PROJECT_ID (default: random UUID)
  CREATED_BY_ID (default: random UUID)
  START_DATE (default: 2025-11-29)
  DAYS_SPAN (default: 90)
  BATCH_SPANS (default: 50000)
"""

from __future__ import annotations

import os
import uuid
import json
from datetime import datetime, timezone

import requests


CLICKHOUSE_URL = os.getenv(
    "CLICKHOUSE_URL", "https://er3fulih5c.eu-central-1.aws.clickhouse.cloud:8443"
)
CLICKHOUSE_USER = os.getenv("CLICKHOUSE_USER", "default")
CLICKHOUSE_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "")
CLICKHOUSE_DATABASE = os.getenv("CLICKHOUSE_DATABASE", "default")
TABLE_NAME = os.getenv("TABLE_NAME", "spans")

TOTAL_TRACES = int(os.getenv("TOTAL_TRACES", "1000"))
SPANS_PER_TRACE = int(os.getenv("SPANS_PER_TRACE", "3"))
PROJECT_ID = os.getenv("PROJECT_ID")
CREATED_BY_ID = os.getenv("CREATED_BY_ID")
START_DATE = os.getenv("START_DATE", "2025-11-29")
DAYS_SPAN = int(os.getenv("DAYS_SPAN", "90"))
BATCH_SPANS = int(os.getenv("BATCH_SPANS", "50000"))


def ts_for_offset(day_offset: int, seconds_offset: int) -> str:
    base = datetime.strptime(START_DATE, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    value = base.timestamp() + (day_offset * 86400) + seconds_offset
    return datetime.fromtimestamp(value, tz=timezone.utc).strftime(
        "%Y-%m-%d %H:%M:%S.%f"
    )


def build_rows_for_trace(
    *,
    project_id: str,
    created_by_id: str,
    trace_index: int,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    project_id = PROJECT_ID or str(uuid.uuid4())
    created_by_id = CREATED_BY_ID or str(uuid.uuid4())

    trace_id = str(uuid.uuid4())
    root_span_id = str(uuid.uuid4())
    day_offset = trace_index % max(DAYS_SPAN, 1)
    created_at = ts_for_offset(day_offset, 10)
    start_time = ts_for_offset(day_offset, 20)
    end_time = ts_for_offset(day_offset, 40)

    root = {
            "project_id": project_id,
            "created_at": created_at,
            "updated_at": None,
            "deleted_at": None,
            "created_by_id": created_by_id,
            "updated_by_id": None,
            "deleted_by_id": None,
            "trace_id": trace_id,
            "span_id": root_span_id,
            "parent_id": None,
            "trace_type": "INVOCATION",
            "span_type": "WORKFLOW",
            "span_kind": "SPAN_KIND_INTERNAL",
            "span_name": "workflow",
            "start_time": start_time,
            "end_time": end_time,
            "status_code": "STATUS_CODE_OK",
            "status_message": None,
            "attributes": {
                "ag": {
                    "type": {"trace": "generation", "span": "workflow"},
                    "metrics": {
                        "duration": {"cumulative": 1200},
                        "tokens": {"cumulative": {"total": 2000}},
                        "costs": {"cumulative": {"total": 0.04}},
                    },
                }
            },
            "references": None,
            "links": None,
            "hashes": None,
            "events": None,
        }
    rows.append(root)

    for i in range(SPANS_PER_TRACE - 1):
        child = {
                "project_id": project_id,
                "created_at": created_at,
                "updated_at": None,
                "deleted_at": None,
                "created_by_id": created_by_id,
                "updated_by_id": None,
                "deleted_by_id": None,
                "trace_id": trace_id,
                "span_id": str(uuid.uuid4()),
                "parent_id": root_span_id,
                "trace_type": "INVOCATION",
                "span_type": "CHAT",
                "span_kind": "SPAN_KIND_CLIENT",
                "span_name": f"llm-call-{i}",
                "start_time": start_time,
                "end_time": end_time,
                "status_code": "STATUS_CODE_OK",
                "status_message": None,
                "attributes": {
                    "gen_ai": {
                        "system": "openai",
                        "usage": {
                            "prompt_tokens": 1200,
                            "completion_tokens": 800,
                        },
                        "response": {"model": "gpt-4o"},
                    },
                    "ag": {
                        "type": {"trace": "generation", "span": "chat"},
                        "metrics": {
                            "duration": {"cumulative": 450},
                            "tokens": {"cumulative": {"total": 2000}},
                            "costs": {"cumulative": {"total": 0.04}},
                        },
                    },
                },
                "references": None,
                "links": None,
                "hashes": None,
                "events": None,
            }
        rows.append(child)

    return rows


def main() -> None:
    project_id = PROJECT_ID or str(uuid.uuid4())
    created_by_id = CREATED_BY_ID or str(uuid.uuid4())

    query = f"INSERT INTO {CLICKHOUSE_DATABASE}.{TABLE_NAME} FORMAT JSONEachRow"
    total_spans = TOTAL_TRACES * SPANS_PER_TRACE
    sent_spans = 0

    session = requests.Session()

    batch: list[dict[str, object]] = []
    for i in range(TOTAL_TRACES):
        batch.extend(
            build_rows_for_trace(
                project_id=project_id,
                created_by_id=created_by_id,
                trace_index=i,
            )
        )

        if len(batch) >= BATCH_SPANS:
            payload = "\n".join(json.dumps(row) for row in batch)
            response = session.post(
                CLICKHOUSE_URL,
                params={"query": query},
                auth=(CLICKHOUSE_USER, CLICKHOUSE_PASSWORD),
                data=payload.encode("utf-8"),
                headers={"Content-Type": "application/json"},
                timeout=120,
            )
            response.raise_for_status()
            sent_spans += len(batch)
            batch = []

            print(f"Inserted {sent_spans}/{total_spans} spans")

    if batch:
        payload = "\n".join(json.dumps(row) for row in batch)
        response = session.post(
            CLICKHOUSE_URL,
            params={"query": query},
            auth=(CLICKHOUSE_USER, CLICKHOUSE_PASSWORD),
            data=payload.encode("utf-8"),
            headers={"Content-Type": "application/json"},
            timeout=120,
        )
        response.raise_for_status()
        sent_spans += len(batch)

    print(
        f"Inserted {sent_spans} spans for {TOTAL_TRACES} traces into "
        f"{CLICKHOUSE_DATABASE}.{TABLE_NAME}"
    )


if __name__ == "__main__":
    if not CLICKHOUSE_PASSWORD:
        raise SystemExit("CLICKHOUSE_PASSWORD is required")
    main()
