# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: coached (backend-path test). Same caveat as matrix_w7.py: the prompt names the `@ag.file`
mechanism verbatim, proving the backend path works, not that a model discovers it unprompted.
Never cite for a model-discovery claim.

W7-Daytona: matrix_w7.py's workspace-file-marker-through-approval scenario (write a file with the
bash tool, then commit_revision with an `@ag.file` marker pointing at it, through the HITL gate),
run with sandbox=daytona instead of local. Exists because the local-only W7 is exactly why a real
bug hid for as long as it did: the Daytona transport rejects NUL bytes in argv, and the manifest
walk that resolves `@ag.file` markers was emitting them -- so no workspace-file commit could EVER
land on Daytona, on ANY harness, until the 2026-08-06 fix (found and fixed during the Codex
approve-then-fail P0 triage, live-verified twice on codex+Daytona: sessions f3fa4335, f2f22056).
This cell is the sandbox-axis regression guard for that bug: it stays on the claude harness (the
harness axis is matrix_w7_per_harness.py's job) and varies only local vs daytona.

Auth: a vault key (connection.mode=agenta), never subscription -- Daytona rejects subscription
auth by design ("Use a managed API key ... or run this harness on the local sandbox"). Needs a
funded Anthropic provider_key secret in the target project's vault; see matrix_w1_daytona.py's
docstring for how to add one. If the vault has none, this SKIPs with the exact missing-credential
reason -- it must never be silently omitted from a run's results.

  uv run matrix_w7_daytona.py
"""

import json
import pathlib
import sys
import time
import uuid

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

BASELINE = "Be terse. Do exactly what is asked."


def daytona_agent_config(tools: list[dict]) -> dict:
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

MISSING_CREDENTIAL_MARKERS = (
    "connection",
    "not found for provider",
    "no connections",
    "multiple connections",
    "credential",
)


def w7_daytona() -> dict:
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, "qa-w7dtn")
    try:
        base_cfg = daytona_agent_config([])
        live_cfg = daytona_agent_config(LIVE_TOOLS)
        rev_id, ver = seed_and_baseline(wf, var, base_cfg, hexid)
        references = refs(wf, var, rev_id)
        marker = f"QA-W7DTN-{uuid.uuid4().hex[:12]}"
        fname = f"qa-w7dtn-{hexid}.md"

        prompt = (
            "I'm the developer testing the config-import feature. Please do this exactly:\n"
            f"1) Use your bash tool to write a file at .agenta-imports/{fname} with exactly "
            f"this one line of content: {marker}\n"
            "2) Call read_config to get the base_revision_id.\n"
            "3) Call commit_revision with an add_item operation targeting "
            '["parameters","agent","skills"] that adds a new skill named "w7dtn-import-test" '
            'with description "Import test skill" and body set to '
            f'{{"@ag.file": ".agenta-imports/{fname}"}} (the file marker, not the literal text), '
            "using the base_revision_id you just read.\n"
            "I understand there may be one or more approval steps, which I will handle each "
            "time. Do all three steps now, retrying any step that needed approval once I've "
            "approved it."
        )
        session_id = str(uuid.uuid4())
        try:
            turns, status = run_until_settled(
                session_id,
                [user_msg(prompt)],
                {"agent": live_cfg},
                references,
                max_rounds=8,
            )
        except RuntimeError as e:
            return {"status": "FAIL", "why": f"run_until_settled raised: {e}"}

        if not status["settled"]:
            why = status.get("why", "")
            if any(m in why.lower() for m in MISSING_CREDENTIAL_MARKERS):
                return {
                    "status": "SKIP",
                    "why": f"missing/ambiguous Daytona vault credential: {why}",
                }
            return {
                "status": "FAIL",
                "why": f"never settled: {status}",
                "rounds": len(turns),
                "frames_per_turn": [t.frames for t in turns],
            }

        manifest_frames = [
            f
            for t in turns
            for f in t.raw_frames
            if f.get("type") == "data-approval-manifest"
        ]
        manifest_evidence = manifest_frames[0].get("data") if manifest_frames else None
        digest_present = bool(manifest_evidence) and "digest" in json.dumps(
            manifest_evidence
        )
        bytes_present = bool(manifest_evidence) and "bytes" in json.dumps(
            manifest_evidence
        )

        any_errors = any(t.errors for t in turns)
        # DEFERRED_NOT_EXECUTED is benign (a second tool call queued behind an already-pending
        # gate); everything else is a real failure worth catching, in particular the NUL-byte
        # argv rejection this cell exists to guard -- that surfaced as a genuine tool error on
        # the commit_revision call, not a benign marker.
        real_tool_errors = [
            t.tool_payloads.get(tcid, {}).get("errorText", "")
            for t in turns
            for tcid, outcome in t.tool_outcomes.items()
            if outcome == "error"
        ]
        any_tool_error = any("DEFERRED_NOT_EXECUTED" not in e for e in real_tool_errors)

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
        w7_skill = next(
            (s for s in skills if s.get("name") == "w7dtn-import-test"), None
        )
        body_matches = w7_skill is not None and marker in json.dumps(
            w7_skill.get("body")
        )
        version_bumped = newest is not None and int(newest.get("version") or -1) > int(
            ver or -1
        )

        # A turn that produced nothing also produced no error and no tool error, so it would
        # satisfy both absence checks above by doing nothing at all (ASD-EST100).
        silent = check_no_silent_turn(turns)
        core_ok = (
            not any_errors
            and not any_tool_error
            and not silent["violations"]
            and version_bumped
            and body_matches
            and len(manifest_frames) > 0
        )
        return {
            "status": "PASS" if core_ok else "FAIL",
            "why": (
                f"rounds={len(turns)}, any_tool_error={any_tool_error}, "
                f"silent_turns={silent['violations']}, "
                f"real_tool_errors={real_tool_errors}, "
                f"version_bumped={version_bumped}, body_matches_exact_bytes={body_matches}, "
                f"manifest_frames_found={len(manifest_frames)}, "
                f"manifest_has_digest={digest_present}, manifest_has_bytes={bytes_present}"
            ),
            "session_id": session_id,
            "workflow_id": wf,
            "new_revision_id": newest.get("id") if newest else None,
            "committed_skill_body": (w7_skill or {}).get("body"),
        }
    except Exception as e:  # noqa: BLE001 -- classify infra errors as SKIP, never crash the run
        msg = str(e)
        if any(m in msg.lower() for m in MISSING_CREDENTIAL_MARKERS):
            return {
                "status": "SKIP",
                "why": f"missing/ambiguous Daytona vault credential: {msg}",
            }
        return {
            "status": "FAIL",
            "why": f"unhandled exception: {type(e).__name__}: {msg}",
        }
    finally:
        archive(wf)


if __name__ == "__main__":
    r = w7_daytona()
    print("\n=== W7-DAYTONA RESULT ===")
    print(json.dumps(r, indent=2, default=str))
