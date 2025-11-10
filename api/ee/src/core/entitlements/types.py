from typing import Optional
from enum import Enum
from pydantic import BaseModel

from ee.src.core.subscriptions.types import Plan


class Tracker(str, Enum):
    FLAGS = "flags"
    COUNTERS = "counters"
    GAUGES = "gauges"


class Flag(str, Enum):
    # HISTORY = "history"
    HOOKS = "hooks"
    RBAC = "rbac"


class Counter(str, Enum):
    TRACES = "traces"
    EVALUATIONS = "evaluations"
    EVALUATORS = "evaluators"
    ANNOTATIONS = "annotations"


class Gauge(str, Enum):
    USERS = "users"
    APPLICATIONS = "applications"


class Constraint(str, Enum):
    BLOCKED = "blocked"
    READ_ONLY = "read_only"


class Quota(BaseModel):
    free: Optional[int] = None
    limit: Optional[int] = None
    monthly: Optional[bool] = None
    strict: Optional[bool] = False


class Probe(BaseModel):
    monthly: Optional[bool] = False
    delta: Optional[bool] = False


CATALOG = [
    {
        "title": "Hobby",
        "description": "Great for hobby projects and POCs.",
        "type": "standard",
        "plan": Plan.CLOUD_V0_HOBBY.value,
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
            "2 seats",
        ],
    },
    {
        "title": "Pro",
        "description": "For production projects.",
        "type": "standard",
        "plan": Plan.CLOUD_V0_PRO.value,
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
            "10k free traces/month",
            "3 free seats",
            "Up to 10 seats",
        ],
    },
    {
        "title": "Business",
        "description": "For scale, security, and support.",
        "type": "standard",
        "plan": Plan.CLOUD_V0_BUSINESS.value,
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
            "1M free traces/month",
            "Multiple workspaces [soon]",
            "Roles and RBAC",
            "SSO and MFA [soon]",
            "SOC 2 reports",
            "HIPAA BAA [soon]",
            "Private Slack Channel",
            "Business SLA",
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
        },
        Tracker.COUNTERS: {
            Counter.TRACES: Quota(limit=5_000, monthly=True, free=5_000),
            Counter.EVALUATIONS: Quota(limit=20, monthly=True, free=20, strict=True),
        },
        Tracker.GAUGES: {
            Gauge.USERS: Quota(limit=2, strict=True, free=2),
            Gauge.APPLICATIONS: Quota(strict=True),
        },
    },
    Plan.CLOUD_V0_PRO: {
        Tracker.FLAGS: {
            Flag.HOOKS: True,
            Flag.RBAC: False,
        },
        Tracker.COUNTERS: {
            Counter.TRACES: Quota(monthly=True, free=10_000),
            Counter.EVALUATIONS: Quota(monthly=True, strict=True),
        },
        Tracker.GAUGES: {
            Gauge.USERS: Quota(limit=10, strict=True, free=3),
            Gauge.APPLICATIONS: Quota(strict=True),
        },
    },
    Plan.CLOUD_V0_BUSINESS: {
        Tracker.FLAGS: {
            Flag.HOOKS: True,
            Flag.RBAC: True,
        },
        Tracker.COUNTERS: {
            Counter.TRACES: Quota(monthly=True, free=1_000_000),
            Counter.EVALUATIONS: Quota(monthly=True, strict=True),
        },
        Tracker.GAUGES: {
            Gauge.USERS: Quota(strict=True),
            Gauge.APPLICATIONS: Quota(strict=True),
        },
    },
    Plan.CLOUD_V0_HUMANITY_LABS: {
        Tracker.FLAGS: {
            Flag.HOOKS: True,
            Flag.RBAC: True,
        },
        Tracker.COUNTERS: {
            Counter.TRACES: Quota(monthly=True),
            Counter.EVALUATIONS: Quota(monthly=True, strict=True),
        },
        Tracker.GAUGES: {
            Gauge.USERS: Quota(strict=True),
            Gauge.APPLICATIONS: Quota(strict=True),
        },
    },
    Plan.CLOUD_V0_X_LABS: {
        Tracker.FLAGS: {
            Flag.HOOKS: False,
            Flag.RBAC: False,
        },
        Tracker.COUNTERS: {
            Counter.TRACES: Quota(monthly=True),
            Counter.EVALUATIONS: Quota(monthly=True, strict=True),
        },
        Tracker.GAUGES: {
            Gauge.USERS: Quota(strict=True),
            Gauge.APPLICATIONS: Quota(strict=True),
        },
    },
    Plan.CLOUD_V0_AGENTA_AI: {
        Tracker.FLAGS: {
            Flag.HOOKS: True,
            Flag.RBAC: True,
        },
        Tracker.COUNTERS: {
            Counter.TRACES: Quota(monthly=True),
            Counter.EVALUATIONS: Quota(monthly=True, strict=True),
        },
        Tracker.GAUGES: {
            Gauge.USERS: Quota(strict=True),
            Gauge.APPLICATIONS: Quota(strict=True),
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
