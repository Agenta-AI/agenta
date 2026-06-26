# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "daytona",
# ]
# ///
"""List non-archived sandboxes and delete any labeled as WP-3 runs (or pass an id).

Run:
    DAYTONA_API_KEY=... DAYTONA_API_URL=... DAYTONA_TARGET=eu uv run cleanup.py [sandbox_id ...]
"""

import os
import sys

from daytona import Daytona, DaytonaConfig

daytona = Daytona(
    DaytonaConfig(
        api_key=os.environ["DAYTONA_API_KEY"],
        api_url=os.environ.get("DAYTONA_API_URL", "https://app.daytona.io/api"),
        target=os.environ.get("DAYTONA_TARGET", "eu"),
    )
)

ids = sys.argv[1:]
boxes = list(daytona.list())
print(f"{len(boxes)} sandbox(es):")
for b in boxes:
    labels = getattr(b, "labels", {}) or {}
    is_wp3 = labels.get("agenta-wp") == "wp-3"
    print(f"  id={b.id} state={b.state} labels={labels}")
    if b.id in ids or (
        not ids
        and is_wp3
        and str(b.state) not in ("SandboxState.ARCHIVED", "SandboxState.DELETED")
    ):
        print(f"    -> deleting {b.id}")
        try:
            daytona.delete(b)
            print("    deleted.")
        except Exception as e:  # noqa: BLE001
            print(f"    delete failed: {e}")
