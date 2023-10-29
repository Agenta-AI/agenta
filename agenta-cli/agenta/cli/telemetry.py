# Stdlib Imports
import toml
from pathlib import Path

# Own Imports
from agenta.cli import helper

# Third party Imports
from posthog import Posthog


# Load telemetry configuration
helper.load_telemetry_config()

# Load global toml file
agenta_dir = Path.home() / ".agenta"
global_toml_file = toml.load(agenta_dir / "config.toml")


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
        distinct_id: str,
        event_name: str,
        body: dict,
    ) -> None:
        """
        Captures an event.

        Args:
            distinct_id (str): A unique identifier for the user or entity associated with the event.
            event_name (str): The name of the event being captured.
            body (dict): Contains the data associated with the event being captured.
        """

        self.capture(distinct_id, event_name, body)


# Initialize event tracking
event_track = EventTracking(
    global_toml_file["telemetry_api_key"], "https://app.posthog.com"
)
