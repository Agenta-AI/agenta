import os
import json
from typing import Any, Dict, Union, Optional

from daytona import Daytona, DaytonaConfig

from agenta.sdk.workflows.runners.base import CodeRunner


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
        self.sandbox = None
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
        """Lazily initialize Daytona client and sandbox on first use."""
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

            # Try to reuse existing sandbox via AGENTA_SERVICES_SANDBOX_SNAPSHOT_PYTHON
            snapshot_id = os.getenv("AGENTA_SERVICES_SANDBOX_SNAPSHOT_PYTHON")

            if not snapshot_id:
                raise RuntimeError(
                    "AGENTA_SERVICES_SANDBOX_SNAPSHOT_PYTHON environment variable is required. "
                    "Set it to the Daytona sandbox ID or snapshot name you want to use."
                )

            # Create sandbox from snapshot ID
            try:
                from daytona import CreateSandboxFromSnapshotParams

                self.sandbox = self.daytona.create(
                    CreateSandboxFromSnapshotParams(
                        snapshot=snapshot_id,
                        ephemeral=True,
                    )
                )
            except Exception as e:
                raise RuntimeError(f"Failed to create sandbox from snapshot: {e}")
        except RuntimeError:
            # Re-raise RuntimeError as-is (already formatted)
            raise
        except Exception as e:
            raise RuntimeError(f"Failed to initialize Daytona: {e}")

    def run(
        self,
        code: str,
        app_params: Dict[str, Any],
        inputs: Dict[str, Any],
        output: Union[dict, str],
        correct_answer: Any,
    ) -> Union[float, None]:
        """
        Execute provided Python code in Daytona sandbox.

        The code must define an `evaluate()` function that takes
        (app_params, inputs, output, correct_answer) and returns a float (0-1).

        Args:
            code: The Python code to be executed
            app_params: The parameters of the app variant
            inputs: Inputs to be used during code execution
            output: The output of the app variant after being called
            correct_answer: The correct answer (or target) for comparison

        Returns:
            Float score between 0 and 1, or None if execution fails
        """
        self._initialize_client()

        try:
            # Prepare the evaluation parameters as JSON strings
            app_params_json = json.dumps(app_params)
            inputs_json = json.dumps(inputs)
            output_json = json.dumps(
                output if isinstance(output, dict) else {"value": output}
            )
            correct_answer_json = json.dumps(correct_answer)

            # Wrap the user code with the necessary context and evaluation
            wrapped_code = f"""
import json

# Parse input parameters
app_params = json.loads({repr(app_params_json)})
inputs = json.loads({repr(inputs_json)})
output = json.loads({repr(output_json)})
correct_answer = json.loads({repr(correct_answer_json)})

# User-provided evaluation code
{code}

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

            # Execute the code in the Daytona sandbox
            response = self.sandbox.code_interpreter.run_code(wrapped_code)

            # Parse the result from the output
            output_lines = str(response).strip().split("\n")
            for line in reversed(output_lines):
                try:
                    result_obj = json.loads(line)
                    if "result" in result_obj:
                        result = result_obj["result"]
                        if isinstance(result, (float, int, type(None))):
                            return float(result) if result is not None else None
                except json.JSONDecodeError:
                    continue

            raise ValueError("Could not parse evaluation result from Daytona output")

        except Exception as e:
            raise RuntimeError(f"Error during Daytona code execution: {e}")

    def cleanup(self) -> None:
        """Clean up Daytona client resources."""
        try:
            self.daytona = None
            self.sandbox = None
        except Exception as e:
            # Log but don't raise on cleanup failures
            print(f"Warning: Failed to cleanup Daytona resources: {e}")

    def __del__(self):
        """Ensure cleanup on deletion."""
        try:
            self.cleanup()
        except Exception:
            pass
