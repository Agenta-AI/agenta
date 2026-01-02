import os
from typing import TYPE_CHECKING

from agenta.sdk.workflows.runners.base import CodeRunner
from agenta.sdk.workflows.runners.local import LocalRunner

if TYPE_CHECKING:
    from agenta.sdk.workflows.runners.daytona import DaytonaRunner


def _get_daytona_runner() -> "DaytonaRunner":
    from agenta.sdk.workflows.runners.daytona import DaytonaRunner

    return DaytonaRunner()


def get_runner() -> CodeRunner:
    """
    Registry to get the appropriate code runner based on environment configuration.

    Uses AGENTA_SERVICES_SANDBOX_RUNNER environment variable:
    - "local" (default): Uses RestrictedPython for local execution
    - "daytona": Uses Daytona remote sandbox

    Returns:
        CodeRunner: An instance of LocalRunner or DaytonaRunner

    Raises:
        ValueError: If Daytona runner is selected but required environment variables are missing
    """
    runner_type = os.getenv("AGENTA_SERVICES_SANDBOX_RUNNER", "local").lower()

    if runner_type == "daytona":
        try:
            return _get_daytona_runner()
        except ImportError as exc:
            raise ValueError(
                "Daytona runner requires the 'daytona' package. "
                "Install optional dependencies or set "
                "AGENTA_SERVICES_SANDBOX_RUNNER=local."
            ) from exc
    elif runner_type == "local":
        return LocalRunner()
    else:
        raise ValueError(
            f"Unknown AGENTA_SERVICES_SANDBOX_RUNNER value: {runner_type}. "
            f"Supported values: 'local', 'daytona'"
        )
