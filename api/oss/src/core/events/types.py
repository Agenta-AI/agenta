from enum import Enum
from uuid import UUID

from pydantic import BaseModel


class RequestType(str, Enum):
    UNKNOWN = "unknown"
    ROUTER = "router"
    WORKER = "worker"


class EventType(str, Enum):
    UNKNOWN = "unknown"

    WEBHOOKS_SUBSCRIPTIONS_TESTED = "webhooks.subscriptions.tested"

    # Tracing reads
    TRACES_FETCHED = "traces.fetched"
    TRACES_QUERIED = "traces.queried"

    # Query revisions
    QUERIES_REVISIONS_RETRIEVED = "queries.revisions.retrieved"
    QUERIES_REVISIONS_FETCHED = "queries.revisions.fetched"
    QUERIES_REVISIONS_QUERIED = "queries.revisions.queried"
    QUERIES_REVISIONS_LOGGED = "queries.revisions.logged"
    QUERIES_REVISIONS_COMMITTED = "queries.revisions.committed"

    # Testcase reads
    TESTCASES_FETCHED = "testcases.fetched"
    TESTCASES_QUERIED = "testcases.queried"

    # Testset revisions
    TESTSETS_REVISIONS_RETRIEVED = "testsets.revisions.retrieved"
    TESTSETS_REVISIONS_FETCHED = "testsets.revisions.fetched"
    TESTSETS_REVISIONS_QUERIED = "testsets.revisions.queried"
    TESTSETS_REVISIONS_LOGGED = "testsets.revisions.logged"
    TESTSETS_REVISIONS_COMMITTED = "testsets.revisions.committed"

    # Workflow revisions
    WORKFLOWS_REVISIONS_RETRIEVED = "workflows.revisions.retrieved"
    WORKFLOWS_REVISIONS_FETCHED = "workflows.revisions.fetched"
    WORKFLOWS_REVISIONS_QUERIED = "workflows.revisions.queried"
    WORKFLOWS_REVISIONS_LOGGED = "workflows.revisions.logged"
    WORKFLOWS_REVISIONS_COMMITTED = "workflows.revisions.committed"

    # Application revisions — not currently emitted (applications emit as workflow events).
    # APPLICATIONS_REVISIONS_RETRIEVED = "applications.revisions.retrieved"
    # APPLICATIONS_REVISIONS_FETCHED = "applications.revisions.fetched"
    # APPLICATIONS_REVISIONS_QUERIED = "applications.revisions.queried"
    # APPLICATIONS_REVISIONS_LOGGED = "applications.revisions.logged"
    # APPLICATIONS_REVISIONS_COMMITTED = "applications.revisions.committed"

    # Evaluator revisions — not currently emitted (evaluators emit as workflow events).
    # EVALUATORS_REVISIONS_RETRIEVED = "evaluators.revisions.retrieved"
    # EVALUATORS_REVISIONS_FETCHED = "evaluators.revisions.fetched"
    # EVALUATORS_REVISIONS_QUERIED = "evaluators.revisions.queried"
    # EVALUATORS_REVISIONS_LOGGED = "evaluators.revisions.logged"
    # EVALUATORS_REVISIONS_COMMITTED = "evaluators.revisions.committed"

    # Environment revisions
    ENVIRONMENTS_REVISIONS_RETRIEVED = "environments.revisions.retrieved"
    ENVIRONMENTS_REVISIONS_FETCHED = "environments.revisions.fetched"
    ENVIRONMENTS_REVISIONS_QUERIED = "environments.revisions.queried"
    ENVIRONMENTS_REVISIONS_LOGGED = "environments.revisions.logged"
    ENVIRONMENTS_REVISIONS_COMMITTED = "environments.revisions.committed"


class RequestID(BaseModel):
    request_id: UUID


class EventID(BaseModel):
    event_id: UUID
