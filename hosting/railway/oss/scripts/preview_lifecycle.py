"""Bounded PR previews. All mutating callers share railway-preview-state-<PR>.

The bot comment is the only lifecycle record. GitHub owns run status; Railway
owns environment identity. No daemon, sleeping expiry job, or extra database.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import signal
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MARKER = "<!-- railway-preview-bot -->"
STATE = "<!-- railway-preview-state:"
BOT = "github-actions[bot]"
SHA = re.compile(r"[0-9a-f]{40}")


def clock():
    return int(time.time())


def stamp(value):
    return (
        dt.datetime.fromtimestamp(value, dt.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
        if value
        else "Not granted"
    )


def minutes(name, default):
    value = os.environ.get(name, str(default))
    if not value.isdigit() or not 1 <= int(value) <= 240:
        raise ValueError(f"{name} must be an integer from 1 to 240")
    return int(value) * 60


def settings():
    return {
        "manual": minutes("RAILWAY_MANUAL_PREVIEW_MINUTES", 60),
        "startup": minutes("RAILWAY_PREVIEW_STARTUP_MINUTES", 30),
        "ci": minutes("RAILWAY_CI_PREVIEW_MAX_MINUTES", 120),
    }


def run_json(args, payload=None):
    result = subprocess.run(
        args,
        input=json.dumps(payload) if payload is not None else None,
        text=True,
        capture_output=True,
        timeout=180,
        check=False,
    )
    if result.returncode:
        # Provider diagnostics can contain request data. Never echo credentials.
        raise RuntimeError(f"API command failed ({result.returncode})")
    return json.loads(result.stdout) if result.stdout.strip() else None


class GitHub:
    def __init__(self, repo):
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
            raise ValueError("Invalid repository")
        self.repo = repo

    def api(self, path, method="GET", data=None):
        args = ["gh", "api", f"repos/{self.repo}/{path}", "--method", method]
        if data is not None:
            args += ["--input", "-"]
        return run_json(args, data)

    def pages(self, path):
        pages = run_json(
            ["gh", "api", f"repos/{self.repo}/{path}", "--paginate", "--slurp"]
        )
        return [item for page in pages for item in page]

    def pr(self, pr):
        return self.api(f"pulls/{pr}")

    def comments(self, pr):
        return self.pages(f"issues/{pr}/comments?per_page=100")

    def save(self, pr, comment_id, body):
        path = (
            f"issues/comments/{comment_id}" if comment_id else f"issues/{pr}/comments"
        )
        result = self.api(path, "PATCH" if comment_id else "POST", {"body": body})
        check = self.api(f"issues/comments/{result['id']}")
        if check["body"] != body or check["user"]["login"] != BOT:
            raise RuntimeError("State comment write could not be verified")
        return result["id"]

    def authorized(self, login):
        if not re.fullmatch(r"[A-Za-z0-9-]+", login):
            return False
        response = self.api(f"collaborators/{login}/permission")
        return response.get("permission") in {"write", "maintain", "admin"}

    def active(self, run_id, attempt):
        run = self.api(f"actions/runs/{run_id}/attempts/{attempt}")
        return run["status"] != "completed"

    def stop(self, run_id, attempt):
        if not run_id or not self.active(run_id, attempt):
            return
        current = self.api(f"actions/runs/{run_id}")
        if current["run_attempt"] != attempt:
            return  # An older attempt must never cancel a newer attempt.
        self.api(f"actions/runs/{run_id}/cancel", "POST")
        for _ in range(30):
            if not self.active(run_id, attempt):
                return
            time.sleep(2)
        raise RuntimeError(
            "Dependent run has not stopped; refusing to replace/delete its preview"
        )


class Railway:
    def __init__(self):
        self.project_name = os.environ.get(
            "RAILWAY_TEMPLATE_PROJECT", "agenta-oss-clone-spike"
        )
        self.template = os.environ.get("RAILWAY_TEMPLATE_ENV", "pr-template")
        if self.project_name.startswith("agenta-oss-pr-"):
            raise ValueError("Legacy per-PR projects are not supported")
        # Resolve once through the existing credential and retry implementation.
        result = subprocess.run(
            [
                "bash",
                "-c",
                'source "$1"; rw_require_token; rw_find_project_id "$2"',
                "bash",
                str(ROOT.parent / "template/lib-graphql.sh"),
                self.project_name,
            ],
            capture_output=True,
            text=True,
            timeout=180,
            check=False,
        )
        self.project = result.stdout.strip()
        if result.returncode or not self.project:
            raise RuntimeError("Cannot resolve the configured Railway preview project")

    def query(self, query, variables):
        return run_json(
            [
                "bash",
                "-c",
                'source "$1"; rw_require_token; rw_graphql "$2" "$3"',
                "bash",
                str(ROOT.parent / "template/lib-graphql.sh"),
                query,
                json.dumps(variables),
            ]
        )["data"]

    def environments(self):
        cursor = None
        result = []
        while True:
            page = self.query(
                "query($p:String!,$after:String){environments(projectId:$p,first:100,after:$after){edges{node{id name createdAt}} pageInfo{hasNextPage endCursor}}}",
                {"p": self.project, "after": cursor},
            )["environments"]
            result.extend(edge["node"] for edge in page["edges"])
            if not page["pageInfo"]["hasNextPage"]:
                return result
            next_cursor = page["pageInfo"]["endCursor"]
            if not next_cursor or next_cursor == cursor:
                raise RuntimeError("Railway pagination did not advance")
            cursor = next_cursor

    def cleanup_test_previews(self):
        # Workflow 48 and this cleanup share a separate concurrency slot. Keep
        # the previous six-hour fallback for interrupted clone acceptance runs.
        for env in self.environments():
            name = env["name"]
            if name in {self.template, "production"} or not name.startswith(
                ("pr-clone-", "wp3-")
            ):
                continue
            created = int(
                dt.datetime.fromisoformat(
                    env["createdAt"].replace("Z", "+00:00")
                ).timestamp()
            )
            if clock() - created <= 6 * 3600:
                continue
            current = [
                item
                for item in self.environments()
                if item["id"] == env["id"] and item["name"] == name
            ]
            if not current:
                continue
            self.query(
                "mutation($id:String!){environmentDelete(id:$id)}", {"id": env["id"]}
            )
            if any(item["id"] == env["id"] for item in self.environments()):
                raise RuntimeError("Legacy test preview deletion could not be verified")
            print(f"Removed expired test environment {name}; absence verified")

    def name(self, pr):
        return f"pr-{pr}"

    def find(self, pr):
        name = self.name(pr)
        if name in {self.template, "production"}:
            raise ValueError("Protected environment")
        matches = [env for env in self.environments() if env["name"] == name]
        if len(matches) > 1:
            raise RuntimeError("Ambiguous preview name")
        return matches[0] if matches else None

    def delete(self, pr, env_id):
        live = self.find(pr)
        if not live:
            return
        if live["id"] != env_id:
            raise RuntimeError("Environment identity changed; refusing deletion")
        self.query("mutation($id:String!){environmentDelete(id:$id)}", {"id": env_id})
        if self.find(pr):
            raise RuntimeError(
                "Railway deletion not yet verified; next sweep will retry"
            )

    def create(self, pr, image_tag, timeout):
        # Run the existing trusted script, never a script from the source checkout.
        with tempfile.TemporaryDirectory(prefix="railway-output-") as folder:
            output = Path(folder) / "output"
            output.touch()
            env = dict(
                os.environ,
                PR_NUMBER=str(pr),
                IMAGE_TAG=image_tag,
                RAILWAY_PREVIEW_ENV_NAME=self.name(pr),
                GITHUB_OUTPUT=str(output),
            )
            proc = subprocess.Popen(
                ["bash", str(ROOT / "preview-clone-create.sh")],
                env=env,
                start_new_session=True,
            )
            try:
                code = proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGTERM)
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()
                raise RuntimeError("Preview startup deadline exceeded") from None
            if code:
                raise RuntimeError("Preview provisioning/readiness failed")
            values = dict(
                line.split("=", 1)
                for line in output.read_text().splitlines()
                if "=" in line
            )
            return values["preview_url"]


def parse_state(comment, pr):
    body = comment.get("body") or ""
    if (
        comment.get("user", {}).get("login") != BOT
        or MARKER not in body
        or STATE not in body
    ):
        return None
    raw = body.split(STATE, 1)[1].split(" -->", 1)[0]
    data = json.loads(raw)
    if data.get("version") != 1 or data.get("pr") != pr:
        raise ValueError("Invalid lifecycle record")
    for key in (
        "run_id",
        "attempt",
        "started",
        "ready",
        "ci_until",
        "manual_until",
        "manual_comment",
        "last_comment",
        "startup_until",
    ):
        if type(data.get(key)) is not int or data[key] < 0:
            raise ValueError(f"Invalid lifecycle field {key}")
    if not SHA.fullmatch(data.get("sha", "")):
        raise ValueError("Invalid source revision")
    if data.get("phase") not in {
        "building",
        "starting",
        "ready",
        "deleting",
        "stopped",
        "cleanup-failed",
    }:
        raise ValueError("Invalid lifecycle phase")
    if data.get("mode") not in {"ci", "manual"}:
        raise ValueError("Invalid lifecycle mode")
    if data.get("generation") != f"{data['run_id']}-{data['attempt']}":
        raise ValueError("Invalid generation")
    for key in ("manual", "startup", "ci"):
        if (
            type(data.get("limits", {}).get(key)) is not int
            or not 60 <= data["limits"][key] <= 14400
        ):
            raise ValueError("Invalid saved deadline settings")
    return data


def render(repo, data):
    lines = [
        MARKER,
        "### Railway Preview Environment",
        "",
        "| Item | Value |",
        "| --- | --- |",
        f"| Status | {data['phase']} |",
        f"| Commit | `{data['sha']}` |",
        f"| Manual expiry (UTC) | {stamp(data['manual_until'])} |",
        f"| CI deadline (UTC) | {stamp(data['ci_until'])} |",
        f"| Workflow | https://github.com/{repo}/actions/runs/{data['run_id']} |",
    ]
    if data.get("url") and data["phase"] == "ready":
        lines.append(f"| Preview | {data['url']} |")
    if data.get("note"):
        lines += ["", data["note"]]
    lines += [
        "",
        "Post `/preview` as a new comment to request a one-hour preview. Repeating it while active does not extend the hour.",
        "Preview data is disposable. Expiry is enforced by the next successful cleanup sweep, not an exact timer.",
        "Environment deletion stops its compute. Provider-retained storage and permanent services may still be billed.",
        "",
        STATE + json.dumps(data, sort_keys=True, separators=(",", ":")) + " -->",
    ]
    return "\n".join(lines)


class Controller:
    def __init__(self, gh, railway, pr, now=clock):
        self.gh, self.rw, self.pr, self.now = gh, railway, pr, now
        self.data, self.comment_id = None, None
        self.load()

    def load(self):
        matches = []
        for comment in self.gh.comments(self.pr):
            data = parse_state(comment, self.pr)
            if data:
                matches.append((comment["id"], data))
        if len(matches) > 1:
            raise RuntimeError(
                "Multiple lifecycle records; refusing ambiguous ownership"
            )
        self.comment_id, self.data = matches[0] if matches else (None, None)

    def save(self, note=""):
        self.data["note"] = note
        self.comment_id = self.gh.save(
            self.pr, self.comment_id, render(self.gh.repo, self.data)
        )

    def eligible(self, sha=None):
        pr = self.gh.pr(self.pr)
        if (
            pr["state"] != "open"
            or pr["draft"]
            or pr["head"]["repo"]["full_name"] != self.gh.repo
        ):
            raise ValueError("Preview requires an open, non-draft, same-repository PR")
        if sha and pr["head"]["sha"] != sha:
            raise ValueError("PR head changed; post a new /preview comment")
        return pr["head"]["sha"]

    def new(self, sha, run_id, attempt, mode, comment=0):
        if not SHA.fullmatch(sha) or run_id < 1 or attempt < 1:
            raise ValueError("Invalid revision or run identity")
        old_last = self.data["last_comment"] if self.data else 0
        self.data = {
            "version": 1,
            "pr": self.pr,
            "sha": sha,
            "run_id": run_id,
            "attempt": attempt,
            "generation": f"{run_id}-{attempt}",
            "mode": mode,
            "phase": "building",
            "limits": settings(),
            "started": 0,
            "ready": 0,
            "startup_until": 0,
            "ci_until": 0,
            "manual_until": 0,
            "manual_comment": comment,
            "last_comment": max(comment, old_last),
            "env_id": "",
            "url": "",
            "image_tag": "",
        }
        self.save()

    def request(self, event, run_id, attempt):
        comment = event.get("comment", {})
        if (
            event.get("action") != "created"
            or "pull_request" not in event.get("issue", {})
            or event["issue"].get("number") != self.pr
            or comment.get("body", "").strip() != "/preview"
            or comment.get("user", {}).get("type") != "User"
        ):
            return {}
        if not self.gh.authorized(comment["user"]["login"]):
            raise ValueError("Repository write permission is required")
        sha = self.eligible()
        comment_id = comment["id"]
        if self.data and comment_id <= self.data["last_comment"]:
            return {}  # Redelivery is never a new lease, even after expiry.
        self.reconcile()
        if self.data and self.data["phase"] != "stopped":
            d = self.data
            d["last_comment"] = comment_id
            if d["manual_comment"]:
                self.save(
                    "The existing manual request is unchanged. This command does not renew it."
                )
                return {}
            if d["sha"] != sha or d["phase"] != "ready":
                self.save(
                    "CI is preparing a different or unfinished preview. Post a new /preview when it finishes."
                )
                return {}
            d["manual_comment"] = comment_id
            d["manual_until"] = self.now() + d["limits"]["manual"]
            self.save("CI and manual review share this exact revision.")
            return {}
        self.new(sha, run_id, attempt, "manual", comment_id)
        return {"sha": sha, "generation": self.data["generation"]}

    def destroy(self, note):
        self.load()  # All callers hold the same Actions concurrency slot.
        d = self.data
        if not d:
            return
        live = self.rw.find(self.pr)
        if live and d["env_id"] and live["id"] != d["env_id"]:
            raise RuntimeError("Preview identity changed; refusing cleanup")
        d["phase"] = "deleting"
        if live:
            d["env_id"] = live["id"]
        self.save(note)
        try:
            if live:
                self.rw.delete(self.pr, live["id"])
            d["phase"] = "stopped"
            d["ci_until"] = d["manual_until"] = 0
            self.save(
                note
                + " Environment absence verified; retained storage requires separate provider accounting."
            )
        except Exception:
            d["phase"] = "cleanup-failed"
            self.save(
                "Cleanup failed or could not be verified. The next sweep will retry."
            )
            raise

    def reconcile(self):
        d = self.data
        if not d:
            return
        if d["phase"] == "stopped":
            # A create request may finish on Railway after a client timeout and
            # an initially successful absence check. Keep the tombstone useful.
            late = self.rw.find(self.pr)
            if late and d["started"]:
                created = int(
                    dt.datetime.fromisoformat(
                        late["createdAt"].replace("Z", "+00:00")
                    ).timestamp()
                )
                if d["env_id"] == late["id"] or (
                    not d["env_id"] and created >= d["started"]
                ):
                    self.destroy("Reconciling a late provider-side creation.")
                else:
                    raise RuntimeError(
                        "Unexpected environment after shutdown; ownership is ambiguous"
                    )
            return
        pr = self.gh.pr(self.pr)
        if pr["state"] != "open" or pr["draft"]:
            self.gh.stop(d["run_id"], d["attempt"])
            self.destroy("PR closed or converted to draft.")
            return
        now = self.now()
        active = self.gh.active(d["run_id"], d["attempt"])
        if d["phase"] in {"deleting", "cleanup-failed"}:
            if active:
                self.gh.stop(d["run_id"], d["attempt"])
            self.destroy("Retrying pending cleanup.")
            return
        if d["phase"] in {"building", "starting"}:
            if not active or (d["startup_until"] and now >= d["startup_until"]):
                self.gh.stop(d["run_id"], d["attempt"])
                self.destroy("Startup stopped or reached its deadline.")
            return
        if d["mode"] == "ci" and d["ci_until"]:
            if active and now >= d["ci_until"]:
                self.gh.stop(d["run_id"], d["attempt"])
                active = False
            if not active:
                d["ci_until"] = 0
        if d["manual_until"] and now >= d["manual_until"]:
            d["manual_until"] = 0
            d["manual_comment"] = 0
        self.save()
        if not d["ci_until"] and not d["manual_until"]:
            self.destroy("Preview use finished or expired.")

    def deploy(self, sha, image_tag, run_id, attempt, mode):
        self.eligible(sha)
        # Only images built by this workflow execution are accepted. Reuse of
        # arbitrary mutable registry tags is deliberately not an input here.
        expected_tag = f"pr-{self.pr}-{sha}-{run_id}-{attempt}"
        if image_tag != expected_tag:
            raise ValueError("Image tag does not identify this exact build")
        generation = f"{run_id}-{attempt}"
        preserved_manual_until = 0
        if mode == "manual":
            if (
                not self.data
                or self.data["generation"] != generation
                or self.data["phase"] != "building"
            ):
                raise ValueError("Manual request no longer owns this preview")
        else:
            manual_comment = 0
            if self.data and self.data["phase"] != "stopped":
                old = self.data
                if old["generation"] == generation:
                    raise ValueError(
                        "Deployment already started; reconcile instead of replaying"
                    )
                if old["mode"] == "ci" and (old["run_id"], old["attempt"]) > (
                    run_id,
                    attempt,
                ):
                    raise ValueError("A newer CI generation already owns this preview")
                self.gh.stop(old["run_id"], old["attempt"])
                if old["sha"] == sha:
                    manual_comment = old["manual_comment"]
                    preserved_manual_until = old["manual_until"]
                    live = self.rw.find(self.pr)
                    if (
                        old["phase"] == "ready"
                        and live
                        and live["id"] == old["env_id"]
                        and self.now() < old["started"] + old["limits"]["ci"]
                    ):
                        old.update(
                            run_id=run_id,
                            attempt=attempt,
                            generation=generation,
                            mode="ci",
                            ci_until=old["started"] + old["limits"]["ci"],
                        )
                        self.save(
                            "CI is reusing the ready exact-head preview. Manual expiry is unchanged."
                        )
                        return {"preview_url": old["url"], "generation": generation}
                self.destroy("Superseded CI work stopped before replacement.")
            self.new(sha, run_id, attempt, mode, manual_comment)
        d = self.data
        # Never adopt a legacy environment with unknown contents. Remove only
        # the exact preview name in the configured project after checking CI.
        legacy = self.rw.find(self.pr)
        if legacy:
            d["env_id"] = legacy["id"]
            self.save()
            self.rw.delete(self.pr, legacy["id"])
        d["phase"] = "starting"
        d["started"] = self.now()
        startup_budget = (
            min(d["limits"]["startup"], d["limits"]["ci"])
            if mode == "ci"
            else d["limits"]["startup"]
        )
        d["startup_until"] = d["started"] + startup_budget
        d["ci_until"] = d["started"] + d["limits"]["ci"] if mode == "ci" else 0
        d["image_tag"] = image_tag
        d["env_id"] = ""
        self.save()
        try:
            d["url"] = self.rw.create(self.pr, image_tag, startup_budget)
            self.eligible(sha)
            live = self.rw.find(self.pr)
            if not live:
                raise RuntimeError("Created preview cannot be read back")
            d["env_id"] = live["id"]
            d["ready"] = self.now()
            if d["ready"] >= d["startup_until"]:
                raise RuntimeError("Preview became ready after its startup deadline")
            d["phase"] = "ready"
            d["manual_until"] = preserved_manual_until or (
                d["ready"] + d["limits"]["manual"] if d["manual_comment"] else 0
            )
            self.save()
            return {"preview_url": d["url"], "generation": generation}
        except Exception:
            self.destroy("Provisioning failed; no manual review time granted.")
            raise

    def finish(self, generation):
        if (
            not self.data
            or self.data["generation"] != generation
            or self.data["phase"] == "stopped"
        ):
            return
        if self.data["phase"] != "ready":
            self.destroy("Workflow ended before readiness.")
            return
        self.data["ci_until"] = 0
        self.save()
        if self.data["manual_until"] <= self.now():
            self.destroy("Dependent tests finished. Post /preview for manual review.")

    def sweep(self):
        if self.data:
            self.reconcile()
            return
        live = self.rw.find(self.pr)
        if not live:
            return
        created = int(
            dt.datetime.fromisoformat(
                live["createdAt"].replace("Z", "+00:00")
            ).timestamp()
        )
        if self.now() - created > 6 * 3600:
            # Legacy fallback is intentionally age-only and never grants a new
            # lease. New generations always write intent before provisioning.
            self.rw.delete(self.pr, live["id"])
            print(f"Removed legacy preview pr-{self.pr}; absence verified")


def outputs(values):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a") as stream:
            for key, value in values.items():
                if "\n" in str(value):
                    raise ValueError("Multiline output refused")
                stream.write(f"{key}={value}\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "operation",
        choices=[
            "request",
            "deploy-ci",
            "deploy-manual",
            "finish",
            "sweep",
            "list",
            "legacy-tests",
        ],
    )
    args = parser.parse_args()
    gh = GitHub(os.environ["GITHUB_REPOSITORY"])
    rw = Railway()
    if args.operation == "legacy-tests":
        rw.cleanup_test_previews()
        return
    if args.operation == "list":
        prs = sorted(
            {
                int(env["name"][3:])
                for env in rw.environments()
                if re.fullmatch(r"pr-[1-9][0-9]*", env["name"])
            }
        )
        outputs({"prs": json.dumps(prs)})
        print(json.dumps(prs))
        return
    raw_pr = os.environ.get("PR_NUMBER", "")
    if not re.fullmatch(r"[1-9][0-9]*", raw_pr):
        raise ValueError("PR_NUMBER must be positive digits")
    controller = Controller(gh, rw, int(raw_pr))
    run_id, attempt = (
        int(os.environ["GITHUB_RUN_ID"]),
        int(os.environ.get("GITHUB_RUN_ATTEMPT", "1")),
    )
    if args.operation == "request":
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
        outputs(controller.request(event, run_id, attempt))
    elif args.operation.startswith("deploy-"):
        outputs(
            controller.deploy(
                os.environ["SOURCE_SHA"],
                os.environ["IMAGE_TAG"],
                run_id,
                attempt,
                args.operation[7:],
            )
        )
    elif args.operation == "finish":
        controller.finish(f"{run_id}-{attempt}")
    else:
        controller.sweep()


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as exc:
        # Our exceptions contain context, not provider response bodies or tokens.
        print(f"::error::{type(exc).__name__}: {exc}")
        raise SystemExit(1) from None
