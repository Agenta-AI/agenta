# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""T9: the runner restores the agent's own tools from `agent-files/.tools/` before a session.

The durable agent folder is a geesefs mount over S3 where symlinks do not survive a remount, so
the convention is: keep static binaries in `agent-files/.tools/bin/` and a `setup.sh` that
rebuilds environments on local disk; the runner (`agent-tools-setup.ts`) copies the binaries to
`<cwd>/.tools/bin/` and runs `setup.sh` after the agent mount and before the session opens. This
cell plants both through the mounts API (the same surface the file drawer uses), starts a fresh
session, and asserts three things the model cannot fake:

  1. the `cat .tools/marker` tool-output payload carries the token `setup.sh` wrote (so the
     script ran, in the session cwd, before the first tool call);
  2. the `.tools/bin/qa-tool` tool-output payload carries the token baked into that binary (so
     the copy landed on local disk, executable);
  3. `agent-files/.tools/runs.log`, read back through the mounts API (S3, not the model), holds
     the line `setup.sh` appended, so the restore is visible without any model in the loop.

TIER: coached (backend-path test). The prompt names the exact commands. Do not cite for
one-shot-discovery claims.

  uv run matrix_t9_agent_tools.py [--sandbox local|daytona] [--harness pi_core|claude]
      [--runner-container <docker name>]     # optional: also asserts stage=agent_tools_setup
"""

import argparse
import json
import os
import pathlib
import subprocess
import sys
import time
import uuid

import httpx

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import (  # noqa: E402
    archive,
    check_no_silent_turn,
    create_workflow,
    invoke,
    refs,
    seed_and_baseline,
    user_msg,
)

BASE = os.environ["AGENTA_BASE"]
PROJECT = os.environ["AGENTA_PROJECT_ID"]
KEY = os.environ["AGENTA_API_KEY"]

HARNESS_MODELS = {
    "pi_core": ("gpt-5.6-luna", "openai"),
    "claude": ("haiku", "anthropic"),
}


def agent_cfg(harness: str, sandbox: str) -> dict:
    model, provider = HARNESS_MODELS[harness]
    return {
        "instructions": {
            "agents_md": "Use the bash tool when asked. Report only the command's stdout."
        },
        "llm": {
            "model": model,
            "provider": provider,
            "connection": {"mode": "agenta", "slug": None},
            "extras": {},
        },
        "tools": [],
        "mcps": [],
        "skills": [],
        "harness": {"kind": harness},
        "sandbox": {"kind": sandbox},
        # The runner's permission posture: `allow` so the coached bash call never parks on an
        # approval; this cell tests the restore step, not the approval dock.
        "runner": {"kind": "sidecar", "permissions": {"default": "allow"}},
    }


def _hdr() -> dict:
    return {"Authorization": f"ApiKey {KEY}"}


def sign_agent_mount(artifact_id: str) -> str:
    r = httpx.post(
        f"{BASE}/api/mounts/agents/sign",
        params={"project_id": PROJECT, "artifact_id": artifact_id, "name": "default"},
        headers=_hdr(),
        timeout=60.0,
    )
    if r.status_code != 200:
        raise RuntimeError(f"sign agent mount HTTP {r.status_code}: {r.text[:300]}")
    return r.json()["mount"]["id"]


def put_file(mount_id: str, path: str, content: str) -> None:
    r = httpx.put(
        f"{BASE}/api/mounts/{mount_id}/files",
        params={"project_id": PROJECT, "path": path},
        content=content.encode("utf-8"),
        headers={**_hdr(), "Content-Type": "text/plain"},
        timeout=60.0,
    )
    if r.status_code != 200:
        raise RuntimeError(f"put {path} HTTP {r.status_code}: {r.text[:300]}")


def read_file(mount_id: str, path: str) -> str | None:
    r = httpx.get(
        f"{BASE}/api/mounts/{mount_id}/files",
        params={"project_id": PROJECT, "read": path},
        headers=_hdr(),
        timeout=60.0,
    )
    if r.status_code == 404:
        return None
    if r.status_code != 200:
        raise RuntimeError(f"read {path} HTTP {r.status_code}: {r.text[:300]}")
    body = (
        r.json()
        if r.headers.get("content-type", "").startswith("application/json")
        else None
    )
    if isinstance(body, dict):
        return str(body.get("content") or body.get("text") or json.dumps(body))
    return r.text


def runner_log_has_stage(container: str, session_id: str, since: str = "10m") -> bool:
    """The `agent_tools_setup` timing stage for THIS session, and the restore's own ok line
    before it. Another session's stage in the same window must not count."""
    out = subprocess.run(
        ["docker", "logs", container, "--since", since],
        capture_output=True,
        text=True,
        timeout=30,
    )
    lines = (out.stdout + out.stderr).splitlines()
    stage = any(
        "stage=agent_tools_setup" in ln and f"session={session_id}" in ln
        for ln in lines
    )
    return stage


def t9_agent_tools(sandbox: str, harness: str, runner_container: str | None) -> dict:
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, "qa-t9")
    try:
        cfg = agent_cfg(harness, sandbox)
        rev_id, _ver = seed_and_baseline(wf, var, cfg, hexid)
        references = refs(wf, var, rev_id)

        token_setup = f"QA-T9-SETUP-{uuid.uuid4().hex[:12]}"
        token_bin = f"QA-T9-BIN-{uuid.uuid4().hex[:12]}"
        token_log = f"QA-T9-LOG-{uuid.uuid4().hex[:12]}"

        mount_id = sign_agent_mount(wf)
        put_file(
            mount_id,
            ".tools/setup.sh",
            "\n".join(
                [
                    "#!/bin/sh",
                    f'printf "%s\\n" "{token_setup}" > "$AGENT_TOOLS_DIR/marker"',
                    f'printf "%s %s\\n" "{token_log}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$AGENT_FILES/.tools/runs.log"',
                    "",
                ]
            ),
        )
        put_file(mount_id, ".tools/bin/qa-tool", f'#!/bin/sh\necho "{token_bin}"\n')

        prompt = (
            "Use bash to run exactly: cat .tools/marker && .tools/bin/qa-tool ; "
            "then reply with only the combined stdout."
        )
        session_id = str(uuid.uuid4())
        t1 = invoke(session_id, [user_msg(prompt)], {"agent": cfg}, references)
        # Only the FIRST tool call counts, and it must be the exact probe. A model that finds the
        # planted files, runs setup.sh itself, and then runs the probe would otherwise pass a
        # test about the runner's restore step. Any tool error disqualifies the run.
        tool_inputs = [c.get("input") for c in t1.tool_calls]
        first = t1.tool_calls[0] if t1.tool_calls else None
        first_cmd = (
            str((first or {}).get("input", {}).get("command", "")) if first else ""
        )
        first_is_probe = first is not None and first_cmd.strip() == (
            "cat .tools/marker && .tools/bin/qa-tool"
        )
        first_output = (
            str(t1.tool_payloads.get(first["toolCallId"], {}).get("output") or "")
            if first
            else ""
        )
        tool_output_text = first_output
        setup_ran = first_is_probe and token_setup in first_output
        bin_copied = first_is_probe and token_bin in first_output
        tool_errors = [
            t1.tool_payloads.get(c["toolCallId"], {}).get("errorText")
            for c in t1.tool_calls
            if t1.tool_outcomes.get(c["toolCallId"]) == "error"
        ]

        # The restore is visible WITHOUT the model: setup.sh appended to a file on the durable
        # mount. geesefs flushes on a delay, so poll the store for up to 45 s.
        log_seen = False
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            body = read_file(mount_id, ".tools/runs.log")
            if body and token_log in body:
                log_seen = True
                break
            time.sleep(3)

        stage_seen = None
        if runner_container:
            stage_seen = runner_log_has_stage(runner_container, session_id)

        silent = check_no_silent_turn([t1])
        ok = (
            first_is_probe
            and setup_ran
            and bin_copied
            and log_seen
            and not tool_errors
            and not t1.errors
            and not silent["violations"]
            and (stage_seen is None or stage_seen)
        )
        return {
            "status": "PASS" if ok else "FAIL",
            "why": (
                f"first_call_is_probe={first_is_probe}, "
                f"setup_ran (first call's payload carried the setup token)={setup_ran}, "
                f"bin_copied (.tools/bin/qa-tool payload carried the binary token)={bin_copied}, "
                f"runs_log_on_mount (read back via the mounts API)={log_seen}, "
                f"tool_errors={len(tool_errors)}, wire_errors={t1.errors}, silent_turns={silent['violations']}, "
                f"runner_stage_seen={stage_seen}"
            ),
            "sandbox": sandbox,
            "harness": harness,
            "workflow_id": wf,
            "session_id": session_id,
            "mount_id": mount_id,
            "tool_output": tool_output_text[:500],
            "tool_inputs": tool_inputs,
            "tool_errors": [str(e)[:400] for e in tool_errors],
            "frames": t1.frames,
        }
    finally:
        archive(wf)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--sandbox", default="local", choices=["local", "daytona"])
    p.add_argument("--harness", default="pi_core", choices=sorted(HARNESS_MODELS))
    p.add_argument(
        "--runner-container", default=os.environ.get("AGENTA_RUNNER_CONTAINER")
    )
    a = p.parse_args()
    r = t9_agent_tools(a.sandbox, a.harness, a.runner_container)
    print("\n=== T9 AGENT TOOLS RESULT ===")
    print(json.dumps(r, indent=2, default=str))
    sys.exit(0 if r["status"] == "PASS" else 1)
