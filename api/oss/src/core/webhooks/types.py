from enum import Enum
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, HttpUrl

from oss.src.core.events.types import EventType
from oss.src.core.shared.dtos import (
    Header,
    Identifier,
    Lifecycle,
    Metadata,
    Status,
)


# --- CONFIGURATION --------------------------------------------------------- #

WEBHOOK_MAX_RETRIES = 5

WEBHOOK_TIMEOUT = 10.0  # seconds per request


# --- CONTEXT ALLOWLISTS ----------------------------------------------------- #

EVENT_CONTEXT_FIELDS = {
    "event_id",
    "event_type",
    "timestamp",
    "created_at",
    "attributes",
}

SUBSCRIPTION_CONTEXT_FIELDS = {
    "id",
    "name",
    "tags",
    "meta",
    "created_at",
    "updated_at",
}


# --- WEBHOOK EVENT TYPES --------------------------------------------------- #


class WebhookEventType(str, Enum):
    """Subscribable event types — a strict subset of EventType.

    Values are derived from EventType so the strings stay in sync.
    To add a new subscribable event type, it must first exist in EventType.
    When extending this enum, regenerate Fern clients and update the
    "Available event types" section in `04-webhooks.mdx`.
    """

    WEBHOOKS_SUBSCRIPTIONS_TESTED = EventType.WEBHOOKS_SUBSCRIPTIONS_TESTED.value

    # Tracing reads
    TRACES_FETCHED = EventType.TRACES_FETCHED.value
    TRACES_QUERIED = EventType.TRACES_QUERIED.value

    # Query revisions
    QUERIES_REVISIONS_RETRIEVED = EventType.QUERIES_REVISIONS_RETRIEVED.value
    QUERIES_REVISIONS_FETCHED = EventType.QUERIES_REVISIONS_FETCHED.value
    QUERIES_REVISIONS_QUERIED = EventType.QUERIES_REVISIONS_QUERIED.value
    QUERIES_REVISIONS_LOGGED = EventType.QUERIES_REVISIONS_LOGGED.value
    QUERIES_REVISIONS_COMMITTED = EventType.QUERIES_REVISIONS_COMMITTED.value

    # Testcase reads
    TESTCASES_FETCHED = EventType.TESTCASES_FETCHED.value
    TESTCASES_QUERIED = EventType.TESTCASES_QUERIED.value

    # Testset revisions
    TESTSETS_REVISIONS_RETRIEVED = EventType.TESTSETS_REVISIONS_RETRIEVED.value
    TESTSETS_REVISIONS_FETCHED = EventType.TESTSETS_REVISIONS_FETCHED.value
    TESTSETS_REVISIONS_QUERIED = EventType.TESTSETS_REVISIONS_QUERIED.value
    TESTSETS_REVISIONS_LOGGED = EventType.TESTSETS_REVISIONS_LOGGED.value
    TESTSETS_REVISIONS_COMMITTED = EventType.TESTSETS_REVISIONS_COMMITTED.value

    # Workflow revisions
    WORKFLOWS_REVISIONS_RETRIEVED = EventType.WORKFLOWS_REVISIONS_RETRIEVED.value
    WORKFLOWS_REVISIONS_FETCHED = EventType.WORKFLOWS_REVISIONS_FETCHED.value
    WORKFLOWS_REVISIONS_QUERIED = EventType.WORKFLOWS_REVISIONS_QUERIED.value
    WORKFLOWS_REVISIONS_LOGGED = EventType.WORKFLOWS_REVISIONS_LOGGED.value
    WORKFLOWS_REVISIONS_COMMITTED = EventType.WORKFLOWS_REVISIONS_COMMITTED.value

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
    ENVIRONMENTS_REVISIONS_RETRIEVED = EventType.ENVIRONMENTS_REVISIONS_RETRIEVED.value
    ENVIRONMENTS_REVISIONS_FETCHED = EventType.ENVIRONMENTS_REVISIONS_FETCHED.value
    ENVIRONMENTS_REVISIONS_QUERIED = EventType.ENVIRONMENTS_REVISIONS_QUERIED.value
    ENVIRONMENTS_REVISIONS_LOGGED = EventType.ENVIRONMENTS_REVISIONS_LOGGED.value
    ENVIRONMENTS_REVISIONS_COMMITTED = EventType.ENVIRONMENTS_REVISIONS_COMMITTED.value

    @classmethod
    def values(cls) -> List[str]:
        return [e.value for e in cls]


# --- WEBHOOK SUBSCRIPTIONS -------------------------------------------------- #


class WebhookSubscriptionData(BaseModel):
    url: HttpUrl
    headers: Optional[Dict[str, str]] = None
    payload_fields: Optional[Dict[str, Any]] = None
    auth_mode: Optional[Literal["signature", "authorization"]] = None

    event_types: Optional[List[WebhookEventType]] = None


class WebhookSubscription(Identifier, Lifecycle, Header, Metadata):
    data: WebhookSubscriptionData

    secret_id: Optional[UUID] = None
    secret: Optional[str] = None


class WebhookSubscriptionCreate(Header, Metadata):
    data: WebhookSubscriptionData

    secret: Optional[str] = None


class WebhookSubscriptionEdit(Identifier, Lifecycle, Header, Metadata):
    data: WebhookSubscriptionData

    secret: Optional[str] = None


class WebhookSubscriptionQuery(Header, Metadata):
    pass


# --- WEBHOOK DELIVERIES ----------------------------------------------------- #


class WebhookDeliveryResponseInfo(BaseModel):
    status_code: Optional[int] = None
    body: Optional[str] = None


class WebhookDeliveryData(BaseModel):
    event_type: Optional[WebhookEventType] = None

    url: HttpUrl
    headers: Optional[Dict[str, str]] = None
    payload: Optional[Dict[str, Any]] = None

    response: Optional[WebhookDeliveryResponseInfo] = None

    error: Optional[str] = None


class WebhookDelivery(Identifier, Lifecycle):
    status: Status

    data: Optional[WebhookDeliveryData] = None

    subscription_id: UUID
    event_id: UUID


class WebhookDeliveryCreate(Identifier):
    status: Status

    data: Optional[WebhookDeliveryData] = None

    subscription_id: UUID
    event_id: UUID


class WebhookDeliveryQuery(BaseModel):
    status: Optional[Status] = None

    subscription_id: Optional[UUID] = None
    event_id: Optional[UUID] = None
