"""Provider-boundary regressions; mock transport, not lifecycle behavior."""

import os
import unittest
from unittest.mock import Mock, patch

from preview_lifecycle import GitHub, ProvisioningError, Railway


class ProviderTests(unittest.TestCase):
    def railway(self):
        rw = Railway.__new__(Railway)
        rw.project, rw.template = "project", "pr-template"
        return rw

    def test_create_retries_while_a_deleted_name_is_still_releasing(self):
        rw = self.railway()
        rw._create_once = Mock(side_effect=[ProvisioningError("x"), "https://preview"])
        rw.find = Mock(return_value=None)  # nothing live: name is being released
        with patch.dict(os.environ, {"RAILWAY_CREATE_RETRY_SECONDS": "0"}):
            self.assertEqual(rw.create(7, "tag", 30), "https://preview")
        self.assertEqual(rw._create_once.call_count, 2)

    def test_create_does_not_retry_over_a_live_half_built_preview(self):
        rw = self.railway()
        rw._create_once = Mock(side_effect=ProvisioningError("mid-deploy"))
        rw.find = Mock(return_value={"id": "e1"})  # a live env means mid-deploy
        with (
            patch.dict(os.environ, {"RAILWAY_CREATE_RETRY_SECONDS": "0"}),
            self.assertRaises(ProvisioningError),
        ):
            rw.create(7, "tag", 30)
        self.assertEqual(rw._create_once.call_count, 1)

    def test_create_stops_after_the_attempt_budget(self):
        rw = self.railway()
        rw._create_once = Mock(side_effect=ProvisioningError("still held"))
        rw.find = Mock(return_value=None)
        with (
            patch.dict(
                os.environ,
                {"RAILWAY_CREATE_RETRY_SECONDS": "0", "RAILWAY_CREATE_ATTEMPTS": "2"},
            ),
            self.assertRaises(ProvisioningError),
        ):
            rw.create(7, "tag", 30)
        self.assertEqual(rw._create_once.call_count, 2)

    def test_paginates_beyond_first_hundred(self):
        rw = self.railway()
        rw.query = Mock(
            side_effect=[
                {
                    "environments": {
                        "edges": [{"node": {"name": f"pr-{n}"}} for n in range(1, 101)],
                        "pageInfo": {"hasNextPage": True, "endCursor": "next"},
                    }
                },
                {
                    "environments": {
                        "edges": [{"node": {"name": "pr-101"}}],
                        "pageInfo": {"hasNextPage": False, "endCursor": "last"},
                    }
                },
            ]
        )
        self.assertEqual(len(rw.environments()), 101)
        self.assertEqual(rw.query.call_args.args[1]["after"], "next")

    def test_bad_cursor_fails_instead_of_looping(self):
        rw = self.railway()
        rw.query = Mock(
            return_value={
                "environments": {
                    "edges": [],
                    "pageInfo": {"hasNextPage": True, "endCursor": None},
                }
            }
        )
        with self.assertRaises(RuntimeError):
            rw.environments()

    def test_protected_template_name(self):
        rw = self.railway()
        rw.template = "pr-123"
        with self.assertRaises(ValueError):
            rw.find(123)

    def test_find_does_not_match_other_environments(self):
        rw = self.railway()
        rw.environments = Mock(
            return_value=[
                {"id": "a", "name": "production"},
                {"id": "b", "name": "pr-template"},
                {"id": "c", "name": "pr-1234"},
            ]
        )
        self.assertIsNone(rw.find(123))

    def test_delete_refuses_wrong_id(self):
        rw = self.railway()
        rw.find = Mock(return_value={"id": "new", "name": "pr-123"})
        rw.query = Mock()
        with self.assertRaises(RuntimeError):
            rw.delete(123, "old")
        rw.query.assert_not_called()

    def test_delete_reads_back_absence(self):
        rw = self.railway()
        rw.find = Mock(side_effect=[{"id": "env"}, None])
        rw.query = Mock()
        rw.delete(123, "env")
        self.assertEqual(rw.find.call_count, 2)
        self.assertEqual(rw.query.call_args.args[1], {"id": "env"})

    def test_delete_reports_still_present(self):
        rw = self.railway()
        rw.find = Mock(return_value={"id": "env"})
        rw.query = Mock()
        with self.assertRaises(RuntimeError):
            rw.delete(123, "env")

    def test_permissions_use_current_github_permission(self):
        gh = GitHub("Agenta-AI/agenta")
        for permission in ["read", "triage", "none", "write", "maintain", "admin"]:
            with self.subTest(permission=permission):
                gh.api = Mock(return_value={"permission": permission})
                self.assertEqual(
                    gh.authorized("maintainer"),
                    permission in {"write", "maintain", "admin"},
                )

    def test_permission_api_error_fails_closed(self):
        gh = GitHub("Agenta-AI/agenta")
        gh.api = Mock(side_effect=RuntimeError("API unavailable"))
        with self.assertRaises(RuntimeError):
            gh.authorized("maintainer")

    def test_waiting_finalizer_is_not_an_active_resource_user(self):
        gh = GitHub("Agenta-AI/agenta")
        gh.api = Mock(return_value={"status": "in_progress"})
        gh.jobs = Mock(
            return_value=[
                {"name": "tests / run-api-tests (acceptance)", "status": "completed"},
                {"name": "cleanup / mutate", "status": "queued"},
            ]
        )
        self.assertFalse(gh.active(1, 1))

    def test_running_test_is_an_active_resource_user(self):
        gh = GitHub("Agenta-AI/agenta")
        gh.api = Mock(return_value={"status": "in_progress"})
        gh.jobs = Mock(
            return_value=[
                {"name": "tests / run-api-tests (acceptance)", "status": "in_progress"},
                {"name": "cleanup / mutate", "status": "queued"},
            ]
        )
        self.assertTrue(gh.active(1, 1))

    def test_between_job_scheduling_gap_is_not_treated_as_completion(self):
        gh = GitHub("Agenta-AI/agenta")
        gh.api = Mock(return_value={"status": "in_progress"})
        gh.jobs = Mock(
            return_value=[{"name": "build / prepare", "status": "completed"}]
        )
        self.assertTrue(gh.active(1, 1))

    def test_old_attempt_cannot_cancel_new_attempt(self):
        gh = GitHub("Agenta-AI/agenta")
        gh.active = Mock(return_value=True)
        gh.api = Mock(return_value={"run_attempt": 2})
        gh.stop(1, 1)
        self.assertEqual(gh.api.call_count, 1)

    @patch("preview_lifecycle.run_json")
    def test_github_pagination_flattens_pages(self, run):
        run.return_value = [[{"id": 1}], [{"id": 2}]]
        gh = GitHub("Agenta-AI/agenta")
        self.assertEqual(gh.comments(123), [{"id": 1}, {"id": 2}])
        self.assertIn("--paginate", run.call_args.args[0])

    def test_comment_write_verified(self):
        gh = GitHub("Agenta-AI/agenta")
        gh.api = Mock(
            side_effect=[
                {"id": 1},
                {
                    "id": 1,
                    "body": "different",
                    "user": {"login": "github-actions[bot]"},
                },
            ]
        )
        with self.assertRaises(RuntimeError):
            gh.save(123, None, "expected")


if __name__ == "__main__":
    unittest.main()
