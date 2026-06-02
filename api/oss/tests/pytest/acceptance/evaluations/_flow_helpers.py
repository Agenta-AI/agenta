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


# - lifecycle mutations --------------------------------------------------------


def start_evaluation(authed_api, evaluation_id):
    """Re-start (re-dispatch) an existing simple evaluation."""
    response = authed_api("POST", f"/simple/evaluations/{evaluation_id}/start")
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
    response = authed_api("GET", f"/evaluations/runs/{run_id}/default-queue")
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


def archive_queue(authed_api, queue_id):
    """Archive a queue. Returns the response for status assertions."""
    return authed_api("POST", f"/evaluations/queues/{queue_id}/archive")


def unarchive_queue(authed_api, queue_id):
    """Unarchive a queue. Returns the response for status assertions."""
    return authed_api("POST", f"/evaluations/queues/{queue_id}/unarchive")
