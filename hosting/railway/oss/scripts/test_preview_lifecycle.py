"""Offline acceptance tests. No tokens, network, Railway resources or sleeps."""

import copy
import json
import os
import unittest
from unittest.mock import patch

from preview_lifecycle import (
    BOT,
    MARKER,
    STATE,
    Controller,
    parse_state,
    render,
    settings,
)

SHA = "a" * 40
OTHER = "b" * 40


class GitHubFake:
    repo = "Agenta-AI/agenta"

    def __init__(self):
        self.records = []
        self.info = {
            "state": "open",
            "draft": False,
            "head": {"sha": SHA, "repo": {"full_name": self.repo}},
        }
        self.permission = True
        self.runs = {(1, 1): True, (2, 1): True}
        self.stopped = []

    def comments(self, pr):
        return copy.deepcopy(self.records)

    def pr(self, pr):
        return copy.deepcopy(self.info)

    def authorized(self, login):
        return self.permission

    def save(self, pr, comment_id, body):
        self.records = [{"id": 99, "user": {"login": BOT}, "body": body}]
        return 99

    def active(self, run, attempt):
        return self.runs.get((run, attempt), False)

    def stop(self, run, attempt):
        self.stopped.append((run, attempt))
        self.runs[(run, attempt)] = False


class RailwayFake:
    def __init__(self):
        self.live = None
        self.created = []
        self.deleted = []
        self.fail_create = False
        self.fail_delete = False
        self.counter = 0

    def find(self, pr):
        return copy.deepcopy(self.live)

    def create(self, pr, tag, timeout):
        self.counter += 1
        self.live = {
            "id": f"env-{self.counter}",
            "name": f"pr-{pr}",
            "createdAt": "2026-01-01T00:00:00Z",
        }
        self.created.append((pr, tag, timeout))
        if self.fail_create:
            raise RuntimeError("partial creation failed")
        return "https://preview.example/w"

    def delete(self, pr, identity):
        if self.fail_delete:
            raise RuntimeError("delete failed")
        if self.live and self.live["id"] != identity:
            raise RuntimeError("wrong identity")
        self.deleted.append(identity)
        self.live = None


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.gh, self.rw, self.time = GitHubFake(), RailwayFake(), 1000
        self.c = Controller(self.gh, self.rw, 123, lambda: self.time)

    def event(self, id=10, body="/preview", **extra):
        return {
            "action": "created",
            "issue": {"number": 123, "pull_request": {}},
            "comment": {
                "id": id,
                "body": body,
                "user": {"login": "maintainer", "type": "User"},
            },
            **extra,
        }

    def deploy(self, mode="ci", run=1):
        return self.c.deploy(
            self.gh.info["head"]["sha"],
            f"pr-123-{self.gh.info['head']['sha']}-{run}-1",
            run,
            1,
            mode,
        )

    def manual(self):
        self.c.request(self.event(), 1, 1)
        self.deploy("manual")

    def test_ci_finish_deletes(self):
        self.deploy()
        self.c.finish("1-1")
        self.assertIsNone(self.rw.live)
        self.assertEqual(self.c.data["phase"], "stopped")

    def test_ci_held_while_active(self):
        self.deploy()
        self.c.sweep()
        self.assertIsNotNone(self.rw.live)

    def test_failed_or_cancelled_run_cleaned_independently(self):
        self.deploy()
        self.gh.runs[(1, 1)] = False
        self.c.sweep()
        self.assertIsNone(self.rw.live)

    def test_partial_create_failure_deleted(self):
        self.rw.fail_create = True
        with self.assertRaises(RuntimeError):
            self.deploy()
        self.assertIsNone(self.rw.live)
        self.assertEqual(self.c.data["phase"], "stopped")

    def test_manual_hour_starts_at_ready_not_request(self):
        self.c.request(self.event(), 1, 1)
        self.time += 600
        self.deploy("manual")
        self.assertEqual(self.c.data["manual_until"], 5200)
        self.time = 5199
        self.c.sweep()
        self.assertIsNotNone(self.rw.live)
        self.time = 5200
        self.c.sweep()
        self.assertIsNone(self.rw.live)

    def test_duplicate_does_not_renew(self):
        self.manual()
        original = self.c.data["manual_until"]
        self.time += 300
        self.c.request(self.event(11), 2, 1)
        self.assertEqual(self.c.data["manual_until"], original)
        self.assertEqual(len(self.rw.created), 1)

    def test_redelivery_after_expiry_does_not_restart(self):
        self.manual()
        self.time += 3600
        self.c.sweep()
        self.assertEqual(self.c.request(self.event(), 2, 1), {})
        self.assertEqual(self.c.data["phase"], "stopped")

    def test_new_comment_after_expiry_restarts(self):
        self.manual()
        self.time += 3600
        self.c.sweep()
        result = self.c.request(self.event(11), 2, 1)
        self.assertEqual(result["sha"], SHA)
        self.deploy("manual", 2)
        self.assertEqual(len(self.rw.created), 2)

    def test_manual_holds_ci_after_finish(self):
        self.deploy()
        self.c.request(self.event(), 2, 1)
        self.c.finish("1-1")
        self.assertIsNotNone(self.rw.live)
        self.time += 3600
        self.c.sweep()
        self.assertIsNone(self.rw.live)

    def test_manual_expiry_does_not_kill_valid_ci(self):
        self.deploy()
        self.c.request(self.event(), 2, 1)
        self.time += 3600
        self.c.sweep()
        self.assertIsNotNone(self.rw.live)
        self.assertEqual(self.c.data["manual_until"], 0)
        self.c.finish("1-1")
        self.assertIsNone(self.rw.live)

    def test_ci_timeout_stops_run_before_delete(self):
        self.deploy()
        self.time += 7200
        self.c.sweep()
        self.assertEqual(self.gh.stopped, [(1, 1)])
        self.assertIsNone(self.rw.live)

    def test_new_revision_supersedes_old(self):
        self.deploy()
        self.c.request(self.event(), 2, 1)
        self.gh.info["head"]["sha"] = OTHER
        self.deploy(run=2)
        self.assertEqual(self.c.data["sha"], OTHER)
        self.assertEqual(self.c.data["manual_until"], 0)
        self.c.finish("1-1")
        self.assertIsNotNone(self.rw.live)

    def test_closed_pr_cancels_manual(self):
        self.manual()
        self.gh.info["state"] = "closed"
        self.c.sweep()
        self.assertIsNone(self.rw.live)
        self.assertEqual(self.gh.stopped, [(1, 1)])

    def test_draft_cancels_ci(self):
        self.deploy()
        self.gh.info["draft"] = True
        self.c.sweep()
        self.assertIsNone(self.rw.live)

    def test_unauthorized_has_no_mutations(self):
        self.gh.permission = False
        with self.assertRaises(ValueError):
            self.c.request(self.event(), 1, 1)
        self.assertFalse(self.rw.created)
        self.assertFalse(self.gh.records)

    def test_fork_rejected(self):
        self.gh.info["head"]["repo"]["full_name"] = "someone/fork"
        with self.assertRaises(ValueError):
            self.c.request(self.event(), 1, 1)
        self.assertFalse(self.rw.created)

    def test_draft_request_rejected(self):
        self.gh.info["draft"] = True
        with self.assertRaises(ValueError):
            self.c.request(self.event(), 1, 1)

    def test_command_parse(self):
        for text in [
            "hello /preview",
            "`/preview`",
            "```\n/preview\n```",
            "/preview 24h",
            "/preview; echo bad",
        ]:
            with self.subTest(text=text):
                self.assertEqual(self.c.request(self.event(body=text), 1, 1), {})
        self.assertFalse(self.gh.records)

    def test_trimmed_command(self):
        self.assertEqual(
            self.c.request(self.event(body=" /preview\n"), 1, 1)["sha"], SHA
        )

    def test_ignore_edit_bot_issue(self):
        event = self.event()
        event["action"] = "edited"
        self.assertEqual(self.c.request(event, 1, 1), {})
        event = self.event()
        event["comment"]["user"]["type"] = "Bot"
        self.assertEqual(self.c.request(event, 1, 1), {})
        event = self.event()
        del event["issue"]["pull_request"]
        self.assertEqual(self.c.request(event, 1, 1), {})

    def test_head_move_before_deploy_fails(self):
        self.c.request(self.event(), 1, 1)
        self.gh.info["head"]["sha"] = OTHER
        with self.assertRaises(ValueError):
            self.c.deploy(SHA, f"pr-123-{SHA}-1-1", 1, 1, "manual")
        self.assertFalse(self.rw.created)

    def test_image_tag_must_identify_build(self):
        for tag in ["latest", "pr-123-abc", f"pr-123-{OTHER}-1-1", f"pr-123-{SHA}-2-1"]:
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                self.c.deploy(SHA, tag, 1, 1, "ci")
        self.assertFalse(self.rw.created)

    def test_state_roundtrip_and_spoof_protection(self):
        self.deploy()
        actual = self.gh.records[0]
        self.assertEqual(parse_state(actual, 123), self.c.data)
        actual["user"]["login"] = "attacker"
        self.assertIsNone(parse_state(actual, 123))

    def test_bad_state_refused(self):
        self.deploy()
        d = dict(self.c.data, manual_until="tomorrow")
        self.gh.records[0]["body"] = MARKER + STATE + json.dumps(d) + " -->"
        with self.assertRaises(ValueError):
            self.c.load()

    def test_duplicate_state_refused(self):
        self.deploy()
        self.gh.records.append(copy.deepcopy(self.gh.records[0]))
        with self.assertRaises(RuntimeError):
            self.c.load()

    def test_wrong_environment_identity_not_deleted(self):
        self.deploy()
        self.rw.live["id"] = "another-env"
        with self.assertRaises(RuntimeError):
            self.c.finish("1-1")
        self.assertFalse(self.rw.deleted)

    def test_delete_failure_visible_and_retried(self):
        self.deploy()
        self.rw.fail_delete = True
        with self.assertRaises(RuntimeError):
            self.c.finish("1-1")
        self.assertEqual(self.c.data["phase"], "cleanup-failed")
        self.rw.fail_delete = False
        self.gh.runs[(1, 1)] = False
        self.c.sweep()
        self.assertIsNone(self.rw.live)

    def test_repeated_finish_idempotent(self):
        self.deploy()
        self.c.finish("1-1")
        self.c.finish("1-1")
        self.assertEqual(len(self.rw.deleted), 1)

    def test_build_failure_allocates_nothing(self):
        self.c.request(self.event(), 1, 1)
        self.c.finish("1-1")
        self.assertFalse(self.rw.created)
        self.assertEqual(self.c.data["phase"], "stopped")

    def test_no_state_no_environment_no_action(self):
        self.c.sweep()
        self.assertFalse(self.rw.deleted)

    def test_configuration_is_bounded(self):
        for value in ["0", "-1", "241", "1.5", "$(id)"]:
            with (
                self.subTest(value=value),
                patch.dict(os.environ, {"RAILWAY_MANUAL_PREVIEW_MINUTES": value}),
                self.assertRaises(ValueError),
            ):
                settings()

    def test_saved_configuration_does_not_move_deadline(self):
        self.manual()
        expiry = self.c.data["manual_until"]
        with patch.dict(os.environ, {"RAILWAY_MANUAL_PREVIEW_MINUTES": "120"}):
            self.c.request(self.event(11), 2, 1)
        self.assertEqual(self.c.data["manual_until"], expiry)

    def test_status_contains_commit_expiry_workflow(self):
        self.manual()
        body = render(self.gh.repo, self.c.data)
        for item in [
            SHA,
            "UTC",
            "https://preview.example/w",
            "/preview",
            "disposable",
            "actions/runs/1",
        ]:
            self.assertIn(item, body)


if __name__ == "__main__":
    unittest.main()
