import os
import json
from contextlib import contextmanager
from typing import Any, Dict, Generator, Union, Optional, TYPE_CHECKING

import agenta as ag
from agenta.sdk.workflows.runners.base import CodeRunner
from agenta.sdk.contexts.running import RunningContext
from agenta.sdk.utils.lazy import _load_daytona

from agenta.sdk.utils.logging import get_module_logger

if TYPE_CHECKING:
    from daytona import Sandbox

log = get_module_logger(__name__)


def _extract_error_message(error_text: str) -> str:
    """Extract a clean error message from a Python traceback.

    Given a full traceback string, extracts just the final error line
    (e.g., "NameError: name 'foo' is not defined") instead of the full
    noisy traceback with base64-encoded code.

    Args:
        error_text: Full error/traceback string

    Returns:
        Clean error message, or original text if extraction fails
    """
    if not error_text:
        return "Unknown error"

    lines = error_text.strip().split("\n")

    # Look for common Python error patterns from the end
    for line in reversed(lines):
        line = line.strip()
        # Match patterns like "NameError: ...", "ValueError: ...", etc.
        if ": " in line and not line.startswith("File "):
            # Check if it looks like an error line (ErrorType: message)
            parts = line.split(": ", 1)
            if parts[0].replace(".", "").replace("_", "").isalnum():
                return line

    # Fallback: return last non-empty line
    for line in reversed(lines):
        if line.strip():
            return line.strip()

    return error_text[:200] if len(error_text) > 200 else error_text


class DaytonaRunner(CodeRunner):
    """Remote code runner using Daytona sandbox for execution."""

    _instance: Optional["DaytonaRunner"] = None

    def __new__(cls):
        """Singleton pattern to reuse Daytona client and sandbox."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        """Initialize Daytona runner with config from environment variables."""
        if self._initialized:
            return

        self._initialized = True
        self.daytona = None
        self._validate_config()

    def _validate_config(self) -> None:
        """Validate required environment variables for Daytona."""
        # Only DAYTONA_API_KEY is strictly required
        # DAYTONA_API_URL defaults to https://app.daytona.io/api
        # DAYTONA_TARGET defaults to AGENTA_REGION or 'eu'
        if not os.getenv("DAYTONA_API_KEY"):
            raise ValueError(
                "Missing required environment variable: DAYTONA_API_KEY. "
                "Set AGENTA_SERVICES_SANDBOX_RUNNER=local to use local execution instead."
            )

    def _initialize_client(self) -> None:
        """Lazily initialize Daytona client on first use."""
        if self.daytona is not None:
            return

        try:
            Daytona, DaytonaConfig, _, _ = _load_daytona()

            # Get configuration with fallbacks
            api_url = os.getenv("DAYTONA_API_URL") or "https://app.daytona.io/api"
            api_key = os.getenv("DAYTONA_API_KEY")
            target = os.getenv("DAYTONA_TARGET") or os.getenv("AGENTA_REGION") or "eu"

            config = DaytonaConfig(
                api_url=api_url,
                api_key=api_key,
                target=target,
            )
            self.daytona = Daytona(config)

        except Exception as e:
            raise RuntimeError(f"Failed to initialize Daytona client: {e}")

    def _get_provider_env_vars(self) -> Dict[str, str]:
        """
        Fetch user secrets and extract standard provider keys as environment variables.

        Returns:
            Dictionary of environment variables for standard providers
        """
        env_vars = {}

        # Get secrets from context (set by vault middleware)
        ctx = RunningContext.get()
        secrets = getattr(ctx, "vault_secrets", None) or []

        # Standard provider keys mapping
        provider_env_mapping = {
            "openai": "OPENAI_API_KEY",
            "cohere": "COHERE_API_KEY",
            "anyscale": "ANYSCALE_API_KEY",
            "deepinfra": "DEEPINFRA_API_KEY",
            "alephalpha": "ALEPHALPHA_API_KEY",
            "groq": "GROQ_API_KEY",
            "mistralai": "MISTRALAI_API_KEY",
            "anthropic": "ANTHROPIC_API_KEY",
            "perplexityai": "PERPLEXITYAI_API_KEY",
            # Secret kind is "together_ai" (underscore) even though the env var is TOGETHERAI_API_KEY
            "together_ai": "TOGETHERAI_API_KEY",
            "openrouter": "OPENROUTER_API_KEY",
            "gemini": "GEMINI_API_KEY",
        }

        # Extract provider keys from secrets
        for secret in secrets:
            if secret.get("kind") == "provider_key":
                secret_data = secret.get("data", {})
                provider_kind = secret_data.get("kind")

                if provider_kind in provider_env_mapping:
                    provider_settings = secret_data.get("provider", {})
                    api_key = provider_settings.get("key")

                    if api_key:
                        env_var_name = provider_env_mapping[provider_kind]
                        env_vars[env_var_name] = api_key

        return env_vars

    def _create_sandbox(self, runtime: Optional[str] = None) -> Any:
        """Create a new sandbox for this run from snapshot.

        Args:
            runtime: Runtime environment (python, javascript, typescript), None = python
        """
        try:
            if self.daytona is None:
                raise RuntimeError("Daytona client not initialized")

            # Normalize runtime: None means python
            runtime = runtime or "python"

            # Select general snapshot
            snapshot_id = os.getenv("DAYTONA_SNAPSHOT")

            if not snapshot_id:
                raise RuntimeError(
                    f"No Daytona snapshot configured for runtime '{runtime}'. "
                    f"Set DAYTONA_SNAPSHOT environment variable."
                )

            _, _, _, CreateSandboxFromSnapshotParams = _load_daytona()

            agenta_host = (
                ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host
                #
                or ""
            )
            agenta_api_url = (
                ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_url
                #
                or ""
            )
            agenta_credentials = (
                RunningContext.get().credentials
                #
                or ""
            )
            agenta_api_key = (
                agenta_credentials[7:]
                if agenta_credentials.startswith("ApiKey ")
                else ""
            )

            # Get provider API keys from user secrets
            provider_env_vars = self._get_provider_env_vars()

            # Combine base env vars with provider keys
            env_vars = {
                "AGENTA_HOST": agenta_host,
                "AGENTA_API_URL": agenta_api_url,
                "AGENTA_API_KEY": agenta_api_key,
                "AGENTA_CREDENTIALS": agenta_credentials,
                **provider_env_vars,  # Add provider API keys
            }

            sandbox = self.daytona.create(
                CreateSandboxFromSnapshotParams(
                    snapshot=snapshot_id,
                    ephemeral=True,
                    env_vars=env_vars,
                    language=runtime,
                )
            )

            return sandbox

        except Exception as e:
            raise RuntimeError(f"Failed to create sandbox from snapshot: {e}")

    @contextmanager
    def _sandbox_context(
        self, runtime: Optional[str] = None
    ) -> Generator["Sandbox", None, None]:
        """Context manager for sandbox lifecycle.

        Ensures sandbox is deleted even if an error occurs during execution.

        Args:
            runtime: Runtime environment (python, javascript, typescript), None = python

        Yields:
            Sandbox instance
        """
        sandbox = self._create_sandbox(runtime=runtime)
        try:
            yield sandbox
        finally:
            try:
                sandbox.delete()
            except Exception as e:
                log.error("Failed to delete sandbox: %s", e)

    def run(
        self,
        code: str,
        app_params: Dict[str, Any],
        inputs: Dict[str, Any],
        output: Union[dict, str],
        correct_answer: Any,
        runtime: Optional[str] = None,
        templates: Optional[Dict[str, str]] = None,
        *,
        version: str = "1",
        trace: Optional[Dict[str, Any]] = None,
    ) -> Union[float, None]:
        """
        Execute provided code in Daytona sandbox.

        The code must define an `evaluate()` function.
        - v1: evaluate(app_params, inputs, output, correct_answer) -> float
        - v2: evaluate(inputs, outputs, trace) -> float

        Args:
            code: The code to be executed
            app_params: The parameters of the app variant (v1 only)
            inputs: Inputs to be used during code execution
            output: The output of the app variant after being called
            correct_answer: The correct answer (or target) for comparison (v1 only)
            runtime: Runtime environment (python, javascript, typescript), None = python
            templates: Wrapper templates keyed by runtime.
            version: Evaluator interface version ("1" = legacy, "2" = new)
            trace: Full trace data (v2 only)

        Returns:
            Float score between 0 and 1, or None if execution fails
        """
        # Normalize runtime: None means python
        runtime = runtime or "python"

        self._initialize_client()

        with self._sandbox_context(runtime=runtime) as sandbox:
            try:
                # Prepare all parameters as a single dict based on version
                if version == "2":
                    params = {
                        "inputs": inputs,
                        "outputs": output,
                        "trace": trace,
                    }
                else:
                    params = {
                        "app_params": app_params,
                        "inputs": inputs,
                        "output": output,
                        "correct_answer": correct_answer,
                    }
                params_json = json.dumps(params)

                if not templates:
                    raise RuntimeError(
                        "Missing evaluator templates for Daytona execution"
                    )

                template = templates.get(runtime)
                if template is None:
                    raise RuntimeError(
                        f"Missing evaluator template for runtime '{runtime}'"
                    )

                # Wrap the user code with the necessary context and evaluation
                wrapped_code = template.format(
                    params_json=params_json,
                    user_code=code,
                )

                # Execute the code in the Daytona sandbox
                response = sandbox.process.code_run(wrapped_code)
                response_stdout = response.result if hasattr(response, "result") else ""
                response_exit_code = getattr(response, "exit_code", 0)
                response_error = getattr(response, "error", None) or getattr(
                    response, "stderr", None
                )

                if response_exit_code and response_exit_code != 0:
                    raw_error = response_error or response_stdout or "Unknown error"
                    # Log full error for debugging
                    # log.warning(
                    #     "Sandbox execution error (exit_code=%s): %s",
                    #     response_exit_code,
                    #     raw_error,
                    # )
                    # Extract clean error message for user display
                    clean_error = _extract_error_message(raw_error)
                    raise RuntimeError(clean_error)

                # Parse the result from stdout
                output_lines = response_stdout.strip().split("\n")
                for line in reversed(output_lines):
                    if not line.strip():
                        continue
                    try:
                        result_obj = json.loads(line)
                        if isinstance(result_obj, dict) and "result" in result_obj:
                            result = result_obj["result"]
                            if isinstance(result, (float, int, type(None))):
                                return float(result) if result is not None else None
                    except json.JSONDecodeError:
                        continue

                # Fallback: attempt to extract a JSON object containing "result"
                for line in reversed(output_lines):
                    if "result" not in line:
                        continue
                    start = line.find("{")
                    end = line.rfind("}")
                    if start == -1 or end == -1 or end <= start:
                        continue
                    try:
                        result_obj = json.loads(line[start : end + 1])
                    except json.JSONDecodeError:
                        continue
                    if isinstance(result_obj, dict) and "result" in result_obj:
                        result = result_obj["result"]
                        if isinstance(result, (float, int, type(None))):
                            return float(result) if result is not None else None

                # log.warning(
                #     "Evaluation output did not include JSON result: %s", response_stdout
                # )
                raise ValueError(
                    "Could not parse evaluation result from Daytona output"
                )

            except Exception as e:
                # log.warning(
                #     f"Error during Daytona code execution:\n {e}", exc_info=True
                # )
                raise RuntimeError(e)

    def cleanup(self) -> None:
        """Clean up Daytona client resources."""
        try:
            self.daytona = None
        except Exception:
            # Log but don't raise on cleanup failures
            log.error("Warning: Failed to cleanup Daytona resources", exc_info=True)

    def __del__(self):
        """Ensure cleanup on deletion."""
        try:
            self.cleanup()
        except Exception:
            pass
