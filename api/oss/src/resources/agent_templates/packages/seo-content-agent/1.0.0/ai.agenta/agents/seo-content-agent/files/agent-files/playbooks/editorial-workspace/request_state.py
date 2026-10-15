"""Validate and track file-backed editorial work. Never dispatches external work itself.
Usage: python3 request_state.py inspect|start REQUEST.md
       python3 request_state.py complete|block|fail REQUEST.md --summary TEXT [--output PATH ...]
"""

import argparse
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path


def read_note(path):
    text = path.read_text()
    m = re.match(r"^---\n(.*?)\n---\n*", text, re.S)
    if not m:
        raise ValueError("Request needs frontmatter")
    meta = {}
    for line in m[1].splitlines():
        k, sep, v = line.partition(":")
        if sep:
            meta[k] = json.loads(v.strip())
    return meta, text[m.end() :]


def inside(root, rel):
    if not isinstance(rel, str) or Path(rel).is_absolute() or ".." in Path(rel).parts:
        raise ValueError("Invalid workspace-relative path")
    path = (root / rel).resolve()
    path.relative_to(root.resolve())
    return path


def inspect(path):
    path = path.resolve()
    if path.parent.name != "requests" or not re.fullmatch(
        r"work-[a-z0-9-]+\.md", path.name
    ):
        raise ValueError("Not a workspace request path")
    root = path.parent.parent
    meta, body = read_note(path)
    if (
        meta.get("schema") != 1
        or meta.get("type") != "agent_request"
        or meta.get("id") != path.stem
    ):
        raise ValueError("Unsupported request")
    if meta.get("status") not in [
        "saved",
        "in_progress",
        "completed",
        "blocked",
        "failed",
        "cancelled",
    ]:
        raise ValueError("Unsupported status")
    hashes = meta.get("source_hashes")
    if not isinstance(hashes, dict):
        raise ValueError("Source hashes missing")
    stale = []
    for rel, expected in hashes.items():
        src = inside(root, rel)
        if not re.fullmatch(r"[0-9a-f]{64}", expected):
            raise ValueError("Invalid source digest")
        if (
            not src.is_file()
            or hashlib.sha256(src.read_bytes()).hexdigest() != expected
        ):
            stale.append(rel)
        if src.is_file() and src.read_text().startswith("---\n"):
            source_meta, _ = read_note(src)
            if source_meta.get("generated"):
                original = inside(root.parent.parent, source_meta.get("canonical_path"))
                if not original.is_file() or hashlib.sha256(
                    original.read_bytes()
                ).hexdigest() != source_meta.get("canonical_sha256"):
                    stale.append("canonical:" + source_meta["canonical_path"])
    target = meta.get("target_path")
    if target is not None and target not in hashes:
        raise ValueError("Target missing from source snapshot")
    approval = meta.get("approval")
    if approval and (
        approval.get("kind") not in ["brief", "draft"]
        or hashes.get(approval.get("path")) != approval.get("sha256")
    ):
        raise ValueError("Approval does not match the source snapshot")
    return root, meta, body, stale


def resolve_action(root, meta):
    catalog = json.loads((root / "actions.json").read_text())
    if catalog.get("version") != 1:
        raise ValueError("Unsupported action catalog")
    routes = catalog["actions"]
    route = (
        next((r for r in routes if r["id"] == meta.get("action_id")), None)
        if meta.get("action_id")
        else next((r for r in routes if r["label"] == meta.get("task")), None)
    )
    if route is None:
        raise ValueError(
            "Unknown action; clarify the request rather than guessing a route"
        )
    if route["label"] != meta.get("task"):
        raise ValueError("Action and task label disagree")
    if meta.get("action_version", 1) != catalog["version"]:
        raise ValueError("Action catalog changed; review a new request")
    return route


def transition(path, action, summary="", outputs=None):
    root, meta, body, stale = inspect(path)
    if action == "inspect":
        return {
            "id": meta["id"],
            "status": meta["status"],
            "task": meta.get("task"),
            "route": resolve_action(root, meta),
            "stale_sources": stale,
            "request": body,
            "approval": meta.get("approval"),
            "source_files": list(meta["source_hashes"]),
        }
    lock = path.with_suffix(".lock")
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    try:
        root, meta, body, stale = inspect(path)
        if action == "start":
            route = resolve_action(root, meta)
            required = route.get("approval")
            if required and (meta.get("approval") or {}).get("kind") != required:
                raise ValueError(
                    "This action requires "
                    + required
                    + " approval of the current snapshot; prepare a reviewed request"
                )
            meta["resolved_action"] = route
            if meta["status"] != "saved":
                raise ValueError(
                    "Only a saved request can start; do not repeat completed or active work"
                )
            if stale:
                raise ValueError(
                    "Source changed; ask owner to review and save a new request: "
                    + ", ".join(stale)
                )
            meta["status"] = "in_progress"
            meta["started"] = datetime.now(timezone.utc).isoformat()
        else:
            if meta["status"] != "in_progress":
                raise ValueError("Only active work can be finished, blocked, or failed")
            if not summary.strip():
                raise ValueError("A specific result or blocker is required")
            verified = []
            for rel in outputs or []:
                out = inside(root, rel)
                if not out.is_file():
                    raise ValueError("Output does not exist: " + rel)
                verified.append(
                    {
                        "path": rel,
                        "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
                    }
                )
            if action == "complete" and not verified:
                raise ValueError(
                    "Completed work must identify at least one saved result file"
                )
            meta["status"] = {
                "complete": "completed",
                "block": "blocked",
                "fail": "failed",
            }[action]
            meta["result_summary"] = summary
            meta["result_paths"] = [x["path"] for x in verified]
            meta["result_hashes"] = verified
            meta["finished"] = datetime.now(timezone.utc).isoformat()
        meta["updated"] = datetime.now(timezone.utc).isoformat()
        path.write_text(
            "---\n"
            + "".join(
                f"{k}: {json.dumps(v, ensure_ascii=False)}\n" for k, v in meta.items()
            )
            + "---\n\n"
            + body
        )
        return {"id": meta["id"], "status": meta["status"]}
    finally:
        os.close(fd)
        lock.unlink()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["inspect", "start", "complete", "block", "fail"])
    ap.add_argument("request", type=Path)
    ap.add_argument("--summary", default="")
    ap.add_argument("--output", action="append", default=[])
    a = ap.parse_args()
    print(
        json.dumps(
            transition(a.request, a.action, a.summary, a.output),
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
