# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "daytona",
# ]
# ///
"""
WP-3 deliverable: run a Pi agent inside a Daytona cloud sandbox end to end.

Steps, matching the WP-3 definition of done:
  1. Create a sandbox from the prebuilt `agenta-pi-harness` snapshot (Pi baked in).
     Time the cold start.
  2. Inject the provider credential (see "Auth" below) and lay the agent's config
     into a per-run working directory: AGENTS.md (the agent's instructions) plus a
     task input file. Nothing is written to a persistent volume; the per-run dir is
     the isolation unit (sandbox-sharing research), and TMPDIR is pinned inside it so
     bash spillover stays contained.
  3. Run Pi headless in `--mode json` inside a Daytona session and stream the JSON
     event lines back live.
  4. Reconstruct the multi-message output (assistant text + tool calls/results) and
     token usage from the streamed events.
  5. Tear down: delete the session and the sandbox.

Auth (PI_AUTH env or --auth):
  - codex (default): upload the developer's Pi ChatGPT login (~/.pi/agent/auth.json)
    into the sandbox and run on openai-codex/gpt-5.5. This is the secret-as-file
    injection path and is what works without a paid provider key.
  - anthropic | openai | google: inject the matching *_API_KEY env var into the
    sandbox (env_vars) and run on that provider. This is the secret-as-env path.

Run:
    DAYTONA_API_KEY=... DAYTONA_API_URL=... DAYTONA_TARGET=eu \
        uv run run_agent.py [--keep] [--auth codex|anthropic|openai|google] [--model ID]

  --keep   leave the sandbox running (skip teardown) for debugging
  --auth   credential strategy (default: codex)
  --model  override the model id
"""

import asyncio
import json
import os
import sys
import time
import uuid
from pathlib import Path

from daytona import (
    AsyncDaytona,
    CreateSandboxFromSnapshotParams,
    DaytonaConfig,
    SessionExecuteRequest,
)

SNAPSHOT_NAME = "agenta-pi-harness"

# provider -> (default model, api-key env var name)
PROVIDERS = {
    "anthropic": ("claude-sonnet-4-5", "ANTHROPIC_API_KEY"),
    "openai": ("gpt-4o-mini", "OPENAI_API_KEY"),
    "google": ("gemini-2.0-flash", "GEMINI_API_KEY"),
    "codex": ("gpt-5.5", None),  # openai-codex, auth via uploaded auth.json
}

# The agent's instructions. Pi auto-discovers AGENTS.md from the working dir, so a
# behavioural marker here ("sign off as Pip") proves the injected config is honored.
AGENTS_MD = """\
# Greeter agent

You are a terse assistant running in a sandbox.

- Do exactly what the task file asks, nothing more.
- Always end any file you create with a final line: `-- signed, Pip`
"""

# A task the agent must read with a tool, then act on. Forces a read -> write tool
# sequence, which exercises the multi-message output path.
TASK_TXT = """\
TODO: greet the user by name (use "Mahmoud")
TODO: state the current working directory
TODO: add a one-line haiku about sandboxes
Write the result to greeting.txt.
"""

PROMPT = (
    "Read task.txt in the current directory and carry out every TODO in it. "
    "Follow the instructions in AGENTS.md."
)


def log(msg: str) -> None:
    print(msg, flush=True)


class EventCollector:
    """Parses Pi's --mode json event stream into a multi-message output."""

    def __init__(self) -> None:
        self.buffer = ""
        self.session_id: str | None = None
        self.messages: list[dict] = []  # final messages[] from agent_end
        self.usage: dict | None = None
        self.tool_calls: list[str] = []
        self.error: str | None = None

    def feed_stdout(self, chunk: str) -> None:
        self.buffer += chunk
        while "\n" in self.buffer:
            line, self.buffer = self.buffer.split("\n", 1)
            if line.strip():
                self._handle_line(line.strip())

    def feed_stderr(self, chunk: str) -> None:
        text = chunk.rstrip()
        if text:
            log(f"  [stderr] {text}")

    def flush(self) -> None:
        if self.buffer.strip():
            self._handle_line(self.buffer.strip())
            self.buffer = ""

    def _handle_line(self, line: str) -> None:
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            log(f"  [raw] {line[:200]}")
            return

        etype = ev.get("type")
        if etype == "session":
            self.session_id = ev.get("id")
            log(f"  [session] {self.session_id}")
        elif etype == "message_update":
            ame = ev.get("assistantMessageEvent", {})
            if ame.get("type") == "text_delta":
                sys.stdout.write(ame.get("delta", ""))
                sys.stdout.flush()
            elif ame.get("type") in ("tool_call_start", "tool_start"):
                name = ame.get("toolName") or ame.get("name", "?")
                log(f"\n  [tool-call] {name}")
                self.tool_calls.append(name)
        elif etype in ("tool_execution_start", "tool_start"):
            name = ev.get("toolName") or ev.get("name", "?")
            log(f"\n  [tool] {name}")
            self.tool_calls.append(name)
        elif etype == "message_end":
            msg = ev.get("message", {})
            if msg.get("usage"):
                self.usage = msg["usage"]
            if msg.get("stopReason") == "error":
                self.error = (msg.get("errorMessage") or "")[:300]
        elif etype == "agent_end":
            self.messages = ev.get("messages", [])
            log("\n  [agent_end]")
        elif etype == "error":
            self.error = json.dumps(ev)[:300]
            log(f"\n  [error] {self.error}")


def render_messages(messages: list[dict]) -> str:
    """Flatten Pi's messages[] into a readable multi-message transcript."""
    out: list[str] = []
    for m in messages:
        role = m.get("role", "?")
        parts: list[str] = []
        for c in m.get("content", []):
            ctype = c.get("type")
            if ctype == "text":
                parts.append(c.get("text", ""))
            elif ctype in ("tool_use", "toolUse"):
                parts.append(
                    f"<tool_use {c.get('name')} {json.dumps(c.get('input', {}))[:160]}>"
                )
            elif ctype in ("tool_result", "toolResult"):
                parts.append(f"<tool_result {json.dumps(c.get('content'))[:160]}>")
            else:
                parts.append(f"<{ctype}>")
        out.append(f"[{role}] " + " ".join(p for p in parts if p))
    return "\n".join(out)


def arg(name: str, default: str) -> str:
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


async def main() -> None:
    keep = "--keep" in sys.argv
    auth = arg("--auth", os.environ.get("PI_AUTH", "codex"))
    if auth not in PROVIDERS:
        log(f"unknown --auth '{auth}'; choose one of {list(PROVIDERS)}")
        sys.exit(1)
    default_model, key_env = PROVIDERS[auth]
    model = arg("--model", default_model)
    provider = "openai-codex" if auth == "codex" else auth

    # Resolve the credential to inject.
    env_vars: dict[str, str] = {}
    auth_json: bytes | None = None
    if auth == "codex":
        auth_path = Path(arg("--auth-json", str(Path.home() / ".pi/agent/auth.json")))
        if not auth_path.exists():
            log(f"codex auth requires {auth_path}; run `pi` then `/login` first.")
            sys.exit(1)
        auth_json = auth_path.read_bytes()
    else:
        val = os.environ.get(key_env or "", "")
        if not val:
            log(f"--auth {auth} requires {key_env} in the environment.")
            sys.exit(1)
        env_vars[key_env] = val

    run_id = uuid.uuid4().hex[:12]
    run_dir = f"/home/daytona/runs/{run_id}"
    session_id = f"agenta-run-{run_id}"
    timings: dict[str, float] = {}

    config = DaytonaConfig(
        api_key=os.environ["DAYTONA_API_KEY"],
        api_url=os.environ.get("DAYTONA_API_URL", "https://app.daytona.io/api"),
        target=os.environ.get("DAYTONA_TARGET", "eu"),
    )

    async with AsyncDaytona(config) as daytona:
        log(
            f"[1/5] creating sandbox from '{SNAPSHOT_NAME}' (provider={provider} model={model})..."
        )
        t0 = time.monotonic()
        sandbox = await daytona.create(
            CreateSandboxFromSnapshotParams(
                snapshot=SNAPSHOT_NAME,
                env_vars=env_vars or None,
                auto_stop_interval=0,  # own the lifecycle; no idle auto-stop
                labels={"agenta-wp": "wp-3", "run-id": run_id},
            ),
            timeout=120,
        )
        timings["cold_start_s"] = time.monotonic() - t0
        log(f"      sandbox {sandbox.id} ready in {timings['cold_start_s']:.2f}s")

        try:
            log(f"[2/5] injecting credential + AGENTS.md + task.txt into {run_dir} ...")
            await sandbox.fs.create_folder(run_dir, "755")
            await sandbox.fs.create_folder(f"{run_dir}/tmp", "777")
            await sandbox.fs.upload_file(AGENTS_MD.encode(), f"{run_dir}/AGENTS.md")
            await sandbox.fs.upload_file(TASK_TXT.encode(), f"{run_dir}/task.txt")
            if auth_json is not None:
                # Secret-as-file: drop the Pi login where Pi looks for it ($HOME=/root).
                await sandbox.fs.create_folder("/root/.pi/agent", "700")
                await sandbox.fs.upload_file(auth_json, "/root/.pi/agent/auth.json")
                await sandbox.fs.set_file_permissions(
                    "/root/.pi/agent/auth.json", mode="600"
                )

            log("[3/5] running Pi headless (--mode json), streaming events:\n")
            # --approve trusts the project-local AGENTS.md so Pi does not block on an
            # interactive trust prompt. stdin from /dev/null guards against any other
            # read. cwd is the per-run dir so AGENTS.md/task.txt are discovered.
            pi_cmd = (
                f"cd {run_dir} && TMPDIR={run_dir}/tmp "
                f"pi -p {json.dumps(PROMPT)} "
                f"--mode json --approve --provider {provider} --model {model} "
                f"-t read,bash,edit,write,ls "
                f"--session-dir {run_dir}/.pi-sessions --name {session_id} "
                f"< /dev/null"
            )

            await sandbox.process.create_session(session_id)
            collector = EventCollector()
            t1 = time.monotonic()
            resp = await sandbox.process.execute_session_command(
                session_id,
                SessionExecuteRequest(command=pi_cmd, run_async=True),
            )
            cmd_id = resp.cmd_id
            await sandbox.process.get_session_command_logs_async(
                session_id,
                cmd_id,
                collector.feed_stdout,
                collector.feed_stderr,
            )
            collector.flush()
            timings["agent_run_s"] = time.monotonic() - t1

            info = await sandbox.process.get_session_command(session_id, cmd_id)
            exit_code = getattr(info, "exit_code", None)

            log("\n\n[4/5] reconstructed multi-message output:")
            log("-" * 64)
            log(render_messages(collector.messages) or "(no messages)")
            log("-" * 64)

            try:
                produced = await sandbox.process.exec(
                    f"cat {run_dir}/greeting.txt", timeout=30
                )
                log("\ngreeting.txt produced by the agent:")
                log(getattr(produced, "result", str(produced)))
            except Exception as e:  # noqa: BLE001
                log(f"(could not read greeting.txt: {e})")

            log("\nsummary:")
            log(f"  pi session id : {collector.session_id}")
            log(f"  daytona run id: {run_id}")
            log(f"  exit code     : {exit_code}")
            log(f"  tool calls    : {collector.tool_calls}")
            log(f"  token usage   : {collector.usage}")
            log(f"  error         : {collector.error}")
            log(f"  cold start    : {timings['cold_start_s']:.2f}s")
            log(f"  agent run     : {timings['agent_run_s']:.2f}s")
        finally:
            if keep:
                log(f"\n[5/5] --keep set; leaving sandbox {sandbox.id} running.")
            else:
                log(f"\n[5/5] tearing down session + sandbox {sandbox.id} ...")
                try:
                    await sandbox.process.delete_session(session_id)
                except Exception:  # noqa: BLE001
                    pass
                await daytona.delete(sandbox)
                log("      deleted.")


if __name__ == "__main__":
    asyncio.run(main())
