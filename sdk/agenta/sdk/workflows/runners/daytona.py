import os
import json
from typing import Any, Dict, Union, Optional

from daytona import Daytona, DaytonaConfig, Sandbox

from agenta.sdk.workflows.runners.base import CodeRunner
from agenta.sdk.contexts.running import RunningContext

from agenta.sdk.utils.logging import get_module_logger

import agenta as ag

log = get_module_logger(__name__)

# Template for wrapping Python user code with evaluation context
EVALUATION_CODE_TEMPLATE_PYTHON = """
import json

# Parse all parameters from a single dict
params = json.loads({params_json!r})
app_params = params['app_params']
inputs = params['inputs']
output = params['output']
correct_answer = params['correct_answer']

# User-provided evaluation code
{user_code}

# Execute and capture result
result = evaluate(app_params, inputs, output, correct_answer)

# Ensure result is a float
if isinstance(result, (float, int, str)):
    try:
        result = float(result)
    except (ValueError, TypeError):
        result = None

# Print result for capture
print(json.dumps({{"result": result}}))
"""

# Template for wrapping TypeScript user code with evaluation context
EVALUATION_CODE_TEMPLATE_TYPESCRIPT = """
// Parse all parameters from a single JSON string
const params = JSON.parse({params_json!r});
const app_params = params.app_params;
const inputs = params.inputs;
const output = params.output;
const correct_answer = params.correct_answer;

// User-provided evaluation code
{user_code}

// Execute and capture result
let result = evaluate(app_params, inputs, output, correct_answer);

// Ensure result is a number
if (typeof result === 'string') {{
    result = parseFloat(result);
}}
if (typeof result !== 'number' || isNaN(result)) {{
    result = null;
}}

// Print result for capture
console.log(JSON.stringify({{ result: result }}));
"""


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
        self.daytona: Optional[Daytona] = None
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
        secrets = getattr(ctx, "secrets", [])

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
            "togetherai": "TOGETHERAI_API_KEY",
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
            runtime: Runtime environment (python, typescript), None = python
        """
        try:
            if self.daytona is None:
                raise RuntimeError("Daytona client not initialized")

            # Normalize runtime: None means python
            runtime = runtime or "python"

            # Select snapshot based on runtime with fallback to general snapshot
            if runtime == "typescript":
                snapshot_id = os.getenv("AGENTA_SERVICES_SANDBOX_SNAPSHOT_TYPESCRIPT")
            else:  # default to python
                snapshot_id = os.getenv("AGENTA_SERVICES_SANDBOX_SNAPSHOT_PYTHON")

            # Fallback to general snapshot if runtime-specific one not found
            if not snapshot_id:
                snapshot_id = os.getenv("AGENTA_SERVICES_SANDBOX_SNAPSHOT")

            if not snapshot_id:
                raise RuntimeError(
                    f"No Daytona snapshot configured for runtime '{runtime}'. "
                    f"Set AGENTA_SERVICES_SANDBOX_SNAPSHOT_{runtime.upper()} or "
                    f"AGENTA_SERVICES_SANDBOX_SNAPSHOT environment variable."
                )

            from daytona import CreateSandboxFromSnapshotParams

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
            # agenta_host = "https://xxx.ngrok-free.app"
            agenta_credentials = (
                RunningContext.get().credentials
                #
                or ""
            )
            agenta_api_key = (
                agenta_credentials.startswith("ApiKey ")
                and agenta_credentials[7:]
                or ""
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
                )
            )

            return sandbox

        except Exception as e:
            raise RuntimeError(f"Failed to create sandbox from snapshot: {e}")

    def run(
        self,
        code: str,
        app_params: Dict[str, Any],
        inputs: Dict[str, Any],
        output: Union[dict, str],
        correct_answer: Any,
        runtime: Optional[str] = None,
    ) -> Union[float, None]:
        """
        Execute provided code in Daytona sandbox.

        The code must define an `evaluate()` function that takes
        (app_params, inputs, output, correct_answer) and returns a float (0-1).

        Args:
            code: The code to be executed
            app_params: The parameters of the app variant
            inputs: Inputs to be used during code execution
            output: The output of the app variant after being called
            correct_answer: The correct answer (or target) for comparison
            runtime: Runtime environment (python, typescript), None = python

        Returns:
            Float score between 0 and 1, or None if execution fails
        """
        # Normalize runtime: None means python
        runtime = runtime or "python"

        self._initialize_client()
        sandbox: Sandbox = self._create_sandbox(runtime=runtime)

        try:
            # Prepare all parameters as a single dict
            params = {
                "app_params": app_params,
                "inputs": inputs,
                "output": output,
                "correct_answer": correct_answer,
            }
            params_json = json.dumps(params)

            # Select the correct template based on runtime
            if runtime == "typescript":
                template = EVALUATION_CODE_TEMPLATE_TYPESCRIPT
            else:  # default to python
                template = EVALUATION_CODE_TEMPLATE_PYTHON

            # Wrap the user code with the necessary context and evaluation
            wrapped_code = template.format(
                params_json=params_json,
                user_code=code,
            )

            # Log the input parameters for debugging
            # log.debug("Input parameters to evaluation:")
            # print("\n" + "=" * 80)
            # print("INPUT PARAMETERS:")
            # print("=" * 80)
            # print(f"app_params: {app_params}")
            # print(f"inputs: {inputs}")
            # print(f"output: {output}")
            # print(f"correct_answer: {correct_answer}")
            # print("=" * 80 + "\n")

            # Log the generated code for debugging
            # log.debug("Generated code to send to Daytona:")
            # print("=" * 80)
            # print("GENERATED CODE TO SEND TO DAYTONA:")
            # print("=" * 80)
            # code_lines = wrapped_code.split("\n")
            # for i, line in enumerate(code_lines, 1):
            #     log.debug(f"  {i:3d}: {line}")
            #     print(f"  {i:3d}: {line}")
            # print("=" * 80)
            # print(f"Total lines: {len(code_lines)}")
            # print("=" * 80 + "\n")

            # Callback functions to capture output and errors
            stdout_lines = []
            stderr_lines = []

            def on_stdout(line: str) -> None:
                """Capture stdout output."""
                # log.debug(f"[STDOUT] {line}")
                # print(f"[STDOUT] {line}")
                stdout_lines.append(line)

            def on_stderr(line: str) -> None:
                """Capture stderr output."""
                # log.warning(f"[STDERR] {line}")
                # print(f"[STDERR] {line}")
                stderr_lines.append(line)

            def on_error(error: Exception) -> None:
                """Capture errors."""
                log.error(f"[ERROR] {type(error).__name__}: {error}")
                # print(f"[ERROR] {type(error).__name__}: {error}")

            # Execute the code in the Daytona sandbox
            # log.debug("Executing code in Daytona sandbox")
            response = sandbox.code_interpreter.run_code(
                wrapped_code,
                on_stdout=on_stdout,
                on_stderr=on_stderr,
                on_error=on_error,
            )

            # log.debug(f"Raw response: {response}")
            # print(f"Raw response: {response}")

            # Parse the result from the response object
            # Response has stdout, stderr, and error fields
            response_stdout = response.stdout if hasattr(response, "stdout") else ""
            response_error = response.error if hasattr(response, "error") else None

            sandbox.delete()

            if response_error:
                log.error(f"Sandbox execution error: {response_error}")
                raise RuntimeError(f"Sandbox execution failed: {response_error}")

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

            raise ValueError("Could not parse evaluation result from Daytona output")

        except Exception as e:
            log.error(f"Error during Daytona code execution: {e}", exc_info=True)
            # print(f"Exception details: {type(e).__name__}: {e}")
            raise RuntimeError(f"Error during Daytona code execution: {e}")

    def cleanup(self) -> None:
        """Clean up Daytona client resources."""
        try:
            self.daytona = None
        except Exception as e:
            # Log but don't raise on cleanup failures
            log.error(f"Warning: Failed to cleanup Daytona resources", exc_info=True)

    def __del__(self):
        """Ensure cleanup on deletion."""
        try:
            self.cleanup()
        except Exception:
            pass
