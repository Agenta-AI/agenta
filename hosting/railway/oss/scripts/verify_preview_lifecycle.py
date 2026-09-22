"""Opt-in pre-merge acceptance with real GitHub and Railway APIs.

Uses a separate pr-clone-* environment and comment marker, never the PR's CI
environment. Replays a real human /preview comment through the production
handler because GitHub activates issue_comment workflows only on main.
"""

import json
import os
import re
import subprocess
from pathlib import Path

import preview_lifecycle as lifecycle


class ProofRailway(lifecycle.Railway):
    def name(self, pr):
        return f"pr-clone-lifecycle-{os.environ['GITHUB_RUN_ID']}"


def main():
    pr = int(os.environ["LIFECYCLE_PR"])
    comment_id = int(os.environ["COMMENT_ID"])
    run_id = int(os.environ["GITHUB_RUN_ID"])
    attempt = int(os.environ.get("GITHUB_RUN_ATTEMPT", "1"))
    gh = lifecycle.GitHub(os.environ["GITHUB_REPOSITORY"])
    head = gh.pr(pr)["head"]["sha"]
    tag = os.environ["IMAGE_TAG"]
    match = re.fullmatch(rf"pr-{pr}-{head}-([0-9]+)-([0-9]+)", tag)
    if not match:
        raise ValueError("Proof requires the exact PR-head image tag from workflow 14")
    source_run, source_attempt = map(int, match.groups())
    run = gh.api(f"actions/runs/{source_run}/attempts/{source_attempt}")
    if run["path"] != ".github/workflows/14-check-pr-preview.yml":
        raise ValueError("Image source must be the PR preview workflow")
    jobs = []
    page = 1
    while True:
        data = gh.api(
            f"actions/runs/{source_run}/attempts/{source_attempt}/jobs?per_page=100&page={page}"
        )
        jobs.extend(data["jobs"])
        if len(jobs) >= data["total_count"]:
            break
        page += 1
    builds = [job for job in jobs if job["name"].startswith("build /")]
    if len(builds) < 19 or any(job["conclusion"] != "success" for job in builds):
        raise ValueError(
            "All source image build jobs must have succeeded; application tests need not finish"
        )
    event = {
        "action": "created",
        "issue": gh.api(f"issues/{pr}"),
        "comment": gh.api(f"issues/comments/{comment_id}"),
    }
    if (
        event["comment"]["issue_url"]
        != f"https://api.github.com/repos/{gh.repo}/issues/{pr}"
    ):
        raise ValueError("Comment belongs to another issue")
    if event["comment"]["created_at"] != event["comment"]["updated_at"]:
        raise ValueError("An edited comment is not a valid proof request")
    lifecycle.MARKER = f"<!-- railway-lifecycle-proof-{run_id} -->"
    lifecycle.STATE = f"<!-- railway-lifecycle-proof-state-{run_id}:"
    now = [None]
    rw = ProofRailway()
    controller = lifecycle.Controller(
        gh, rw, pr, lambda: lifecycle.clock() if now[0] is None else now[0]
    )
    evidence = {
        "head": head,
        "workflow_sha": os.environ["GITHUB_SHA"],
        "source_images": tag,
        "environment": rw.name(pr),
        "comment_id": comment_id,
        "clock": "Real readiness, then an injected future clock for accelerated expiry; not a one-hour wall-clock test",
        "checks": [],
    }
    expected = f"pr-{pr}-{head}-{run_id}-{attempt}"
    try:
        accepted = controller.request(event, run_id, attempt)
        if accepted.get("sha") != head:
            raise RuntimeError("Fresh authorized comment was not accepted")
        evidence["checks"].append(
            "Real human comment read from GitHub; current write permission accepted"
        )
        # The normal comment workflow rebuilds. This test aliases the verified
        # successful build's manifests to its own unique tag to avoid building
        # the identical application a second time just for lifecycle evidence.
        for name in ["api", "web", "web-mobile", "services", "runner"]:
            image = f"ghcr.io/agenta-ai/agenta-{name}"
            subprocess.run(
                [
                    "docker",
                    "buildx",
                    "imagetools",
                    "create",
                    "-t",
                    f"{image}:{expected}",
                    f"{image}:{tag}",
                ],
                check=True,
            )
        controller.deploy(head, expected, run_id, attempt, "manual")
        evidence["url"] = controller.data["url"]
        evidence["ready_at"] = lifecycle.stamp(controller.data["ready"])
        expiry = controller.data["manual_until"]
        evidence["expiry"] = lifecycle.stamp(expiry)
        if expiry - controller.data["ready"] != 3600:
            raise RuntimeError("Default manual duration is not one hour")
        evidence["checks"].append(
            "Real Railway clone, pinned app images and readiness smoke passed; one-hour expiry stored and read back"
        )
        env_id = rw.find(pr)["id"]
        controller.request(event, run_id, attempt)
        if controller.data["manual_until"] != expiry or rw.find(pr)["id"] != env_id:
            raise RuntimeError("Duplicate command changed deadline or environment")
        evidence["checks"].append(
            "Comment redelivery did not renew the deadline or create another environment"
        )
        controller.finish("unrelated-generation")
        if rw.find(pr)["id"] != env_id:
            raise RuntimeError("Stale finalizer changed the environment")
        evidence["checks"].append(
            "Stale generation finalizer left the live preview untouched"
        )
        now[0] = expiry - 1
        controller.sweep()
        if not rw.find(pr):
            raise RuntimeError("Preview deleted before expiry")
        now[0] = expiry
        controller.sweep()
        if rw.find(pr) or controller.data["phase"] != "stopped":
            raise RuntimeError("Expiry did not delete the real environment")
        evidence["checks"].append(
            "At expiry, the production sweep deleted the real environment and verified absence"
        )
        # Exercise the automatic finalizer with the same built revision. No
        # application test suite is faked as passing; this is a lifecycle check.
        now[0] = None
        controller.deploy(head, expected, run_id, attempt, "ci")
        controller.finish(f"{run_id}-{attempt}")
        if rw.find(pr) or controller.data["phase"] != "stopped":
            raise RuntimeError(
                "Post-test finalizer did not delete the real environment"
            )
        evidence["checks"].append(
            "Automatic-mode setup followed by finish deleted the second real environment and verified absence"
        )
        evidence["result"] = "pass"
    finally:
        live = rw.find(pr)
        if live:
            rw.delete(pr, live["id"])
        evidence["environment_absent"] = rw.find(pr) is None
        evidence["storage"] = (
            "Environment absence verified. Retained-volume billing is not proven by this API check."
        )
        Path("railway-lifecycle-evidence.json").write_text(
            json.dumps(evidence, indent=2) + "\n"
        )
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
            summary.write(
                "## Railway lifecycle acceptance\n\n```json\n"
                + json.dumps(evidence, indent=2)
                + "\n```\n"
            )


if __name__ == "__main__":
    main()
