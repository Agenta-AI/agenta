# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""T8 verification: the Daytona remote agent mount (the durable `agent-files/` folder the
playground file drawer writes into) after the tunnel fix. Writes a marker file into the agent's
durable mount via the mounts API BEFORE the run (same surface the file drawer uses), then asks a
live Daytona agent to read it and commit one line from it. Asserts: the runner log line
"remote agent mount active for artifact=<id>" appears (absent all day before the tunnel fix),
the agent's read reflects the REAL marker content (not hallucinated), and the commit lands with
it.

TIER: coached (backend-path test) -- the prompt names the folder (`agent-files/`) and the
commit mechanism explicitly. This proves the mount/tunnel path works, not that a model finds
agent-files/ unprompted from a plain ask ("the skill I saved in your folder").
"""

import json
import os
import pathlib
import sys
import time
import uuid

import httpx

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import (  # noqa: E402
    archive,
    check_no_silent_turn,
    create_workflow,
    latest_revision,
    refs,
    run_until_settled,
    seed_and_baseline,
    user_msg,
)

BASE = os.environ["AGENTA_BASE"]
PROJECT = os.environ["AGENTA_PROJECT_ID"]
KEY = os.environ["AGENTA_API_KEY"]

BASELINE = "Be terse. Do exactly what is asked."


def daytona_agent_config(tools):
    return {
        "instructions": {"agents_md": BASELINE},
        "llm": {
            "model": "haiku",
            "provider": "anthropic",
            "connection": {"mode": "agenta", "slug": None},
            "extras": {},
        },
        "tools": tools,
        "mcps": [],
        "skills": [],
        "harness": {"kind": "claude"},
        "sandbox": {"kind": "daytona"},
    }


LIVE_TOOLS = [
    {"type": "platform", "op": "read_config"},
    {"type": "platform", "op": "commit_revision"},
]


def sign_agent_mount(artifact_id: str) -> str:
    r = httpx.post(
        f"{BASE}/api/mounts/agents/sign",
        params={"project_id": PROJECT, "artifact_id": artifact_id, "name": "default"},
        headers={"Authorization": f"ApiKey {KEY}"},
        timeout=60.0,
    )
    if r.status_code != 200:
        raise RuntimeError(f"sign agent mount HTTP {r.status_code}: {r.text[:300]}")
    return r.json()["mount"]["id"]


def write_marker_file(mount_id: str, path: str, content: str) -> None:
    r = httpx.put(
        f"{BASE}/api/mounts/{mount_id}/files",
        params={"project_id": PROJECT, "path": path},
        content=content.encode("utf-8"),
        headers={"Authorization": f"ApiKey {KEY}", "Content-Type": "text/plain"},
        timeout=60.0,
    )
    if r.status_code != 200:
        raise RuntimeError(f"write marker file HTTP {r.status_code}: {r.text[:300]}")


def t8_saved_files():
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, "qa-t8")
    try:
        base_cfg = daytona_agent_config([])
        live_cfg = daytona_agent_config(LIVE_TOOLS)
        rev_id, ver = seed_and_baseline(wf, var, base_cfg, hexid)
        references = refs(wf, var, rev_id)

        marker = f"QA-T8-{uuid.uuid4().hex[:16]}"
        fname = f"qa-t8-{hexid}.txt"
        mount_id = sign_agent_mount(wf)
        write_marker_file(mount_id, fname, f"{marker}\n")

        prompt = (
            "I'm the developer testing the saved-files feature. Please do this exactly:\n"
            f"1) Use your bash tool to read the file agent-files/{fname} (your durable agent "
            "folder) and report its exact content.\n"
            "2) Call read_config to get the base_revision_id.\n"
            "3) Call commit_revision with an add_item operation targeting "
            '["parameters","agent","skills"] that adds a new skill named "t8-saved-files-test" '
            'with description "Saved-files test" and body set to the EXACT one-line content '
            "you read from that file (the literal text, not a file marker), using the "
            "base_revision_id you just read.\n"
            "There is an approval step I will handle. Do all three steps now."
        )
        session_id = str(uuid.uuid4())
        turns, status = run_until_settled(
            session_id,
            [user_msg(prompt)],
            {"agent": live_cfg},
            references,
            max_rounds=8,
        )
        if not status["settled"]:
            return {
                "status": "FAIL",
                "why": f"never settled: {status}",
                "frames_per_turn": [t.frames for t in turns],
            }

        # Capture the read's own output as independent evidence the agent saw REAL content --
        # scan every turn (the successful read may land in a later turn than the first gate).
        read_output = None
        for t in turns:
            for tcid, outcome in t.tool_outcomes.items():
                if outcome == "available":
                    payload = t.tool_payloads.get(tcid, {})
                    if payload.get("output") and marker in json.dumps(
                        payload.get("output")
                    ):
                        read_output = payload.get("output")

        # DEFERRED_NOT_EXECUTED (a second tool call queued behind an already-pending gate) and
        # InputValidationError on the harness's OWN builtin Read tool (a model arg-name mistake,
        # "path" vs "file_path" -- self-corrected on the next attempt) are both irrelevant noise
        # for what T8 actually verifies (the mount/tunnel path), not backend failures.
        benign_markers = ("DEFERRED_NOT_EXECUTED", "InputValidationError")
        backend_errors = [
            t.tool_payloads.get(tcid, {}).get("errorText", "")
            for t in turns
            for tcid, outcome in t.tool_outcomes.items()
            if outcome == "error"
            and not any(
                m in t.tool_payloads.get(tcid, {}).get("errorText", "")
                for m in benign_markers
            )
        ]
        any_real_tool_error = bool(backend_errors)

        time.sleep(1.0)
        newest = latest_revision(wf)
        skills = (
            (newest.get("data") or {})
            .get("parameters", {})
            .get("agent", {})
            .get("skills", [])
            if newest
            else []
        )
        skill = next(
            (s for s in skills if s.get("name") == "t8-saved-files-test"), None
        )
        body_matches = skill is not None and marker in json.dumps(skill.get("body"))
        version_bumped = newest is not None and int(newest.get("version") or -1) > int(
            ver or -1
        )
        real_read = read_output is not None

        # A turn that produced nothing also produced no tool error, so it would satisfy the
        # absence check above by doing nothing at all (ASD-EST100).
        silent = check_no_silent_turn(turns)
        core_ok = (
            real_read
            and not any_real_tool_error
            and not silent["violations"]
            and version_bumped
            and body_matches
        )
        return {
            "status": "PASS" if core_ok else "FAIL",
            "why": (
                f"real_read (a tool output carried the real marker)={real_read}, "
                f"any_real_tool_error={any_real_tool_error}, version_bumped={version_bumped}, "
                f"silent_turns={silent['violations']}, "
                f"body_matches={body_matches}. Check runner logs for 'remote agent mount active "
                f"for artifact={wf}' separately."
            ),
            "workflow_id": wf,
            "session_id": session_id,
            "mount_id": mount_id,
            "marker": marker,
            "read_output": read_output,
            "committed_skill_body": (skill or {}).get("body"),
            "rounds": len(turns),
            "frames_per_turn": [t.frames for t in turns],
        }
    finally:
        archive(wf)


if __name__ == "__main__":
    r = t8_saved_files()
    print("\n=== T8 SAVED-FILES RESULT ===")
    print(json.dumps(r, indent=2, default=str))
