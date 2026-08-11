import os
from typing import TYPE_CHECKING

from agenta.sdk.engines.running.runners.base import CodeRunner
from agenta.sdk.engines.running.runners.local import LocalRunner
from agenta.sdk.engines.running.runners.restricted import RestrictedRunner
from agenta.sdk.utils.logging import get_module_logger

if TYPE_CHECKING:
    from agenta.sdk.engines.running.runners.daytona import DaytonaRunner

log = get_module_logger(__name__)


def _get_daytona_runner() -> "DaytonaRunner":
    from agenta.sdk.engines.running.runners.daytona import DaytonaRunner

    return DaytonaRunner()


def get_runner() -> CodeRunner:
    """
    Registry to get the appropriate code runner based on environment configuration.

    Reads AGENTA_SERVICES_CODE_SANDBOX_RUNNER (canonical, v0.100.3+) with a
    fallback to the legacy AGENTA_SERVICES_SANDBOX_RUNNER.
    - "local" (default): Raw exec in the current process — no sandbox. The permissive
      zero-config self-host default; a warning is logged while it's active.
    - "restricted": In-process RestrictedPython sandbox (allowlisted imports).
    - "daytona": Remote Daytona sandbox (strongest isolation).

    Returns:
        CodeRunner: An instance of RestrictedRunner, LocalRunner, or DaytonaRunner

    Raises:
        ValueError: If an unknown runner is selected, or Daytona is selected but its
            required environment variables are missing.
    """
    runner_type = (
        os.getenv("AGENTA_SERVICES_CODE_SANDBOX_RUNNER")
        or os.getenv("AGENTA_SERVICES_SANDBOX_RUNNER")
        or "local"
    ).lower()

    if runner_type == "restricted":
        return RestrictedRunner()
    elif runner_type == "local":
        log.warning(
            "Custom-code evaluators are using the 'local' runner (default): user code "
            "runs with raw exec() and no sandbox in this process. Set "
            "AGENTA_SERVICES_CODE_SANDBOX_RUNNER=restricted or =daytona to harden a "
            "shared/multi-tenant deployment."
        )
        return LocalRunner()
    elif runner_type == "daytona":
        try:
            return _get_daytona_runner()
        except ImportError as exc:
            raise ValueError(
                "Daytona runner requires the 'daytona' package. "
                "Install optional dependencies or set "
                "AGENTA_SERVICES_CODE_SANDBOX_RUNNER=restricted."
            ) from exc
    else:
        raise ValueError(
            f"Unknown AGENTA_SERVICES_CODE_SANDBOX_RUNNER value: {runner_type}. "
            f"Supported values: 'restricted', 'local', 'daytona'"
        )
