"""Offline tests for the Kubernetes mode and the Daytona harness choice of
`matrix_r1_two_replicas.py`. No cluster and no stack: pod JSON, log files and kubectl output are
built here, and every kubectl or docker call is faked."""

import argparse
import base64
import importlib
import os
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent


@pytest.fixture
def m(monkeypatch):
    monkeypatch.setenv("AGENTA_BASE", "http://localhost:9999")
    monkeypatch.setenv("AGENTA_PROJECT_ID", "proj-1")
    monkeypatch.setenv("AGENTA_API_KEY", "test-key")
    sys.path.insert(0, str(HERE))
    for cached in ("qa_matrix_lib", "session_control", "matrix_r1_two_replicas"):
        sys.modules.pop(cached, None)
    return importlib.import_module("matrix_r1_two_replicas")


def _pod(
    name="rel-runner-abc-1",
    ip="10.0.0.7",
    ready=True,
    phase="Running",
    deleting=False,
    env=None,
    started="2026-10-06T06:00:00Z",
):
    env = (
        env
        if env is not None
        else [
            {"name": "AGENTA_RUNNER_PORT", "value": "8765"},
            {
                "name": "AGENTA_RUNNER_REPLICA_ID",
                "valueFrom": {"fieldRef": {"fieldPath": "metadata.name"}},
            },
            {
                "name": "POD_IP",
                "valueFrom": {"fieldRef": {"fieldPath": "status.podIP"}},
            },
            {
                "name": "AGENTA_RUNNER_REPLICA_ADDRESS",
                "value": "http://$(POD_IP):8765",
            },
            {
                "name": "AGENTA_RUNNER_TOKEN",
                "valueFrom": {"secretKeyRef": {"name": "s1", "key": "tok"}},
            },
        ]
    )
    meta = {
        "name": name,
        "namespace": "ns",
        "labels": {"pod-template-hash": "abc"},
        "ownerReferences": [{"kind": "ReplicaSet", "name": "rel-runner-abc"}],
    }
    if deleting:
        meta["deletionTimestamp"] = "2026-10-06T06:05:00Z"
    status = {
        "phase": phase,
        "conditions": [{"type": "Ready", "status": "True" if ready else "False"}],
        "containerStatuses": [
            {"name": "runner", "state": {"running": {"startedAt": started}}}
        ],
    }
    if ip:
        status["podIP"] = ip
    return {
        "metadata": meta,
        "spec": {"nodeName": "node-1", "containers": [{"name": "runner", "env": env}]},
        "status": status,
    }


class TestPodToRunner:
    def test_a_ready_pod(self, m):
        r = m.runner_from_pod(_pod())
        assert r.name == "rel-runner-abc-1"
        assert r.replica_id == "rel-runner-abc-1"
        assert r.address == "http://10.0.0.7:8765"
        assert r.started_at == "2026-10-06T06:00:00Z"
        assert (r.status, r.health) == ("running", "healthy")

    def test_a_terminating_pod(self, m):
        r = m.runner_from_pod(_pod(deleting=True))
        assert r.status == "terminating"
        assert r.health == "healthy"

    def test_a_pod_that_is_not_ready(self, m):
        r = m.runner_from_pod(_pod(ready=False))
        assert (r.status, r.health) == ("running", "unhealthy")

    def test_a_pending_pod_without_ip(self, m):
        r = m.runner_from_pod(_pod(ip=None, phase="Pending", ready=False))
        assert r.address == ""
        assert r.status == "pending"

    def test_a_literal_replica_id_and_port(self, m):
        env = [
            {"name": "AGENTA_RUNNER_PORT", "value": "9000"},
            {"name": "AGENTA_RUNNER_REPLICA_ID", "value": "fixed-id"},
        ]
        r = m.runner_from_pod(_pod(env=env))
        assert r.replica_id == "fixed-id"
        assert r.address == "http://10.0.0.7:9000"

    def test_no_env_falls_back_to_the_pod_name_and_default_port(self, m):
        r = m.runner_from_pod(_pod(env=[]))
        assert r.replica_id == "rel-runner-abc-1"
        assert r.address == "http://10.0.0.7:8765"

    def test_env_lookup_expands_references_and_hides_secrets(self, m):
        pod = _pod()
        assert (
            m._pod_env(pod, "runner", "AGENTA_RUNNER_REPLICA_ADDRESS")
            == "http://10.0.0.7:8765"
        )
        assert m._pod_env(pod, "runner", "AGENTA_RUNNER_TOKEN") is None
        assert m._pod_env(pod, "runner", "MISSING") is None
        assert m._secret_ref(pod, "runner", "AGENTA_RUNNER_TOKEN") == ("s1", "tok")
        assert m._secret_ref(pod, "runner", "AGENTA_RUNNER_PORT") is None

    def test_secret_values_are_decoded(self, m):
        secret = {"data": {"tok": base64.b64encode(b"value-1").decode()}}
        assert m._decode_secret(secret, "tok") == "value-1"
        assert m._decode_secret(secret, "other") is None

    def test_ready_means_exactly_two_ready_pods_none_terminating(self, m):
        a, b = m.runner_from_pod(_pod("a")), m.runner_from_pod(_pod("b"))
        draining = m.runner_from_pod(_pod("c", deleting=True))
        starting = m.runner_from_pod(_pod("d", ready=False))
        assert m._kube_ready([a, b])
        assert not m._kube_ready([a])
        assert not m._kube_ready([a, b, draining])
        assert not m._kube_ready([a, starting])
        assert not m._kube_ready([a, draining])

    def test_the_owner_chain(self, m):
        assert m._owner(_pod(), "ReplicaSet") == "rel-runner-abc"
        assert m._owner(_pod(), "Deployment") is None


class TestLogFiles:
    def test_since_keeps_the_docker_margin_and_drops_a_partial_line(self, m, tmp_path):
        path = tmp_path / "runner-a.log"
        path.write_text(
            "2026-10-06T06:00:00.000000000Z early\n"
            "2026-10-06T06:00:09.500000000Z inside the margin\n"
            "2026-10-06T06:00:20.123Z later\n"
            "no stamp here\n"
            "2026-10-06T06:00:30Z still being writ"
        )
        since = m._line_epoch("2026-10-06T06:00:11Z")
        lines = m._read_log_file(path, since)
        assert lines == [
            "2026-10-06T06:00:09.500000000Z inside the margin",
            "2026-10-06T06:00:20.123Z later",
        ]

    def test_a_missing_file_reads_empty(self, m, tmp_path):
        assert m._read_log_file(tmp_path / "nope.log", 0.0) == []

    def test_a_restarted_follower_skips_what_it_already_wrote(self, m, tmp_path):
        path = tmp_path / "f.log"
        follower = m._LogFollower(None, "p", "runner", path, since=0.0)

        class Proc:
            def __init__(self, lines):
                self.stdout = iter(lines)

        first = [
            "2026-10-06T06:00:01Z one\n",
            "2026-10-06T06:00:02Z two\n",
        ]
        follower._pump(Proc(first), 0.0)
        floor = follower.newest
        again = ["2026-10-06T06:00:02Z two\n", "2026-10-06T06:00:03Z three\n"]
        follower._pump(Proc(again), floor)
        assert path.read_text().splitlines() == [
            "2026-10-06T06:00:01Z one",
            "2026-10-06T06:00:02Z two",
            "2026-10-06T06:00:03Z three",
        ]

    def test_service_lines_merge_every_pod_in_time_order(self, m, tmp_path):
        stack = m.KubeStack.__new__(m.KubeStack)

        class Logs:
            def pods(self, component):
                return ["api-1", "api-2"] if component == "api" else []

            def lines(self, pod, since):
                return {
                    "api-1": ["2026-10-06T06:00:03Z S x", "2026-10-06T06:00:01Z S y"],
                    "api-2": ["2026-10-06T06:00:02Z S z", "2026-10-06T06:00:04Z other"],
                }[pod]

        stack.logs = Logs()
        assert stack.service_lines("api", 0.0, "S") == [
            "2026-10-06T06:00:01Z S y",
            "2026-10-06T06:00:02Z S z",
            "2026-10-06T06:00:03Z S x",
        ]


class FakeKube:
    def __init__(self, results):
        self.results = list(results)
        self.calls = []

    def run(self, *args, timeout=60.0):
        self.calls.append(args)
        rc, out = self.results.pop(0)
        return subprocess.CompletedProcess(args, rc, out, "")

    def json(self, *args, timeout=60.0):
        return {"items": [_pod("api-0")]}


class TestPostgres:
    def test_rows_split_like_the_docker_hook(self, m):
        assert m._psql_rows("a|b|\nc|d|e\n\n") == [["a", "b", ""], ["c", "d", "e"]]
        assert m._psql_rows("") == []

    def test_the_database_comes_from_the_api_env_not_a_name(self, m):
        assert m._uri_var("agenta_ee_core") == "POSTGRES_URI_CORE"
        assert m._uri_var("agenta_oss_tracing") == "POSTGRES_URI_TRACING"

    def test_psql_runs_in_the_api_pod_with_the_sql_as_an_argument(self, m):
        kube = FakeKube([(0, "t-1|{}|\n")])
        hooks = m.KubeHooks(kube, "rel")
        row = hooks.stream_row("s-1")
        assert row["turn_id"] == "t-1"
        assert row["flags"] == {}
        assert row["stopping_turn_id"] is None
        args = kube.calls[0]
        assert args[:5] == ("exec", "api-0", "-c", "api", "--")
        assert args[5:9] == ("sh", "-c", m.PSQL_IN_POD, "sh")
        assert args[9] == "POSTGRES_URI_CORE"
        assert "session_streams" in args[10] and "'s-1'" in args[10]

    def test_a_failed_exec_picks_the_pod_again_then_reads_empty(self, m, capsys):
        kube = FakeKube([(1, ""), (1, "")])
        assert m.KubeHooks(kube, "rel").psql("agenta_ee_core", "select 1") == []
        assert len(kube.calls) == 2
        assert "exited 1" in capsys.readouterr().err

    def test_the_in_pod_script_rewrites_the_driver_uri(self, m, tmp_path):
        # A stand-in `psql` that prints the URI it was given and the SQL.
        fake = tmp_path / "psql"
        fake.write_text(
            '#!/bin/sh\nprintf "%s\\n" "$1"\nfor a; do last=$a; done\n'
            'printf "%s\\n" "$last"\n'
        )
        fake.chmod(0o755)
        env = {
            "PATH": f"{tmp_path}:{os.environ['PATH']}",
            "POSTGRES_URI_CORE": "postgresql+asyncpg://u:p@h:5432/db_core?ssl=require",
        }
        out = subprocess.run(
            ["sh", "-c", m.PSQL_IN_POD, "sh", "POSTGRES_URI_CORE", "select 'a|b'"],
            capture_output=True,
            text=True,
            env=env,
            check=True,
        ).stdout.splitlines()
        assert out == [
            "postgresql://u:p@h:5432/db_core?sslmode=require",
            "select 'a|b'",
        ]

    def test_the_in_pod_script_refuses_an_unset_uri(self, m):
        res = subprocess.run(
            ["sh", "-c", m.PSQL_IN_POD, "sh", "POSTGRES_URI_NONE", "select 1"],
            capture_output=True,
            text=True,
            env={"PATH": os.environ["PATH"]},
        )
        assert res.returncode != 0


class TestKubectl:
    def test_every_call_is_pinned(self, m):
        k = m.Kubectl("ns-1", context="ctx-1", kubeconfig="/k/config")
        assert k.argv("get", "pods") == [
            "kubectl",
            "--kubeconfig",
            "/k/config",
            "--context",
            "ctx-1",
            "--namespace",
            "ns-1",
            "get",
            "pods",
        ]

    def test_without_context_or_kubeconfig(self, m):
        assert m.Kubectl("ns-1").argv("logs") == [
            "kubectl",
            "--namespace",
            "ns-1",
            "logs",
        ]

    def test_the_port_forward_first_line(self, m):
        assert m._forward_port("Forwarding from 127.0.0.1:43567 -> 8765\n") == 43567
        assert m._forward_port("Forwarding from [::1]:43568 -> 8765") == 43568
        assert m._forward_port("Handling connection for 43567") is None
        assert m._forward_port("error: unable to forward port") is None

    def test_the_drain_selector_names_only_this_release_runner_replicaset(self, m):
        assert m.drain_pod_selector("rel", "58d6") == (
            "app.kubernetes.io/instance=rel,app.kubernetes.io/component=runner,"
            "pod-template-hash=58d6"
        )

    def test_the_drain_refuses_pods_of_other_namespaces(self, m):
        mine = _pod("rel-runner-abc-1")
        other = _pod("rel-runner-abc-9")
        other["metadata"]["namespace"] = "elsewhere"
        assert m.drain_foreign_pods([mine], "ns") == []
        assert m.drain_foreign_pods([mine, other], "ns") == [
            "elsewhere/rel-runner-abc-9"
        ]


class TestModes:
    def test_the_survivor_in_docker_mode_is_only_the_other_container(self, m):
        stack = m.Stack.__new__(m.Stack)
        assert m.survivor(stack, ["b"], "a", "b") == "b"
        assert m.survivor(stack, ["a2"], "a", "b") is None
        assert m.survivor(stack, ["a"], "a", "b") is None
        assert m.survivor(stack, [], "a", "b") is None
        assert m.survivor(stack, ["b", "a"], "a", "b") is None

    def test_the_survivor_in_kube_mode_is_any_one_pod_but_a(self, m):
        stack = m.KubeStack.__new__(m.KubeStack)
        assert m.survivor(stack, ["b"], "a", "b") == "b"
        assert m.survivor(stack, ["a-new"], "a", "b") == "a-new"
        assert m.survivor(stack, ["a"], "a", "b") is None
        assert m.survivor(stack, ["b", "a-new"], "a", "b") is None

    def test_cells_that_need_the_other_kind_of_stack_skip(self, m):
        assert m.mode_skip("rollout-during-turn", kube=False)
        assert m.mode_skip("drain-node-parked-approval", kube=False)
        assert not m.mode_skip("rollout-during-turn", kube=True)
        assert m.mode_skip("identity-mismatch", kube=True)
        assert not m.mode_skip("identity-mismatch", kube=False)
        assert not m.mode_skip("warm-holder", kube=True)
        assert not m.mode_skip("warm-holder", kube=False)
        assert set(m.KUBE_ONLY_CELLS) <= set(m.PHASE2) & set(m.CELLS)

    def test_docker_mode_keeps_its_addresses_and_commands(self, m, monkeypatch):
        stack = m.Stack.__new__(m.Stack)
        stack.project = "proj"
        runner = m.Runner("proj-runner-1", "h1", "http://172.0.0.2:8765", "", "", "")
        assert stack.base_url(runner) == "http://172.0.0.2:8765"
        assert stack.service_log_name("api") == "proj-api-1"
        assert stack.drain_timeout_s(runner) == 200.0
        seen = {}

        def popen(argv, **kwargs):
            seen["argv"] = argv
            return None

        monkeypatch.setattr(m.subprocess, "Popen", popen)
        stack.begin_drain(runner)
        assert seen["argv"] == ["docker", "stop", "-t", "160", "proj-runner-1"]
        body = m._mock_run_body("s", "t", 10)
        url = urllib.parse.urlsplit(body["telemetry"]["exporters"]["otlp"]["endpoint"])
        assert (url.scheme, url.netloc, url.path) == (
            "http",
            "api:8000",
            "/otlp/v1/traces",
        )

    def test_kube_restore_waits_for_two_ready_pods(self, m):
        class Fake:
            kube = True

            def runners(self):
                return []

            def wait_healthy(self, name):
                return True

        runner = m.Runner("gone", "gone", "", "", "", "")
        assert m._restore(Fake(), runner) == {
            "was": "?",
            "replaced": True,
            "healthy": True,
        }


class TestNodeAndDrainSafety:
    def test_uncordon_retries_until_it_succeeds(self, m, monkeypatch):
        monkeypatch.setattr(m.time, "sleep", lambda s: None)
        stack = m.KubeStack.__new__(m.KubeStack)
        stack.kubectl = FakeKube([(1, ""), (0, "node/n1 uncordoned")])
        out = m._uncordon(stack, "n1")
        assert out["rc"] == 0
        assert out["attempts"] == 2
        assert stack.kubectl.calls == [("uncordon", "n1"), ("uncordon", "n1")]

    def test_a_last_uncordon_failure_is_printed_loudly(self, m, monkeypatch, capsys):
        monkeypatch.setattr(m.time, "sleep", lambda s: None)
        stack = m.KubeStack.__new__(m.KubeStack)
        stack.kubectl = FakeKube([(1, "")] * 5)
        out = m._uncordon(stack, "n1")
        assert (out["rc"], out["attempts"]) == (1, 5)
        assert "NODE n1 MAY STILL BE CORDONED" in capsys.readouterr().err

    def test_the_drain_probe_waits_for_the_drain_line_after_the_prestop(
        self, m, monkeypatch
    ):
        monkeypatch.setattr(m.time, "sleep", lambda s: None)

        class Stack:
            def __init__(self):
                self.reads = 0

            def logs_since(self, name, since):
                self.reads += 1
                if self.reads < 2:
                    return ["2026-10-06T06:00:05Z [shutdown] draining: old run"]
                return [
                    "2026-10-06T06:00:05Z [shutdown] draining: old run",
                    "2026-10-06T06:00:21Z [shutdown] draining: new turns are refused",
                ]

        since = m._line_epoch("2026-10-06T06:00:10Z")
        runner = m.Runner("a", "a", "", "", "", "")
        assert m.wait_drain_began(Stack(), runner, since, timeout=5) == 11.0

    def test_no_drain_line_reads_none(self, m, monkeypatch):
        class Stack:
            def logs_since(self, name, since):
                return []

        clock = iter(range(0, 1000, 10))
        monkeypatch.setattr(m.time, "time", lambda: float(next(clock)))
        monkeypatch.setattr(m.time, "sleep", lambda s: None)
        runner = m.Runner("a", "a", "", "", "", "")
        assert m.wait_drain_began(Stack(), runner, 0.0, timeout=30) is None


class TestTimings:
    def test_ttft_is_the_first_text_frame_after_the_request_start(self, m):
        turn = m.lib.Turn()
        assert isinstance(turn, m.TimedTurn)
        assert m._ttft(turn) is None
        turn.started_at = time.time() - 1.5
        turn.text_parts.append("hi")
        turn.text_parts.append(" there")
        assert 1.4 <= m._ttft(turn) <= 2.0
        assert turn.reply == "hi there"
        assert m.turn_summary(turn)["ttft_s"] == m._ttft(turn)


def _ctx(m, **over):
    args = argparse.Namespace(
        custom_slug="slug-1",
        custom_name="conn",
        custom_model="model-x",
        claude_model="haiku",
        claude_custom_name=None,
        subscription=None,
        daytona_harness="claude",
    )
    for k, v in over.items():
        setattr(args, k, v)
    return m.Ctx(args, None, Path("/nonexistent"))


class TestDaytonaHarness:
    def test_claude_keeps_the_shapes_it_had(self, m):
        ctx = _ctx(m)
        for shape in ("allow", "ask"):
            cfg = ctx.shape_config(shape)
            assert cfg["harness"] == {"kind": "claude"}
            assert cfg["sandbox"] == {"kind": "daytona"}
            assert cfg["llm"] == {
                "model": "haiku",
                "provider": "anthropic",
                "connection": {"mode": "agenta", "slug": None},
                "extras": {},
            }
            assert cfg["runner"]["permissions"] == {"default": shape}

    def test_pi_core_uses_the_custom_connection_on_daytona(self, m):
        ctx = _ctx(m, daytona_harness="pi_core")
        for shape in ("allow", "ask"):
            cfg = ctx.shape_config(shape)
            assert cfg["harness"] == {"kind": "pi_core"}
            assert cfg["sandbox"] == {"kind": "daytona"}
            assert cfg["llm"] == {
                "model": "conn/custom/model-x",
                "provider": None,
                "connection": {"mode": "agenta", "slug": "slug-1"},
                "extras": {},
            }
            assert cfg["runner"]["permissions"] == {"default": shape}

    @pytest.mark.parametrize("harness", ["claude", "pi_core"])
    def test_the_inprocess_shape_does_not_depend_on_the_flag(self, m, harness):
        cfg = _ctx(m, daytona_harness=harness).shape_config("inprocess")
        assert cfg["harness"] == {"kind": "pi_core"}
        assert cfg["sandbox"] == {"kind": "inprocess"}
        assert cfg["llm"]["model"] == "conn/custom/model-x"

    def test_config_records_the_harness_and_model_it_served(self, m, monkeypatch):
        ctx = _ctx(m, daytona_harness="pi_core")
        monkeypatch.setattr(m.lib, "create_workflow", lambda h, n: ("wf", "var"))
        monkeypatch.setattr(m.lib, "seed_and_baseline", lambda *a: ("rev", None))
        monkeypatch.setattr(m.lib, "refs", lambda *a: {"application": {"id": "x"}})
        ctx.config("allow")
        ctx.config("allow")
        assert ctx.used == [
            ("pi_core", "conn/custom/model-x"),
            ("pi_core", "conn/custom/model-x"),
        ]


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def _wait(m, answers, timeout=60.0):
    clock = FakeClock()
    seq = iter(answers)
    return m.wait_process_gone(
        lambda: next(seq), "rep-a", timeout=timeout, clock=clock, sleep=clock.sleep
    )


class TestKillWaitsForTheProcess:
    def test_gone_after_two_failed_probes_in_a_row(self, m):
        out = _wait(m, ["rep-a", "rep-a", "DOWN", "DOWN"])
        assert out == {
            "gone": True,
            "first_failed_probe_s": 2.0,
            "kill_gone_after_s": 3.0,
            "probes": 4,
        }

    def test_one_dropped_probe_is_not_a_death(self, m):
        out = _wait(m, ["rep-a", "DOWN", "rep-a", "DOWN", "DOWN"])
        assert out["gone"] is True
        assert out["first_failed_probe_s"] == 3.0
        assert out["kill_gone_after_s"] == 4.0

    def test_another_replica_at_the_address_counts_as_gone(self, m):
        assert _wait(m, ["rep-b", "rep-b"])["gone"] is True

    def test_a_probe_that_could_not_run_counts_as_neither(self, m):
        out = _wait(m, ["DOWN", None, "DOWN"])
        assert out["gone"] is True
        assert out["probes"] == 3

    def test_still_answering_at_the_timeout(self, m):
        out = _wait(m, ["rep-a"] * 100, timeout=5.0)
        assert out["gone"] is False
        assert out["kill_gone_after_s"] is None
        assert out["probes"] == 6

    def test_kube_kill_deletes_then_probes_from_an_api_pod(self, m, monkeypatch):
        monkeypatch.setattr(m.time, "sleep", lambda s: None)
        kube = FakeKube(
            [(0, ""), (0, "rel-runner-abc-1\n"), (0, "DOWN\n"), (0, "DOWN\n")]
        )
        stack = m.KubeStack.__new__(m.KubeStack)
        stack.kubectl = kube
        stack.hooks = m.KubeHooks(kube, "rel")
        out = stack.kill(m.runner_from_pod(_pod()))
        assert out["gone"] is True and out["probes"] == 3
        assert kube.calls[0] == (
            "delete",
            "pod",
            "rel-runner-abc-1",
            "--grace-period=0",
            "--force",
            "--wait=false",
        )
        probe = kube.calls[1]
        assert probe[:7] == ("exec", "api-0", "-c", "api", "--", "python", "-c")
        assert probe[7] == m.HEALTH_PROBE_PY
        assert probe[8] == "http://10.0.0.7:8765"

    def test_kube_kill_raises_when_the_process_never_goes(self, m, monkeypatch):
        clock = FakeClock()
        monkeypatch.setattr(m.time, "time", clock)
        monkeypatch.setattr(m.time, "sleep", clock.sleep)
        monkeypatch.setattr(m, "wait_process_gone", _never_gone)
        kube = FakeKube([(0, "")])
        stack = m.KubeStack.__new__(m.KubeStack)
        stack.kubectl = kube
        stack.hooks = m.KubeHooks(kube, "rel")
        with pytest.raises(RuntimeError, match="still answered /health"):
            stack.kill(m.runner_from_pod(_pod()))

    def test_the_probe_script_reports_down_when_nothing_answers(self, m):
        out = subprocess.run(
            [sys.executable, "-c", m.HEALTH_PROBE_PY, "http://127.0.0.1:9"],
            capture_output=True,
            text=True,
            check=True,
        )
        assert out.stdout.strip() == "DOWN"


def _never_gone(probe, replica_id, **kwargs):
    return {
        "gone": False,
        "first_failed_probe_s": None,
        "kill_gone_after_s": None,
        "probes": 60,
    }
