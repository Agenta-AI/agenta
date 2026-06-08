"""
Shared helpers for end-to-end evaluation FLOW tests.

These tests trigger a real evaluation run through the worker + services
container and poll for completion. They run WITHOUT any LLM or code sandbox by
using the `agenta:custom:mock:v0` workflow for both the application
(invocation) and the evaluator (annotation). The mock workflow returns
predefined results selected by `parameters = {"key": ..., "kwargs": {...}}`.

See `sdks/python/agenta/sdk/engines/running/handlers.py::mock_v0` for the
selector vocabulary (echo / static / pass / fail / score / error / delay).
"""

from uuid import uuid4

from utils.polling import wait_for_response


MOCK_URI = "agenta:custom:mock:v0"


# - resource creation ---------------------------------------------------------


def create_mock_application(authed_api, *, key="echo", kwargs=None) -> dict:
    """Create a deterministic mock application (no LLM). Returns the application dict."""
    slug = uuid4().hex
    response = authed_api(
        "POST",
        "/simple/applications/",
        json={
            "application": {
                "slug": f"application-{slug}",
                "name": f"Mock Application {slug}",
                "data": {
                    "uri": MOCK_URI,
                    "parameters": {"key": key, "kwargs": kwargs or {}},
                },
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["application"]


def create_mock_evaluator(authed_api, *, key="pass", kwargs=None) -> dict:
    """Create a deterministic mock evaluator (no LLM). Returns the evaluator dict."""
    slug = uuid4().hex
    response = authed_api(
        "POST",
        "/simple/evaluators/",
        json={
            "evaluator": {
                "slug": f"evaluator-{slug}",
                "name": f"Mock Evaluator {slug}",
                "data": {
                    "uri": MOCK_URI,
                    "parameters": {"key": key, "kwargs": kwargs or {}},
                },
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["evaluator"]


def create_query(authed_api, *, trace_type="invocation") -> dict:
    """Create a simple query (filters over traces). Returns the query dict."""
    slug = uuid4().hex
    response = authed_api(
        "POST",
        "/simple/queries/",
        json={
            "query": {
                "slug": f"query-{slug}",
                "name": f"Query {slug}",
                "data": {
                    "filtering": {
                        "operator": "and",
                        "conditions": [
                            {
                                "field": "trace_type",
                                "operator": "is",
                                "value": trace_type,
                            }
                        ],
                    }
                },
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["query"]


def create_testset(authed_api, *, testcases=None) -> dict:
    """Create a simple testset. Returns the testset dict (with revision_id)."""
    slug = uuid4().hex
    if testcases is None:
        testcases = [
            {"data": {"input": "hello", "expected": "world"}},
            {"data": {"input": "hola", "expected": "mundo"}},
        ]
    response = authed_api(
        "POST",
        "/simple/testsets/",
        json={
            "testset": {
                "slug": f"testset-{slug}",
                "name": f"Testset {slug}",
                "data": {"testcases": testcases},
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["testset"]


def query_testcase_ids(authed_api, testset) -> list:
    """Return the testcase ids backing a testset (for direct-testcase queues)."""
    response = authed_api(
        "POST",
        "/testcases/query",
        json={"testset_id": testset["id"]},
    )
    assert response.status_code == 200, response.text
    return [tc["id"] for tc in response.json().get("testcases", [])]


def create_testcases_queue(authed_api, *, evaluator) -> dict:
    """Create a direct-testcases evaluation queue. Returns the queue dict (with run_id).

    The evaluator is passed as a list, which forces `origin="human"` on the
    evaluator step — a simple queue must have at least one human evaluator (the
    API rejects an all-auto queue), so scenarios park at PENDING for manual
    scoring (submit via `submit_annotation`, finalize via `close_scenario`).
    """
    response = authed_api(
        "POST",
        "/simple/queues/",
        json={
            "queue": {
                "name": f"testcases-queue-{uuid4().hex[:8]}",
                "data": {
                    "kind": "testcases",
                    "evaluators": [evaluator["revision_id"]],
                },
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["queue"]


def add_testcases_to_queue(authed_api, queue_id, testcase_ids) -> None:
    """Push a batch of testcases into a direct-testcases queue (dispatches the run)."""
    response = authed_api(
        "POST",
        f"/simple/queues/{queue_id}/testcases/",
        json={"testcase_ids": [str(tid) for tid in testcase_ids]},
    )
    assert response.status_code == 200, response.text


# - triggering and waiting -----------------------------------------------------

# Terminal statuses for an evaluation run.
TERMINAL_STATUSES = {"success", "failure", "errors", "cancelled"}


def create_simple_evaluation(authed_api, *, name, data, flags=None) -> dict:
    """Create (and auto-start) a simple evaluation. Returns the evaluation dict."""
    payload = {"name": name, "data": data}
    if flags is not None:
        payload["flags"] = flags
    response = authed_api(
        "POST",
        "/simple/evaluations/",
        json={"evaluation": payload},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["count"] == 1, body
    return body["evaluation"]


def wait_for_run_terminal(authed_api, run_id, *, max_retries=20):
    """Poll the run until it reaches a terminal status. Returns the final response."""
    return wait_for_response(
        authed_api,
        "GET",
        f"/evaluations/runs/{run_id}",
        condition_fn=lambda r: (
            r.status_code == 200
            and (r.json().get("run") or {}).get("status") in TERMINAL_STATUSES
        ),
        max_retries=max_retries,
    )


def fetch_run(authed_api, run_id) -> dict:
    """Return the run dict."""
    response = authed_api("GET", f"/evaluations/runs/{run_id}")
    assert response.status_code == 200, response.text
    return response.json().get("run") or {}


def query_scenarios(authed_api, run_id):
    """Return the list of scenarios for a run."""
    response = authed_api(
        "POST",
        "/evaluations/scenarios/query",
        json={"scenario": {"run_id": str(run_id)}},
    )
    assert response.status_code == 200, response.text
    return response.json().get("scenarios", [])


def wait_for_scenarios_terminal(authed_api, run_id, *, expected_count, max_retries=20):
    """Poll until `expected_count` scenarios exist and all are terminal.

    For queue-mode runs (direct testcases/traces) the RUN stays open and never
    finalizes — each pushed batch finalizes its own scenarios — so completion is
    asserted at the scenario level, not the run level.
    """
    wait_for_response(
        authed_api,
        "POST",
        "/evaluations/scenarios/query",
        json={"scenario": {"run_id": str(run_id)}},
        condition_fn=lambda r: (
            r.status_code == 200
            and len(r.json().get("scenarios", [])) >= expected_count
            and all(
                (s.get("status") in TERMINAL_STATUSES)
                for s in r.json().get("scenarios", [])
            )
        ),
        max_retries=max_retries,
    )
    return query_scenarios(authed_api, run_id)


def wait_for_scenarios(authed_api, run_id, *, expected_count, max_retries=20):
    """Poll until at least `expected_count` scenarios exist (any status).

    Human-annotation queue scenarios park at PENDING, so completion can't be
    asserted at the scenario level — this only waits for them to be minted.
    """
    wait_for_response(
        authed_api,
        "POST",
        "/evaluations/scenarios/query",
        json={"scenario": {"run_id": str(run_id)}},
        condition_fn=lambda r: (
            r.status_code == 200
            and len(r.json().get("scenarios", [])) >= expected_count
        ),
        max_retries=max_retries,
    )
    return query_scenarios(authed_api, run_id)


def submit_annotation(authed_api, *, evaluator, outputs, links) -> dict:
    """Submit a human annotation trace (the manual score) via POST /simple/traces.

    `links` binds the annotation to the scored coordinate (e.g. the scenario's
    input/invocation trace). Returns the created trace dict.
    """
    response = authed_api(
        "POST",
        "/simple/traces/",
        json={
            "trace": {
                "origin": "human",
                "kind": "eval",
                "channel": "api",
                "data": {"outputs": outputs},
                "references": {"evaluator": {"slug": evaluator["slug"]}},
                "links": links,
            }
        },
    )
    assert response.status_code in (200, 202), response.text
    return response.json()["trace"]


def close_scenario(authed_api, scenario, *, status="success") -> dict:
    """Move a scenario to a terminal status. FULL PUT: rebuild the edit from the
    fetched scenario, overriding only `status` (a dropped flags/interval/timestamp
    is wiped on write and would leave the scenario grey).
    """
    scenario_edit = dict(scenario)
    scenario_edit["status"] = status
    response = authed_api(
        "PATCH",
        f"/evaluations/scenarios/{scenario['id']}",
        json={"scenario": scenario_edit},
    )
    assert response.status_code == 200, response.text
    return response.json()["scenario"]


def query_metrics(authed_api, run_id):
    """Return the list of metrics for a run."""
    response = authed_api(
        "POST",
        "/evaluations/metrics/query",
        json={"metrics": {"run_id": str(run_id)}},
    )
    assert response.status_code == 200, response.text
    return response.json().get("metrics", [])


def wait_for_metrics(
    authed_api, run_id, *, expected_count=1, condition=None, max_retries=20
):
    """Poll metrics until they satisfy a condition, then return them.

    A run can flip to a terminal status a beat before its metric rows are
    written, and the worker writes them incrementally per scenario, so tests
    poll here rather than reading once. By default waits for `expected_count`
    rows; pass `condition` (a callable over the metrics list) to wait for a
    settled shape (e.g. the global aggregate reaching its final count).
    """
    if condition is None:

        def condition(metrics):
            return len(metrics) >= expected_count

    wait_for_response(
        authed_api,
        "POST",
        "/evaluations/metrics/query",
        json={"metrics": {"run_id": str(run_id)}},
        condition_fn=lambda r: (
            r.status_code == 200 and condition(r.json().get("metrics", []))
        ),
        max_retries=max_retries,
    )
    return query_metrics(authed_api, run_id)


# - metric extraction ----------------------------------------------------------

# The evaluator score aggregate lives under each evaluator step, keyed by the
# canonical output path.
SCORE_PATH = "attributes.ag.data.outputs.score"


def evaluator_score_means(metric):
    """Map each evaluator step's score mean from a metric row's step-keyed data.

    Returns {step_key: mean} for every evaluator step that carries the score
    path — lets a multi-evaluator test read each evaluator's value without
    coupling to the generated step slug.
    """
    means = {}
    for step_key, step_metrics in (metric.get("data") or {}).items():
        score = (step_metrics or {}).get(SCORE_PATH)
        if score and "mean" in score:
            means[step_key] = score["mean"]
    return means


def refresh_global_metric(authed_api, run_id, *, expect_evaluators, attempts=8):
    """Drive the whole-run metric refresh and return the global metric once all
    evaluator score aggregates are present and settled.

    The refresh is synchronous, but a run can report terminal a beat before
    every scenario's result cell is durably persisted under parallel load, so an
    early refresh may aggregate fewer evaluators/cells. Re-refresh (short) until
    `expect_evaluators` evaluator score rows appear; return that global metric.
    """
    import time

    last = None
    for attempt in range(attempts):
        response = authed_api(
            "POST",
            "/evaluations/metrics/refresh",
            json={"metrics": {"run_id": str(run_id)}},
        )
        assert response.status_code == 200, response.text
        metrics = response.json()["metrics"]
        global_metric = next((m for m in metrics if m.get("scenario_id") is None), None)
        if global_metric is not None:
            last = global_metric
            if len(evaluator_score_means(global_metric)) >= expect_evaluators:
                return global_metric
        time.sleep(min(0.5 * (2**attempt), 4.0))
    raise AssertionError(
        f"global metric did not reach {expect_evaluators} evaluator(s) "
        f"(last means={evaluator_score_means(last) if last else None})"
    )


# - lifecycle mutations --------------------------------------------------------


def start_evaluation(authed_api, evaluation_id):
    """Re-start (re-dispatch) an existing simple evaluation."""
    response = authed_api("POST", f"/simple/evaluations/{evaluation_id}/start")
    assert response.status_code == 200, response.text
    return response.json().get("evaluation") or {}


def stop_evaluation(authed_api, evaluation_id):
    """Stop (deactivate) a simple evaluation — sets is_active=False."""
    response = authed_api("POST", f"/simple/evaluations/{evaluation_id}/stop")
    assert response.status_code == 200, response.text
    return response.json().get("evaluation") or {}


def close_run(authed_api, run_id):
    """Close (lock) a run."""
    response = authed_api("POST", f"/evaluations/runs/{run_id}/close")
    assert response.status_code == 200, response.text
    return response.json()


def open_run(authed_api, run_id):
    """Open (unlock) a run."""
    response = authed_api("POST", f"/evaluations/runs/{run_id}/open")
    assert response.status_code == 200, response.text
    return response.json()


def fetch_default_queue(authed_api, run_id) -> dict:
    """Return the run's default queue dict (or {} if none)."""
    response = authed_api("GET", f"/evaluations/runs/{run_id}/queues/default")
    assert response.status_code == 200, response.text
    return response.json().get("queue") or {}


def create_queue(authed_api, run_id, *, is_default=False, name=None) -> dict:
    """Create a queue on a run. Defaults to a NON-default queue.

    Returns the created queue dict.
    """
    queue = {"run_id": run_id, "flags": {"is_default": is_default}}
    if name:
        queue["name"] = name
    response = authed_api("POST", "/evaluations/queues/", json={"queues": [queue]})
    assert response.status_code == 200, response.text
    return response.json()["queues"][0]
