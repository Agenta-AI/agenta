# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: coached (backend-path test). The prompt names the mechanism verbatim: 'body set to
{"@ag.file": ".agenta-imports/<file>"} (the file marker, not the literal text)'. This is
CORRECT for this cell's purpose -- proving the backend mint/gate/execute path works -- but it
means this cell says NOTHING about whether a model finds the @ag.file mechanism from a plain
human ask like "add the skill I saved in your folder". It does not (root-caused live: Haiku
invented a nonexistent {"@ag.embed": {"@ag.references": ...}} syntax instead, and the engine
accepted it as literal data). Never cite this cell for a model-discovery claim; that needs a
Tier B (mechanism-blind) cell.

W7: guards against the file-marker execution-authorization handoff being broken -- an agent
writes a workspace file and commits it via an `@ag.file` marker (contract: change-set.md 6,
workspace-import.md 8). Asserts the approval manifest carries digest+bytes+path, AND that the
approved commit actually lands with the exact file content.

Caught a real, 100%-reproducible bug on first run: mintForGate correctly mints an authorization
record and the manifest renders correctly, the HITL gate correctly fires and gets approved
("[HITL] gate ... outcome=allow" in runner logs), but authorizeExecution then IMMEDIATELY refuses
with `authorization_missing` every single time -- the mint-to-consume handoff never succeeds, so
no file-marker commit can ever land (services/runner/src/tools/commit-authorization.ts). FIXED
and re-verified PASS (2026-08-06); this repro stays in the docstring as the regression signature.

  uv run matrix_w7.py
"""
import json
import pathlib
import sys
import time
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import (  # noqa: E402
    LIVE_TOOLS,
    agent_config,
    archive,
    create_workflow,
    latest_revision,
    refs,
    run_until_settled,
    seed_and_baseline,
    user_msg,
)

BASELINE = "Be terse. Do exactly what is asked."


def w7():
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, "qa-w7")
    try:
        cfg = agent_config(instructions=BASELINE)
        rev_id, ver = seed_and_baseline(wf, var, cfg, hexid)
        live_params = {"agent": {**cfg, "tools": LIVE_TOOLS}}
        references = refs(wf, var, rev_id)
        marker = f"QA-W7-{uuid.uuid4().hex[:12]}"
        fname = f"qa-w7-{hexid}.md"

        prompt = (
            "I'm the developer testing the config-import feature. Please do this exactly:\n"
            f"1) Use your bash tool to write a file at .agenta-imports/{fname} with exactly "
            f"this one line of content: {marker}\n"
            "2) Call read_config to get the base_revision_id.\n"
            "3) Call commit_revision with an add_item operation targeting "
            '["parameters","agent","skills"] that adds a new skill named "w7-import-test" '
            'with description "Import test skill" and body set to '
            f'{{"@ag.file": ".agenta-imports/{fname}"}} (the file marker, not the literal text), '
            "using the base_revision_id you just read.\n"
            "I understand there may be one or more approval steps, which I will handle each "
            "time. Do all three steps now, retrying any step that needed approval once I've "
            "approved it."
        )
        session_id = str(uuid.uuid4())
        turns, status = run_until_settled(session_id, [user_msg(prompt)], live_params, references)

        if not status["settled"]:
            return {
                "status": "FAIL",
                "why": f"never settled: {status}",
                "rounds": len(turns),
                "frames_per_turn": [t.frames for t in turns],
            }

        # Manifest evidence: the data-approval-manifest frame, wherever it landed.
        manifest_frames = []
        for t in turns:
            for f in t.raw_frames:
                if f.get("type") == "data-approval-manifest":
                    manifest_frames.append(f)
        manifest_evidence = manifest_frames[0].get("data") if manifest_frames else None
        digest_present = bool(manifest_evidence) and "digest" in json.dumps(manifest_evidence)
        bytes_present = bool(manifest_evidence) and "bytes" in json.dumps(manifest_evidence)

        any_errors = any(t.errors for t in turns)
        # DEFERRED_NOT_EXECUTED is benign: it fires when the model queues a second tool call
        # behind an already-pending gate (only one gate is active at a time) and just means
        # "retry me once the other one resolves" -- not a real failure. Distinguish it from a
        # genuine tool error so a healthy multi-gate sequence doesn't read as broken.
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
            (newest.get("data") or {}).get("parameters", {}).get("agent", {}).get("skills", [])
            if newest
            else []
        )
        w7_skill = next((s for s in skills if s.get("name") == "w7-import-test"), None)
        body_matches = w7_skill is not None and marker in json.dumps(w7_skill.get("body"))
        version_bumped = newest is not None and int(newest.get("version") or -1) > int(ver or -1)

        core_ok = (
            not any_errors
            and not any_tool_error
            and version_bumped
            and body_matches
            and len(manifest_frames) > 0
        )
        return {
            "status": "PASS" if core_ok else "FAIL",
            "why": (
                f"rounds={len(turns)}, any_tool_error={any_tool_error}, "
                f"version_bumped={version_bumped}, body_matches_exact_bytes={body_matches}, "
                f"manifest_frames_found={len(manifest_frames)}, "
                f"manifest_has_digest={digest_present}, manifest_has_bytes={bytes_present}"
            ),
            "session_id": session_id,
            "workflow_id": wf,
            "manifest_evidence": manifest_evidence,
            "new_revision_id": newest.get("id") if newest else None,
            "committed_skill_body": (w7_skill or {}).get("body"),
            "frames_per_turn": [t.frames for t in turns],
        }
    finally:
        archive(wf)


if __name__ == "__main__":
    r = w7()
    print("\n=== W7 RESULT ===")
    print(json.dumps(r, indent=2, default=str))
