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
            "2 prompts",
            "5k traces/month",
            "20 evaluations/month",
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
            "10k traces/month",
            "Unlimited evaluations",
            "3 seats included",
            "Up to 10 seats",
        ],
    },
    # {
    #     "title": "Business",
    #     "description": "For scale, security, and support.",
    #     "type": "standard",
    #     "price": {
    #         "base": {
    #             "type": "flat",
    #             "currency": "USD",
    #             "amount": 399.00,
    #             "starting_at": True,
    #         },
    #     },
    #     "features": [
    #         "Unlimited prompts",
    #         "Unlimited traces",
    #         "Unlimited evaluations",
    #         "Unlimited seats",
    #     ],
    # },
    {
        "title": "Enterprise",
        "description": "For large organizations or custom needs.",
        "type": "standard",
        "features": [
            "Everything in Pro",
            "Unlimited seats",
            "SOC 2 reports",
            "Security reviews",
            "Dedicated support",
            "Custom SLAs",
            "Custom terms",
            "Self-hosted deployment options",
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
            Gauge.APPLICATIONS: Quota(limit=2, strict=True, free=2),
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
