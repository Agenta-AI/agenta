# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "daytona",
# ]
# ///
"""Measure sandbox cold start from the prebuilt Pi snapshot vs the default
`daytona-small`, to answer the WP-3 open question. Creates N sandboxes per snapshot
(serially), times `create()` -> STARTED, then deletes. Prints per-create timings and
a summary."""

import os
import statistics
import time

from daytona import CreateSandboxFromSnapshotParams, Daytona, DaytonaConfig

N = 3
SNAPSHOTS = ["agenta-pi-harness", "daytona-small"]

daytona = Daytona(
    DaytonaConfig(
        api_key=os.environ["DAYTONA_API_KEY"],
        api_url=os.environ.get("DAYTONA_API_URL", "https://app.daytona.io/api"),
        target=os.environ.get("DAYTONA_TARGET", "eu"),
    )
)

results: dict[str, list[float]] = {}
for snap in SNAPSHOTS:
    times: list[float] = []
    for i in range(N):
        t = time.monotonic()
        sb = daytona.create(
            CreateSandboxFromSnapshotParams(snapshot=snap, auto_stop_interval=0),
            timeout=120,
        )
        dt = time.monotonic() - t
        times.append(dt)
        print(f"{snap:20} run {i + 1}/{N}: {dt:.2f}s  state={sb.state}", flush=True)
        daytona.delete(sb)
    results[snap] = times

print("\n=== cold-start summary (create -> STARTED) ===")
for snap, times in results.items():
    print(
        f"{snap:20} min={min(times):.2f}s  mean={statistics.mean(times):.2f}s  "
        f"max={max(times):.2f}s  n={len(times)}"
    )
