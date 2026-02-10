from typing import Optional
from enum import Enum
from pydantic import BaseModel

from ee.src.core.subscriptions.types import Plan


class Tracker(str, Enum):
    FLAGS = "flags"
    COUNTERS = "counters"
    GAUGES = "gauges"
    THROTTLES = "throttles"


class Flag(str, Enum):
    # HISTORY = "history"
    HOOKS = "hooks"
    RBAC = "rbac"
    ACCESS = "access"
    DOMAINS = "domains"
    SSO = "sso"


class Counter(str, Enum):
    TRACES = "traces"
    EVALUATIONS = "evaluations"
    EVALUATORS = "evaluators"
    ANNOTATIONS = "annotations"
    CREDITS = "credits"


class Gauge(str, Enum):
    USERS = "users"
    APPLICATIONS = "applications"


class Constraint(str, Enum):
    BLOCKED = "blocked"
    READ_ONLY = "read_only"


class Periods(str, Enum):
    EPHEMERAL = 0  # instant
    HOURLY = 60  # 1 hour = 60 minutes
    DAILY = 1440  # 24 hours = 1 day = 1440 minutes
    MONTHLY = 44640  # 31 days = 744 hours = 44640 minutes
    QUARTERLY = 131040  # 91 days = 2184 hours = 131040 minutes
    YEARLY = 525600  # 365 days = 8760 hours = 525600 minutes


class Quota(BaseModel):
    free: Optional[int] = None
    limit: Optional[int] = None
    monthly: Optional[bool] = None
    strict: Optional[bool] = False
    retention: Optional[int] = None


class Probe(BaseModel):
    monthly: Optional[bool] = False
    delta: Optional[bool] = False


class Bucket(BaseModel):
    capacity: Optional[int] = None  # max tokens in the bucket
    rate: Optional[int] = None  # tokens added per minute
    algorithm: Optional[str] = None


class Category(str, Enum):
    STANDARD = "standard"
    CORE_FAST = "core_fast"
    CORE_SLOW = "core_slow"
    TRACING_FAST = "tracing_fast"
    TRACING_SLOW = "tracing_slow"
    SERVICES_FAST = "services_fast"
    SERVICES_SLOW = "services_slow"


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


ENDPOINTS = {
    Category.CORE_FAST: [
        (Method.POST, "*/retrieve"),
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
        (Method.ANY, "/permissions/verify"),
    ],
    Category.SERVICES_SLOW: [
        # None defined yet
    ],
    Category.STANDARD: [
        # None defined yet
        # CATCH ALL
    ],
}


CATALOG = [
    {
        "title": "Hobby",
        "description": "Great for hobby projects and POCs.",
        "type": "standard",
        "plan": Plan.CLOUD_V0_HOBBY.value,
        "retention": Periods.MONTHLY.value,
        "price": {
            "base": {
                "type": "flat",
                "currency": "USD",
                "amount": 0.00,
            },
        },
        "features": [
            "Unlimited prompts",
            "20 evaluations/month",
            "5k traces/month",
            "2 seats included",
            "30 days retention period",
            "Community support via Github",
        ],
    },
    {
        "title": "Pro",
        "description": "For production projects.",
        "type": "standard",
        "plan": Plan.CLOUD_V0_PRO.value,
        "retention": Periods.QUARTERLY.value,
        "price": {
            "base": {
                "type": "flat",
                "currency": "USD",
                "amount": 49.00,
            },
            "users": {
                "type": "tiered",
                "currency": "USD",
                "tiers": [
                    {
                        "limit": 3,
                        "amount": 0.00,
                    },
                    {
                        "limit": 10,
                        "amount": 20.00,
                        "rate": 1,
                    },
                ],
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
            "Unlimited prompts",
            "Unlimited evaluations",
            "10k traces / month included then $5 for every 10k",
            "3 seats included then $20 per seat",
            "90 days retention period",
            "In-app support",
        ],
    },
    {
        "title": "Business",
        "description": "For scale, security, and support.",
        "type": "standard",
        "plan": Plan.CLOUD_V0_BUSINESS.value,
        "retention": Periods.YEARLY.value,
        "price": {
            "base": {
                "type": "flat",
                "currency": "USD",
                "amount": 399.00,
            },
            "traces": {
                "type": "tiered",
                "currency": "USD",
                "tiers": [
                    {
                        "limit": 1_000_000,
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
            "Unlimited seats",
            "1M traces / month included then $5 for every 10k",
            "Multiple workspaces",
            "Roles and RBAC",
            "Enterprise SSO",
            "SOC 2 reports",
            "HIPAA BAA [soon]",
            "Private Slack Channel",
            "Business SLA",
            "365 days retention period",
        ],
    },
    {
        "title": "Enterprise",
        "description": "For large organizations or custom needs.",
        "type": "standard",
        "features": [
            "Everything in Business",
            "Custom roles",
            "Enterprise SSO",
            "Audit logs",
            "Self-hosting options",
            "Bring Your Own Cloud (BYOC)",
            "Security reviews",
            "Dedicated support",
            "Custom SLA",
            "Custom terms",
        ],
    },
    {
        "title": "Humanity Labs",
        "description": "For Humanity Labs.",
        "plan": Plan.CLOUD_V0_HUMANITY_LABS.value,
        "type": "custom",
        "features": [
            "Everything in Enterprise",
        ],
    },
    {
        "title": "X Labs",
        "description": "For X Labs.",
        "plan": Plan.CLOUD_V0_X_LABS.value,
        "type": "custom",
        "features": [
            "Everything in Enterprise",
        ],
    },
    {
        "title": "Agenta",
        "description": "For Agenta.",
        "plan": Plan.CLOUD_V0_AGENTA_AI.value,
        "type": "custom",
        "features": [
            "Everything in Enterprise",
        ],
    },
]

ENTITLEMENTS = {
    Plan.CLOUD_V0_HOBBY: {
        Tracker.FLAGS: {
            Flag.HOOKS: False,
            Flag.RBAC: False,
            Flag.ACCESS: False,
            Flag.DOMAINS: False,
            Flag.SSO: False,
        },
        Tracker.COUNTERS: {
            Counter.TRACES: Quota(
                limit=5_000,
                monthly=True,
                free=5_000,
                retention=Periods.MONTHLY.value,
            ),
            Counter.EVALUATIONS: Quota(
                limit=20,
                monthly=True,
                free=20,
                strict=True,
            ),
            Counter.CREDITS: Quota(
                limit=100,
                monthly=True,
                free=100,
                strict=True,
            ),
        },
        Tracker.GAUGES: {
            Gauge.USERS: Quota(
                limit=2,
                strict=True,
                free=2,
            ),
            Gauge.APPLICATIONS: Quota(
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
                    capacity=120,
                    rate=120,
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
        ],
    },
    Plan.CLOUD_V0_PRO: {
        Tracker.FLAGS: {
            Flag.HOOKS: True,
            Flag.RBAC: False,
            Flag.ACCESS: False,
            Flag.DOMAINS: False,
            Flag.SSO: False,
        },
        Tracker.COUNTERS: {
            Counter.TRACES: Quota(
                monthly=True,
                free=10_000,
                retention=Periods.QUARTERLY.value,
            ),
            Counter.EVALUATIONS: Quota(
                monthly=True,
                strict=True,
            ),
            Counter.CREDITS: Quota(
                limit=100,
                monthly=True,
                free=100,
                strict=True,
            ),
        },
        Tracker.GAUGES: {
            Gauge.USERS: Quota(
                limit=10,
                strict=True,
                free=3,
            ),
            Gauge.APPLICATIONS: Quota(
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
                    capacity=360,
                    rate=360,
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
        ],
    },
    Plan.CLOUD_V0_BUSINESS: {
        Tracker.FLAGS: {
            Flag.HOOKS: True,
            Flag.RBAC: True,
            Flag.ACCESS: True,
            Flag.DOMAINS: True,
            Flag.SSO: True,
        },
        Tracker.COUNTERS: {
            Counter.TRACES: Quota(
                monthly=True,
                free=1_000_000,
                retention=Periods.YEARLY.value,
            ),
            Counter.EVALUATIONS: Quota(
                monthly=True,
                strict=True,
            ),
            Counter.CREDITS: Quota(
                limit=100,
                monthly=True,
                free=100,
                strict=True,
            ),
        },
        Tracker.GAUGES: {
            Gauge.USERS: Quota(
                strict=True,
            ),
            Gauge.APPLICATIONS: Quota(
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
        ],
    },
    Plan.CLOUD_V0_HUMANITY_LABS: {
        Tracker.FLAGS: {
            Flag.HOOKS: True,
            Flag.RBAC: True,
            Flag.ACCESS: True,
            Flag.DOMAINS: True,
            Flag.SSO: True,
        },
        Tracker.COUNTERS: {
            Counter.TRACES: Quota(
                monthly=True,
            ),
            Counter.EVALUATIONS: Quota(
                monthly=True,
                strict=True,
            ),
        },
        Tracker.GAUGES: {
            Gauge.USERS: Quota(
                strict=True,
            ),
            Gauge.APPLICATIONS: Quota(
                strict=True,
            ),
        },
    },
    Plan.CLOUD_V0_X_LABS: {
        Tracker.FLAGS: {
            Flag.HOOKS: False,
            Flag.RBAC: False,
            Flag.ACCESS: False,
            Flag.DOMAINS: False,
            Flag.SSO: False,
        },
        Tracker.COUNTERS: {
            Counter.TRACES: Quota(
                monthly=True,
            ),
            Counter.EVALUATIONS: Quota(
                monthly=True,
                strict=True,
            ),
        },
        Tracker.GAUGES: {
            Gauge.USERS: Quota(
                strict=True,
            ),
            Gauge.APPLICATIONS: Quota(
                strict=True,
            ),
        },
    },
    Plan.CLOUD_V0_AGENTA_AI: {
        Tracker.FLAGS: {
            Flag.HOOKS: True,
            Flag.RBAC: True,
            Flag.ACCESS: True,
            Flag.DOMAINS: True,
            Flag.SSO: True,
        },
        Tracker.COUNTERS: {
            Counter.TRACES: Quota(
                monthly=True,
            ),
            Counter.EVALUATIONS: Quota(
                monthly=True,
                strict=True,
            ),
            Counter.CREDITS: Quota(
                limit=100_000,
                monthly=True,
                free=100_000,
                strict=True,
            ),
        },
        Tracker.GAUGES: {
            Gauge.USERS: Quota(
                strict=True,
            ),
            Gauge.APPLICATIONS: Quota(
                strict=True,
            ),
        },
    },
}


REPORTS = [
    Counter.TRACES.value,
    Gauge.USERS.value,
]

CONSTRAINTS = {
    Constraint.BLOCKED: {
        Tracker.FLAGS: [
            Flag.HOOKS,
            Flag.RBAC,
        ],
        Tracker.GAUGES: [
            Gauge.USERS,
            Gauge.APPLICATIONS,
        ],
    },
    Constraint.READ_ONLY: {
        Tracker.COUNTERS: [
            Counter.TRACES,
            Counter.EVALUATIONS,
        ],
    },
}
