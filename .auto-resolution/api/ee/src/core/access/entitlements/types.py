from typing import Optional
from enum import Enum
from pydantic import BaseModel, ConfigDict


class DefaultPlan(str, Enum):
    """Code-default plan slugs.

    Runtime plan slugs come from `ee.src.core.access.controls.get_plans()`
    (env-overridable). This enum is only the default-fallback identifier set,
    used as keys for `DEFAULT_ENTITLEMENTS` / `DEFAULT_CATALOG` and as fallback
    in `get_default_plan()` / `get_free_plan()` / `get_trial_plan()`.
    """

    CLOUD_V0_HOBBY = "cloud_v0_hobby"
    CLOUD_V0_PRO = "cloud_v0_pro"
    CLOUD_V0_BUSINESS = "cloud_v0_business"
    #
    CLOUD_V0_AGENTA_AI = "cloud_v0_agenta_ai"
    #
    SELF_HOSTED_ENTERPRISE = "self_hosted_enterprise"


# Permission slugs that the OWNER role always implies. `"*"` is the wildcard
# permission recognized by `permissions.py`. The `RequiredRole` enum itself now
# lives in `oss.src.core.access.permissions.types`.
OWNER_PERMISSIONS: list[str] = ["*"]


# Scope identifiers the access-controls layer knows about. Today only
# `project` permissions are enforced at runtime; organization/workspace
# scopes get the same minima for forward-compat.
SCOPES: tuple[str, ...] = ("organization", "workspace", "project")


class Tracker(str, Enum):
    FLAGS = "flags"
    COUNTERS = "counters"
    GAUGES = "gauges"
    THROTTLES = "throttles"


class Flag(str, Enum):
    RBAC = "rbac"
    AUDIT = "audit"
    ACCESS = "access"
    DOMAINS = "domains"
    SSO = "sso"


class Counter(str, Enum):
    EVALUATIONS_RUN = "evaluations_run"
    TRACES_INGESTED = "traces_ingested"
    TRACES_RETRIEVED = "traces_retrieved"
    CREDITS_CONSUMED = "credits_consumed"
    EVENTS_INGESTED = "events_ingested"
    RECORDS_INGESTED = "records_ingested"


class Gauge(str, Enum):
    USERS = "users"


class Constraint(str, Enum):
    BLOCKED = "blocked"
    READ_ONLY = "read_only"


class Retention(int, Enum):
    EPHEMERAL = 0  # instant
    HOURLY = 60  # 1 hour = 60 minutes
    DAILY = 1440  # 24 hours = 1 day = 1440 minutes
    WEEKLY = 10080  # 7 days = 168 hours = 10080 minutes
    MONTHLY = 44640  # 31 days = 744 hours = 44640 minutes
    QUARTERLY = 132480  # 92 days = 2208 hours = 132480 minutes
    YEARLY = 525600  # 365 days = 8760 hours = 525600 minutes


class Period(str, Enum):
    DAILY = "daily"
    MONTHLY = "monthly"
    YEARLY = "yearly"


class Scope(str, Enum):
    ORGANIZATION = "organization"
    WORKSPACE = "workspace"
    PROJECT = "project"
    USER = "user"


class Quota(BaseModel):
    free: Optional[int] = None
    limit: Optional[int] = None
    # `strict = None` is equivalent to `False` (non-strict).
    strict: Optional[bool] = None
    retention: Optional[Retention] = None
    # `scope = None` means organization-scoped (today's behavior).
    scope: Optional[Scope] = None
    # `period = None` means non-periodic (gauge); `MONTHLY` matches the
    # pre-existing `monthly=True` semantics.
    period: Optional[Period] = None

    model_config = ConfigDict(extra="forbid")


class Probe(BaseModel):
    period: Optional[Period] = None
    # `delta = None` is equivalent to `False` (absolute value, not a delta).
    delta: Optional[bool] = None

    model_config = ConfigDict(extra="forbid")


class Bucket(BaseModel):
    capacity: Optional[int] = None  # max tokens in the bucket
    rate: Optional[int] = None  # tokens added per minute
    algorithm: Optional[str] = None

    model_config = ConfigDict(extra="forbid")


class Category(str, Enum):
    STANDARD = "standard"
    CORE_FAST = "core_fast"
    CORE_SLOW = "core_slow"
    TRACING_FAST = "tracing_fast"
    TRACING_SLOW = "tracing_slow"
    SERVICES_FAST = "services_fast"
    SERVICES_SLOW = "services_slow"
    AI_SERVICES = "ai_services"


class Method(str, Enum):
    POST = "post"
    GET = "get"
    PUT = "put"
    PATCH = "patch"
    DELETE = "delete"
    QUERY = "query"
    MUTATION = "mutation"
    ANY = "any"


class Mode(str, Enum):
    INCLUDE = "include"
    EXCLUDE = "exclude"


class Throttle(BaseModel):
    bucket: Bucket
    mode: Mode
    categories: list[Category] | None = None
    endpoints: list[tuple[Method, str]] | None = None

    model_config = ConfigDict(extra="forbid")


ENDPOINTS = {
    Category.CORE_FAST: [
        (Method.POST, "*/retrieve"),
        (Method.POST, "/variants/configs/fetch"),
    ],
    Category.CORE_SLOW: [
        # None defined yet
    ],
    Category.TRACING_FAST: [
        (Method.POST, "/otlp/v1/traces"),
    ],
    Category.TRACING_SLOW: [
        (Method.POST, "/tracing/*/query"),
        #
        (Method.POST, "/tracing/spans/analytics"),  # LEGACY
    ],
    Category.SERVICES_FAST: [
        (Method.ANY, "/access/permissions/check"),
    ],
    Category.SERVICES_SLOW: [
        # None defined yet
    ],
    Category.AI_SERVICES: [
        (Method.POST, "/ai/services/tools/call"),
    ],
    Category.STANDARD: [
        # None defined yet
        # CATCH ALL
    ],
}


DEFAULT_CATALOG = [
    {
        "title": "Hobby",
        "description": "For individuals exploring Agenta.",
        "type": "standard",
        "plan": DefaultPlan.CLOUD_V0_HOBBY.value,
        "retention": Retention.WEEKLY.value,
        "price": {
            "base": {
                "type": "flat",
                "currency": "USD",
                "amount": 0.00,
            },
        },
        "features": [
            "2 team members",
            "Unlimited projects",
            "Unlimited agents and workflows",
            "5,000 agent runs / month",
            "1-week trace data retention",
            "Community support through GitHub Issues",
        ],
    },
    {
        "title": "Pro",
        "description": "For teams running agents in production.",
        "type": "standard",
        "plan": DefaultPlan.CLOUD_V0_PRO.value,
        "retention": Retention.MONTHLY.value,
        "price": {
            "base": {
                "type": "flat",
                "currency": "USD",
                "amount": 29.00,
            },
            "traces": {
                "type": "tiered",
                "currency": "USD",
                "tiers": [
                    {
                        "limit": 10_000,
                        "amount": 0.00,
                    },
                    {
                        "amount": 5.00,
                        "rate": 10_000,
                    },
                ],
            },
        },
        "features": [
            "Unlimited team members",
            "Unlimited projects, agents, and workflows",
            "Unlimited schedules and event triggers",
            "10,000 agent runs / month included, then $5 per additional 10,000",
            "Unlimited evaluations",
            "1-month trace data retention",
            "Community support through GitHub Issues",
        ],
    },
    {
        "title": "Business",
        "description": "For teams that need governance, compliance, and priority support.",
        "type": "standard",
        "plan": DefaultPlan.CLOUD_V0_BUSINESS.value,
        "retention": Retention.QUARTERLY.value,
        "price": {
            "base": {
                "type": "flat",
                "currency": "USD",
                "amount": 299.00,
            },
            "traces": {
                "type": "tiered",
                "currency": "USD",
                "tiers": [
                    {
                        "limit": 10_000,
                        "amount": 0.00,
                    },
                    {
                        "amount": 5.00,
                        "rate": 10_000,
                    },
                ],
            },
        },
        "features": [
            "Everything in Pro",
            "10,000 agent runs / month included, then $5 per additional 10,000",
            "Team roles and role-based access control",
            "SSO",
            "SOC 2 Type II report",
            "3-month trace data retention",
            "Priority support",
            "Private Slack Connect channel",
        ],
    },
    {
        "title": "Enterprise",
        "description": "For organizations that need advanced controls and dedicated support.",
        "type": "standard",
        "features": [
            "Everything in Business",
            "Custom usage and trace data retention",
            "Custom roles",
            "Audit logs",
            "Custom domains",
            "HIPAA BAA [soon]",
            "Security reviews",
            "Custom security and legal terms",
            "Self-hosting options",
            "Bring Your Own Cloud (BYOC)",
            "Deployment and onboarding support",
            "Dedicated support",
            "Private Slack Connect channel",
            "Custom service-level agreement",
        ],
    },
    {
        "title": "Agenta",
        "description": "For Agenta.",
        "plan": DefaultPlan.CLOUD_V0_AGENTA_AI.value,
        "type": "custom",
        "features": [
            "Everything in Enterprise",
        ],
    },
]

DEFAULT_ENTITLEMENTS = {
    DefaultPlan.CLOUD_V0_HOBBY: {
        Tracker.FLAGS: {
            Flag.RBAC: False,
            Flag.AUDIT: False,
            Flag.ACCESS: False,
            Flag.DOMAINS: False,
            Flag.SSO: False,
        },
        Tracker.COUNTERS: {
            Counter.EVALUATIONS_RUN: Quota(
                free=20,
                limit=20,
                strict=True,
                period=Period.MONTHLY,
            ),
            Counter.TRACES_INGESTED: Quota(
                free=5_000,
                limit=5_000,
                retention=Retention.WEEKLY,
                period=Period.MONTHLY,
            ),
            Counter.TRACES_RETRIEVED: Quota(
                strict=True,
                period=Period.DAILY,
                scope=Scope.USER,
            ),
            Counter.CREDITS_CONSUMED: Quota(
                free=100,
                limit=100,
                strict=True,
                period=Period.MONTHLY,
            ),
            Counter.EVENTS_INGESTED: Quota(
                retention=Retention.WEEKLY,
                period=Period.MONTHLY,
            ),
            Counter.RECORDS_INGESTED: Quota(
                retention=Retention.WEEKLY,
                period=Period.MONTHLY,
            ),
        },
        Tracker.GAUGES: {
            Gauge.USERS: Quota(
                free=2,
                limit=2,
                strict=True,
            ),
        },
        Tracker.THROTTLES: [
            Throttle(
                categories=[
                    Category.STANDARD,
                ],
                mode=Mode.INCLUDE,
                bucket=Bucket(
                    capacity=480,
                    rate=480,
                ),
            ),
            Throttle(
                categories=[
                    Category.CORE_FAST,
                    Category.TRACING_FAST,
                    Category.SERVICES_FAST,
                ],
                mode=Mode.INCLUDE,
                bucket=Bucket(
                    capacity=1200,
                    rate=1200,
                ),
            ),
            Throttle(
                categories=[
                    Category.CORE_SLOW,
                    Category.TRACING_SLOW,
                    Category.SERVICES_SLOW,
                ],
                mode=Mode.INCLUDE,
                bucket=Bucket(
                    capacity=120,
                    rate=1,
                ),
            ),
            Throttle(
                categories=[
                    Category.AI_SERVICES,
                ],
                mode=Mode.INCLUDE,
                bucket=Bucket(
                    capacity=10,
                    rate=30,
                ),
            ),
        ],
    },
    DefaultPlan.CLOUD_V0_PRO: {
        Tracker.FLAGS: {
            Flag.RBAC: False,
            Flag.AUDIT: False,
            Flag.ACCESS: False,
            Flag.DOMAINS: False,
            Flag.SSO: False,
        },
        Tracker.COUNTERS: {
            Counter.EVALUATIONS_RUN: Quota(
                strict=True,
                period=Period.MONTHLY,
            ),
            Counter.TRACES_INGESTED: Quota(
                free=10_000,
                retention=Retention.MONTHLY,
                period=Period.MONTHLY,
            ),
            Counter.TRACES_RETRIEVED: Quota(
                strict=True,
                scope=Scope.USER,
                period=Period.DAILY,
            ),
            Counter.CREDITS_CONSUMED: Quota(
                free=100,
                limit=100,
                strict=True,
                period=Period.MONTHLY,
            ),
            Counter.EVENTS_INGESTED: Quota(
                retention=Retention.MONTHLY,
                period=Period.MONTHLY,
            ),
            Counter.RECORDS_INGESTED: Quota(
                retention=Retention.MONTHLY,
                period=Period.MONTHLY,
            ),
        },
        Tracker.GAUGES: {
            Gauge.USERS: Quota(
                strict=True,
            ),
        },
        Tracker.THROTTLES: [
            Throttle(
                categories=[
                    Category.STANDARD,
                ],
                mode=Mode.INCLUDE,
                bucket=Bucket(
                    capacity=1440,
                    rate=1440,
                ),
            ),
            Throttle(
                categories=[
                    Category.CORE_FAST,
                    Category.TRACING_FAST,
                    Category.SERVICES_FAST,
                ],
                mode=Mode.INCLUDE,
                bucket=Bucket(
                    capacity=3600,
                    rate=3600,
                ),
            ),
            Throttle(
                categories=[
                    Category.CORE_SLOW,
                    Category.TRACING_SLOW,
                    Category.SERVICES_SLOW,
                ],
                mode=Mode.INCLUDE,
                bucket=Bucket(
                    capacity=180,
                    rate=1,
                ),
            ),
            Throttle(
                categories=[
                    Category.AI_SERVICES,
                ],
                mode=Mode.INCLUDE,
                bucket=Bucket(
                    capacity=30,
                    rate=90,
                ),
            ),
        ],
    },
    DefaultPlan.CLOUD_V0_BUSINESS: {
        Tracker.FLAGS: {
            Flag.RBAC: True,
            Flag.AUDIT: True,
            Flag.ACCESS: True,
            Flag.DOMAINS: True,
            Flag.SSO: True,
        },
        Tracker.COUNTERS: {
            Counter.EVALUATIONS_RUN: Quota(
                strict=True,
                period=Period.MONTHLY,
            ),
            Counter.TRACES_INGESTED: Quota(
                free=10_000,
                retention=Retention.QUARTERLY,
                period=Period.MONTHLY,
            ),
            Counter.TRACES_RETRIEVED: Quota(
                strict=True,
                scope=Scope.USER,
                period=Period.DAILY,
            ),
            Counter.CREDITS_CONSUMED: Quota(
                free=100,
                limit=100,
                strict=True,
                period=Period.MONTHLY,
            ),
            Counter.EVENTS_INGESTED: Quota(
                retention=Retention.QUARTERLY,
                period=Period.MONTHLY,
            ),
            Counter.RECORDS_INGESTED: Quota(
                retention=Retention.QUARTERLY,
                period=Period.MONTHLY,
            ),
        },
        Tracker.GAUGES: {
            Gauge.USERS: Quota(
                strict=True,
            ),
        },
        Tracker.THROTTLES: [
            Throttle(
                categories=[
                    Category.STANDARD,
                ],
                mode=Mode.INCLUDE,
                bucket=Bucket(
                    capacity=3600,
                    rate=3600,
                ),
            ),
            Throttle(
                categories=[
                    Category.CORE_FAST,
                    Category.TRACING_FAST,
                    Category.SERVICES_FAST,
                ],
                mode=Mode.INCLUDE,
                bucket=Bucket(
                    capacity=36000,
                    rate=36000,
                ),
            ),
            Throttle(
                categories=[
                    Category.CORE_SLOW,
                    Category.TRACING_SLOW,
                    Category.SERVICES_SLOW,
                ],
                mode=Mode.INCLUDE,
                bucket=Bucket(
                    capacity=1800,
                    rate=1,
                ),
            ),
            Throttle(
                categories=[
                    Category.AI_SERVICES,
                ],
                mode=Mode.INCLUDE,
                bucket=Bucket(
                    capacity=300,
                    rate=900,
                ),
            ),
        ],
    },
    DefaultPlan.CLOUD_V0_AGENTA_AI: {
        Tracker.FLAGS: {
            Flag.RBAC: True,
            Flag.AUDIT: True,
            Flag.ACCESS: True,
            Flag.DOMAINS: True,
            Flag.SSO: True,
        },
        Tracker.COUNTERS: {
            Counter.EVALUATIONS_RUN: Quota(
                strict=True,
                period=Period.MONTHLY,
            ),
            Counter.TRACES_INGESTED: Quota(
                period=Period.MONTHLY,
            ),
            Counter.TRACES_RETRIEVED: Quota(
                strict=True,
                scope=Scope.USER,
                period=Period.DAILY,
            ),
            Counter.CREDITS_CONSUMED: Quota(
                free=100,
                limit=100,
                strict=True,
                period=Period.MONTHLY,
            ),
            Counter.EVENTS_INGESTED: Quota(
                period=Period.MONTHLY,
            ),
            Counter.RECORDS_INGESTED: Quota(
                period=Period.MONTHLY,
            ),
        },
        Tracker.GAUGES: {
            Gauge.USERS: Quota(
                strict=True,
            ),
        },
    },
    DefaultPlan.SELF_HOSTED_ENTERPRISE: {
        Tracker.FLAGS: {
            Flag.RBAC: True,
            Flag.AUDIT: True,
            Flag.ACCESS: True,
            Flag.DOMAINS: True,
            Flag.SSO: True,
        },
        Tracker.COUNTERS: {
            Counter.EVALUATIONS_RUN: Quota(
                strict=True,
                period=Period.MONTHLY,
            ),
            Counter.TRACES_INGESTED: Quota(
                period=Period.MONTHLY,
            ),
            Counter.TRACES_RETRIEVED: Quota(
                strict=True,
                scope=Scope.USER,
                period=Period.DAILY,
            ),
            Counter.CREDITS_CONSUMED: Quota(
                strict=True,
                period=Period.MONTHLY,
            ),
            Counter.EVENTS_INGESTED: Quota(
                period=Period.MONTHLY,
            ),
            Counter.RECORDS_INGESTED: Quota(
                period=Period.MONTHLY,
            ),
        },
        Tracker.GAUGES: {
            Gauge.USERS: Quota(
                strict=True,
            ),
        },
    },
}


# Internal Counter/Gauge slug -> Stripe-side meter slot name. Membership in
# this map doubles as the "reportable to Stripe" set: a meter is reported iff
# its key is present here (`key in REPORTS`), and the value is the Stripe-side
# name to report under (`REPORTS[key]`).
REPORTS: dict[str, str] = {
    Counter.TRACES_INGESTED.value: "traces",
}

CONSTRAINTS = {
    Constraint.BLOCKED: {
        Tracker.FLAGS: [
            Flag.RBAC,
            Flag.ACCESS,
            Flag.DOMAINS,
            Flag.SSO,
            Flag.AUDIT,
        ],
        Tracker.GAUGES: [
            Gauge.USERS,
        ],
    },
    Constraint.READ_ONLY: {
        Tracker.COUNTERS: [
            Counter.EVALUATIONS_RUN,
            Counter.TRACES_INGESTED,
            Counter.TRACES_RETRIEVED,
            Counter.CREDITS_CONSUMED,
            Counter.EVENTS_INGESTED,
            Counter.RECORDS_INGESTED,
        ],
    },
}
