# Stdlib Imports
from uuid import uuid4

# Own Imports
from agenta.cli import helper

# Third party Imports
from posthog import Posthog


# Load telemetry configuration
helper.init_telemetry_config()


class EventTracking(Posthog):
    _instance = None

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self, api_key: str, host: str) -> None:
        super(Posthog, self).__init__(api_key, host)

    def capture_event(
        self,
        event_name: str,
        body: dict,
    ) -> None:
        """
        Captures an event.

        Args:
            event_name (str): The name of the event being captured.
            body (dict): Contains the data associated with the event being captured.
        """

        # A unique identifier for the user or entity associated with the event
        distinct_id = helper.get_global_config("telemetry_distinct_id")
        if not distinct_id:
            distinct_id = uuid4()
            helper.set_global_config("telemetry_distinct_id", str(distinct_id))
        self.capture(distinct_id, event_name, body)


# Initialize event tracking
event_track = EventTracking(
    helper.get_global_config("telemetry_api_key"), "https://app.posthog.com"
)
