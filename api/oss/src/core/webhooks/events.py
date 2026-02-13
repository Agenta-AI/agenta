from enum import Enum
from typing import List


class WebhookEventType(str, Enum):
    # MVP Event
    CONFIG_DEPLOYED = "config.deployed"

    # Future Events (scaffolded for extensibility)
    # CONFIG_UPDATED = "config.updated"
    # CONFIG_CREATED = "config.created"
    # EVALUATION_COMPLETED = "evaluation.completed"
    # TEST_FAILED = "test.failed"

    @classmethod
    def mvp_events(cls) -> List[str]:
        return [cls.CONFIG_DEPLOYED.value]
