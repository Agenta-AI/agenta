import os
from agenta.sdk.workflows.runners.base import CodeRunner
from agenta.sdk.workflows.runners.local import LocalRunner
from agenta.sdk.workflows.runners.daytona import DaytonaRunner


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
        return DaytonaRunner()
    elif runner_type == "local":
        return LocalRunner()
    else:
        raise ValueError(
            f"Unknown AGENTA_SERVICES_SANDBOX_RUNNER value: {runner_type}. "
            f"Supported values: 'local', 'daytona'"
        )
