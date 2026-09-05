# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: coached (the prompt names the environment binding and exact shell side effect).

S1: persisted custom-secret bindings across local and Daytona sandboxes. The cell creates its own
write-only text secret, attaches its slug to a saved agent revision, and asks the harness to write
only the SHA-256 digest to the durable cwd. It reads that file through the object-store API, then
rotates the vault value and verifies the next turn observes the new digest. Finally it commits a
revision with the binding removed and verifies the next turn observes an absent variable.

The plaintext value is generated in memory, sent only to the vault create/update endpoints, and
never printed, placed in a prompt, or included in the result. Cleanup archives only the workflow
and deletes only the secret created by this invocation.

Requires a store-backed deployment and a funded OpenAI connection. Daytona additionally requires
the runner's Daytona provider configuration.

  uv run matrix_s1_custom_secrets.py
  uv run matrix_s1_custom_secrets.py --only local
  uv run matrix_s1_custom_secrets.py --only daytona
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys
import time
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import (
    api_call,
    archive,
    check_no_silent_turn,
    commit_direct,
    create_workflow,
    refs,
    run_until_settled,
    user_msg,
)

ENV_NAME = "AGENTA_QA_CUSTOM_SECRET"
STORE_SETTLE_SECONDS = 20.0


def agent_config(sandbox: str, secret_slug: str | None, harness: str) -> dict:
    sandbox_config: dict = {"kind": sandbox}
    if secret_slug:
        sandbox_config["credentials"] = [
            {
                "secret": {"slug": secret_slug},
                "binding": {"type": "env", "name": ENV_NAME},
            }
        ]
    runtime = (
        {
            "model": "gpt-5.6-luna",
            "provider": "openai-codex",
            "connection": {"mode": "self_managed", "slug": None},
            "kind": "pi_core",
        }
        if harness == "pi"
        else {
            "model": "gpt-5.6-luna",
            "provider": "openai",
            "connection": {"mode": "agenta", "slug": None},
            "kind": "codex",
        }
    )
    return {
        "instructions": {
            "agents_md": (
                "Follow the requested shell verification exactly. Never print, inspect, enumerate, "
                "or include credential values in messages or tool output."
            )
        },
        "llm": {
            "model": runtime["model"],
            "provider": runtime["provider"],
            "connection": runtime["connection"],
            "extras": {},
        },
        "tools": [],
        "mcps": [],
        "skills": [],
        "harness": {"kind": runtime["kind"]},
        "sandbox": sandbox_config,
    }


def create_secret(name: str, slug: str, value: str) -> tuple[str, str]:
    response = api_call(
        "POST",
        "/vault/v1/secrets/",
        json={
            "header": {
                "name": name,
                "description": "Release-gate disposable credential",
            },
            "slug": slug,
            "write_only": True,
            "secret": {
                "kind": "custom_secret",
                "data": {
                    "secret": {
                        "format": "text",
                        "content": value,
                        "default_env_var": ENV_NAME,
                    }
                },
            },
        },
    )
    if response.status_code != 200:
        raise RuntimeError(f"custom-secret create HTTP {response.status_code}")
    body = response.json()
    return str(body["id"]), str(body["slug"])


def rotate_secret(secret_id: str, value: str) -> None:
    response = api_call(
        "PUT",
        f"/vault/v1/secrets/{secret_id}",
        json={
            "secret": {
                "kind": "custom_secret",
                "data": {"secret": {"format": "text", "content": value}},
            }
        },
    )
    if response.status_code != 200:
        raise RuntimeError(f"custom-secret rotation HTTP {response.status_code}")


def delete_secret(secret_id: str) -> None:
    try:
        response = api_call("DELETE", f"/vault/v1/secrets/{secret_id}")
        if response.status_code not in (200, 204, 404):
            print(
                f"custom-secret cleanup HTTP {response.status_code} (non-fatal)",
                file=sys.stderr,
            )
    except Exception as error:  # noqa: BLE001
        print(
            f"custom-secret cleanup failed (non-fatal): {type(error).__name__}",
            file=sys.stderr,
        )


def commit_config(workflow_id: str, variant_id: str, config: dict, label: str) -> dict:
    response = commit_direct(
        workflow_id,
        variant_id,
        {"agent": config},
        label,
        f"qa-custom-secret-{label}-{uuid.uuid4().hex[:8]}",
    )
    if response.status_code != 200:
        raise RuntimeError(f"revision commit HTTP {response.status_code}")
    return response.json()["workflow_revision"]


def cwd_mount_id(session_id: str) -> str:
    response = api_call("GET", "/sessions/mounts/", params={"session_id": session_id})
    if response.status_code == 503:
        raise RuntimeError("deployment has no object store configured")
    if response.status_code != 200:
        raise RuntimeError(f"session mounts HTTP {response.status_code}")
    mount = next(
        (
            item
            for item in response.json().get("mounts", [])
            if item.get("name") == "cwd"
        ),
        None,
    )
    if not mount:
        raise RuntimeError("session has no durable cwd mount")
    return str(mount["id"])


def read_store_file(mount_id: str, path: str) -> str:
    deadline = time.time() + STORE_SETTLE_SECONDS
    while True:
        response = api_call("GET", f"/mounts/{mount_id}/files", params={"read": path})
        if response.status_code == 200:
            return str(response.json().get("content") or "").strip()
        if time.time() >= deadline:
            raise RuntimeError(
                f"durable result file unavailable: HTTP {response.status_code}"
            )
        time.sleep(2)


def invoke_and_read(
    *,
    session_id: str,
    messages: list[dict],
    config: dict,
    references: dict,
    result_path: str,
) -> tuple[object, str]:
    turns, status = run_until_settled(
        session_id, messages, {"agent": config}, references, max_rounds=6
    )
    if not status["settled"]:
        raise RuntimeError(f"agent turn did not settle: {status.get('why', status)}")
    silent = check_no_silent_turn(turns)
    if silent["violations"]:
        raise RuntimeError(f"agent turn was silent: {silent['violations']}")
    mount_id = cwd_mount_id(session_id)
    return turns[-1], read_store_file(mount_id, result_path)


def cell(sandbox: str, harness: str) -> dict:
    token = uuid.uuid4().hex
    workflow_id, variant_id = create_workflow(token[:8], f"qa-custom-secret-{sandbox}")
    secret_id: str | None = None
    session_id = str(uuid.uuid4())
    value_one = f"qa-secret-{uuid.uuid4().hex}-{uuid.uuid4().hex}"
    value_two = f"qa-secret-{uuid.uuid4().hex}-{uuid.uuid4().hex}"
    expected_one = hashlib.sha256(value_one.encode()).hexdigest()
    expected_two = hashlib.sha256(value_two.encode()).hexdigest()
    digest_path = f"qa-custom-secret-{token}.sha256"
    absent_path = f"qa-custom-secret-{token}.absent"
    try:
        secret_id, secret_slug = create_secret(
            f"QA custom secret {token[:8]}", f"qa-custom-secret-{token}", value_one
        )
        attached = agent_config(sandbox, secret_slug, harness)
        revision = commit_config(workflow_id, variant_id, attached, "attached")
        references = refs(workflow_id, variant_id, revision["id"])

        messages = [
            user_msg(
                f"Use your shell to compute SHA-256 of the configured {ENV_NAME} variable and "
                f"write only the 64 lowercase hex characters to {digest_path}. Do not print the "
                "variable or its value. Reply only DONE after the file is closed."
            )
        ]
        turn_one, digest_one = invoke_and_read(
            session_id=session_id,
            messages=messages,
            config=attached,
            references=references,
            result_path=digest_path,
        )

        rotate_secret(secret_id, value_two)
        if value_one in json.dumps(turn_one.raw_frames):
            raise RuntimeError("initial credential appeared in the SSE stream")
        messages.extend(
            [
                turn_one.assistant_message(),
                user_msg(
                    f"The credential was rotated. Recompute SHA-256 of {ENV_NAME} into "
                    f"{digest_path} without printing the variable or value. Reply only DONE."
                ),
            ]
        )
        turn_two, digest_two = invoke_and_read(
            session_id=session_id,
            messages=messages,
            config=attached,
            references=references,
            result_path=digest_path,
        )

        detached = agent_config(sandbox, None, harness)
        detached_revision = commit_config(workflow_id, variant_id, detached, "detached")
        detached_references = refs(workflow_id, variant_id, detached_revision["id"])
        if value_two in json.dumps(turn_two.raw_frames):
            raise RuntimeError("rotated credential appeared in the SSE stream")
        messages.extend(
            [
                turn_two.assistant_message(),
                user_msg(
                    f"Use your shell to test whether {ENV_NAME} is defined. Write only ABSENT to "
                    f"{absent_path} when it is undefined, otherwise write PRESENT. Do not inspect "
                    "or print any value. Reply only DONE."
                ),
            ]
        )
        turn_removed, absent = invoke_and_read(
            session_id=session_id,
            messages=messages,
            config=detached,
            references=detached_references,
            result_path=absent_path,
        )

        passed = (
            digest_one == expected_one
            and digest_two == expected_two
            and digest_one != digest_two
            and absent == "ABSENT"
        )
        return {
            "status": "PASS" if passed else "FAIL",
            "sandbox": sandbox,
            "harness": harness,
            "workflow_id": workflow_id,
            "session_id": session_id,
            "initial_digest_matches": digest_one == expected_one,
            "rotated_digest_matches": digest_two == expected_two,
            "rotation_changed_digest": digest_one != digest_two,
            "removed_binding_absent": absent == "ABSENT",
            "frames": [turn_one.frames, turn_two.frames, turn_removed.frames],
            "raw_secret_exposed_in_result": False,
        }
    except Exception as error:  # noqa: BLE001
        return {
            "status": "SKIP" if "no object store" in str(error).lower() else "FAIL",
            "sandbox": sandbox,
            "harness": harness,
            "workflow_id": workflow_id,
            "session_id": session_id,
            "why": f"{type(error).__name__}: {error}",
            "raw_secret_exposed_in_result": False,
        }
    finally:
        archive(workflow_id)
        if secret_id:
            delete_secret(secret_id)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=("local", "daytona"))
    parser.add_argument("--harness", choices=("codex", "pi"), default="codex")
    args = parser.parse_args()
    sandboxes = [args.only] if args.only else ["local", "daytona"]
    if args.harness == "pi" and any(sandbox == "daytona" for sandbox in sandboxes):
        parser.error("the Pi subscription baseline is local-only; pass --only local")
    results = [cell(sandbox, args.harness) for sandbox in sandboxes]
    print(json.dumps({"cell": "S1-custom-secrets", "results": results}, indent=2))
    return 0 if all(result["status"] == "PASS" for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
