"""
Utilities for formatting and displaying evaluation results.
Contains helper functions for Rich text formatting and table generation.
"""

import json
from typing import Dict, List, Any, Optional
import asyncio
from uuid import UUID
from dataclasses import dataclass, field

import unicodedata
import re


@dataclass
class EvaluationTestcaseData:
    """
    Data model for a single evaluation testcase.

    Attributes:
        case_id: Unique identifier for the testcase
        inputs: Input data for the testcase
        application_outputs: Outputs from the application under test
        evaluator_outputs: Outputs from evaluators (scores and assertions)
    """

    case_id: str = ""
    inputs: Dict[str, Any] = field(default_factory=dict)
    application_outputs: Dict[str, Any] = field(default_factory=dict)
    evaluator_outputs: Dict[str, Any] = field(default_factory=dict)

    def get_scores(self) -> Dict[str, float]:
        """Extract numeric scores from evaluator outputs."""
        scores = {}
        for key, value in self.evaluator_outputs.items():
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                scores[key] = value
        return scores

    def get_assertions(self) -> Dict[str, Any]:
        """Extract boolean assertions from evaluator outputs."""
        assertions = {}
        for key, value in self.evaluator_outputs.items():
            if isinstance(value, bool):
                assertions[key] = value
            elif isinstance(value, list) and all(isinstance(v, bool) for v in value):
                assertions[key] = value
        return assertions


@dataclass
class EvaluationReport:
    """
    Data model for the complete evaluation report.

    Attributes:
        run_id: Unique identifier for the evaluation run
        cases: List of evaluation case data
        summary: Summary statistics for the evaluation
    """

    run_id: str = ""
    cases: List[EvaluationTestcaseData] = field(default_factory=list)
    summary: Dict[str, Any] = field(default_factory=dict)

    def get_total_cases(self) -> int:
        """Get total number of testcases."""
        return len(self.cases)

    def get_all_evaluator_keys(self) -> set[str]:
        """Get all unique evaluator keys across all cases."""
        all_keys = set()
        for case in self.cases:
            all_keys.update(case.evaluator_outputs.keys())
        return all_keys

    def calculate_averages(self) -> Dict[str, float]:
        """Calculate average scores across all cases."""
        averages = {}
        all_scores = {}

        # Collect all scores
        for case in self.cases:
            case_scores = case.get_scores()
            for key, value in case_scores.items():
                if key not in all_scores:
                    all_scores[key] = []
                all_scores[key].append(value)

        # Calculate averages
        for key, values in all_scores.items():
            if values:
                averages[key] = sum(values) / len(values)

        return averages

    def calculate_assertion_percentage(self) -> float:
        """Calculate overall assertion success percentage."""
        all_assertions = []

        for case in self.cases:
            case_assertions = case.get_assertions()
            for value in case_assertions.values():
                if isinstance(value, bool):
                    all_assertions.append(value)
                elif isinstance(value, list):
                    all_assertions.extend(value)

        if not all_assertions:
            return 0.0

        return (sum(all_assertions) / len(all_assertions)) * 100


# Rich imports for progress tracking
try:
    from rich.progress import track

    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False

    # Use simple iteration when Rich is not available
    def track(iterable, description="Processing..."):
        return iterable


# Try to import Rich for enhanced formatting, fall back to plain text if not available
try:
    from rich.console import Console
    from rich.table import Table
    from rich.text import Text
    from rich import box

    _HAS_RICH = True
except ImportError:
    _HAS_RICH = False

    # Fallback implementations for when Rich is not available
    class Text:
        def __init__(self, text="", style=None):
            self.text = str(text)

        def __str__(self):
            return self.text

        @staticmethod
        def from_markup(text):
            # Remove Rich markup for plain text fallback
            import re

            clean_text = re.sub(r'\[/?\w+(?:\s+\w+="[^"]*")*\]', "", text)
            return Text(clean_text)

    class Table:
        def __init__(self, *args, **kwargs):
            self.rows = []
            self.headers = []

        def add_column(self, header, **kwargs):
            self.headers.append(header)

        def add_row(self, *args):
            self.rows.append([str(arg) for arg in args])

        def add_section(self):
            # Add separator in fallback mode
            pass

    class Console:
        def __init__(self, width=None, **kwargs):
            self.width = width


def smart_format_content(content: Any, max_length: int = 200) -> str:
    """
    Smart content formatting with size awareness and Rich markup support.

    Args:
        content: Content to format (dict, list, str, etc.)
        max_length: Maximum character length before truncation

    Returns:
        Formatted string with optional Rich markup
    """
    if content is None:
        return ""

    if isinstance(content, str):
        if len(content) <= max_length:
            return content
        else:
            return f"{content[: max_length - 3]}..."

    if isinstance(content, (dict, list)):
        try:
            json_str = json.dumps(content, indent=None, separators=(",", ":"))
            if len(json_str) <= max_length:
                return json_str
            else:
                # For large objects, show structure with key-value pairs
                if isinstance(content, dict):
                    items = list(content.items())[:3]
                    item_preview = ", ".join(f'"{k}": "{v}"' for k, v in items)
                    more_indicator = (
                        f" (+{len(content) - len(items)} more)"
                        if len(content) > len(items)
                        else ""
                    )
                    full_preview = f"{{{item_preview}{more_indicator}}}"
                    # Truncate the entire string to fit the column width
                    if len(full_preview) <= max_length:
                        return full_preview
                    else:
                        return f"{full_preview[: max_length - 3]}..."
                else:  # list
                    count = len(content)
                    item_preview = (
                        str(content[0])[:50] + "..."
                        if content and len(str(content[0])) > 50
                        else str(content[0])
                        if content
                        else ""
                    )
                    return (
                        f"[{item_preview}] ({count} items)"
                        if count > 1
                        else f"[{item_preview}]"
                    )
        except (TypeError, ValueError):
            # Fallback for non-serializable objects
            str_repr = str(content)
            return (
                str_repr[: max_length - 3] + "..."
                if len(str_repr) > max_length
                else str_repr
            )

    # For other types
    str_repr = str(content)
    return (
        str_repr[: max_length - 3] + "..." if len(str_repr) > max_length else str_repr
    )


def format_number(value: float, max_precision: int = 3) -> str:
    """
    Format numbers with intelligent precision and comma separators.

    Args:
        value: The numeric value to format
        max_precision: Maximum decimal places to show

    Returns:
        Formatted number string
    """
    if abs(value) >= 1000:
        # Use comma separators for large numbers
        return f"{value:,.{max_precision}f}".rstrip("0").rstrip(".")
    elif abs(value) < 0.001 and value != 0:
        # Use scientific notation for very small numbers
        return f"{value:.{max_precision}e}"
    else:
        # Standard formatting with up to max_precision decimal places
        formatted = f"{value:.{max_precision}f}".rstrip("0").rstrip(".")
        return formatted if formatted else "0"


def format_evaluation_report_rich(
    report_data: List[Dict[str, Any]], console_width: Optional[int] = None
) -> str:
    """Format evaluation results using Rich tables with enhanced styling."""
    if not _HAS_RICH:
        return _format_with_unicode_table(report_data, console_width)

    if not report_data:
        return "No evaluation data available"

    # Create Rich table with responsive design
    table = Table(
        title="Evaluation Results",
        box=box.ROUNDED,
        show_header=True,
        header_style="bold magenta",
        width=console_width,
    )

    # Add columns with responsive widths
    table.add_column("Testcases", style="cyan", width=10)
    table.add_column("Inputs", style="green", width=40, overflow="fold")
    table.add_column("Outputs", style="blue", width=40, overflow="fold")
    table.add_column("Scores", style="yellow", width=40)
    table.add_column("Assertions", style="red", width=10)

    # Collect totals for summary
    total_scores = {}
    total_assertions = []

    for case_data in report_data:
        case_id = case_data.get("case_id", "unknown")
        inputs = case_data.get("inputs", {})
        outputs = case_data.get("application_outputs", {})

        # Format inputs and outputs with Rich Text for better display
        inputs_text = Text.from_markup(smart_format_content(inputs, 400))
        outputs_text = Text.from_markup(smart_format_content(outputs, 500))

        # Format scores (numeric values). One score per line for readability.
        scores_parts = []
        for key, value in case_data.get("evaluator_outputs", {}).items():

            def _maybe_add(k: str, v: Any):
                if isinstance(v, bool):
                    return
                num: Optional[float] = None
                if isinstance(v, (int, float)):
                    num = float(v)
                elif isinstance(v, str):
                    try:
                        num = float(v)
                    except Exception:
                        num = None
                if num is not None:
                    formatted_value = format_number(num)
                    scores_parts.append(f"{k}: {formatted_value}")
                    if k not in total_scores:
                        total_scores[k] = []
                    total_scores[k].append(num)

            if isinstance(value, list):
                for idx, v in enumerate(value):
                    _maybe_add(key, v)
            else:
                _maybe_add(key, value)
        scores_text = Text("\n".join(scores_parts))

        # Format assertions (boolean values) - show each evaluator's result
        assertions_parts = []
        for key, value in case_data.get("evaluator_outputs", {}).items():
            if isinstance(value, bool):
                symbol = "[green]✔[/green]" if value else "[red]✗[/red]"
                assertions_parts.append(symbol)
                total_assertions.append(value)
            elif isinstance(value, list) and all(isinstance(v, bool) for v in value):
                # Handle multiple evaluators with same key name
                for v in value:
                    symbol = "[green]✔[/green]" if v else "[red]✗[/red]"
                    assertions_parts.append(symbol)
                    total_assertions.append(v)
        # Join with spaces to show multiple assertions clearly
        assertions_text = Text.from_markup(
            " ".join(assertions_parts) if assertions_parts else ""
        )

        table.add_row(case_id, inputs_text, outputs_text, scores_text, assertions_text)
        # Add a separator after each data row for readability
        table.add_section()

    # Add a separator line before averages
    table.add_section()

    # Add averages row
    avg_scores_parts = []
    for key, values in total_scores.items():
        avg = sum(values) / len(values) if values else 0
        avg_scores_parts.append(f"{key}: {format_number(avg)}")

    assertion_pct = (
        (sum(total_assertions) / len(total_assertions) * 100) if total_assertions else 0
    )
    assertion_summary = f"{assertion_pct:.1f}%"

    table.add_row(
        "[bold italic]Averages[/bold italic]",
        "",
        "",
        Text("\n".join(avg_scores_parts)),
        Text(assertion_summary),
    )

    # Render the table
    console = Console(width=console_width)
    from io import StringIO

    string_buffer = StringIO()
    console.file = string_buffer
    console.print(table)
    return string_buffer.getvalue()


def _format_with_unicode_table(
    report_data: List[Dict[str, Any]], console_width: Optional[int]
) -> str:
    """Fallback Unicode table formatting (enhanced version)"""
    if not report_data:
        return "No evaluation data available"

    # Enhanced table formatting helpers
    def make_border(widths, left="┏", mid="┳", right="┓", fill="━"):
        return left + mid.join(fill * w for w in widths) + right

    def make_separator(widths, left="├", mid="┼", right="┤", fill="─"):
        return left + mid.join(fill * w for w in widths) + right

    def make_row(values, widths, left="┃", mid="┃", right="┃"):
        formatted = []
        for val, width in zip(values, widths):
            # Handle multi-line content better
            val_str = str(val)
            if "\n" in val_str:
                # Take first line for table display
                val_str = val_str.split("\n")[0]
            formatted.append(f" {val_str:<{width - 2}} ")
        return left + mid.join(formatted) + right

    # Responsive column widths
    if console_width and console_width < 120:
        col_widths = [12, 20, 30, 20, 10]  # Compact
    else:
        col_widths = [15, 30, 40, 25, 12]  # Full width

    # Build enhanced table
    lines = []

    # Header with styling
    lines.append(make_border(col_widths))
    lines.append(
        make_row(
            ["Testcase ID", "Inputs", "Outputs", "Scores", "Assertions"], col_widths
        )
    )
    lines.append(make_border(col_widths, "┡", "╇", "┩", "━"))

    # Data rows with improved formatting
    total_scores = {}
    total_assertions = []

    for case_data in report_data:
        case_id = case_data.get("case_id", "unknown")

        # Smart content formatting
        inputs = case_data.get("inputs", {})
        outputs = case_data.get("application_outputs", {})

        inputs_str = smart_format_content(inputs, col_widths[1] - 4)
        outputs_str = smart_format_content(outputs, col_widths[2] - 4)

        # Format scores with proper number formatting, one per line
        scores_parts = []
        for key, value in case_data.get("evaluator_outputs", {}).items():
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                formatted_value = format_number(value)
                scores_parts.append(f"{key}: {formatted_value}")
                if key not in total_scores:
                    total_scores[key] = []
                total_scores[key].append(value)
        # Preserve line breaks for better readability in plain table
        scores_str = "\n".join(scores_parts)

        # Format assertions with colored symbols (fallback) - show each evaluator's result
        assertions_parts = []
        for key, value in case_data.get("evaluator_outputs", {}).items():
            if isinstance(value, bool):
                assertions_parts.append("✔" if value else "✗")
                total_assertions.append(value)
            elif isinstance(value, list) and all(isinstance(v, bool) for v in value):
                # Handle multiple evaluators with same key name
                for v in value:
                    assertions_parts.append("✔" if v else "✗")
                    total_assertions.append(v)
        # Join with spaces to show multiple assertions clearly
        assertions_str = " ".join(assertions_parts) if assertions_parts else ""

        lines.append(
            make_row(
                [case_id, inputs_str, outputs_str, scores_str, assertions_str],
                col_widths,
            )
        )
        lines.append(make_separator(col_widths))

    # Enhanced summary row
    avg_scores_parts = []
    for key, values in total_scores.items():
        avg = sum(values) / len(values) if values else 0
        avg_scores_parts.append(f"{key}: {format_number(avg)}")
    avg_scores_str = smart_format_content(
        ", ".join(avg_scores_parts), col_widths[3] - 4
    )

    assertion_pct = (
        (sum(total_assertions) / len(total_assertions) * 100) if total_assertions else 0
    )
    assertion_summary = f"{assertion_pct:.1f}%"

    # Add separator line before averages for clarity
    lines.append(make_border(col_widths, "┠", "╂", "┨", "━"))
    lines.append(
        make_row(["Averages", "", "", avg_scores_str, assertion_summary], col_widths)
    )
    lines.append(make_border(col_widths, "└", "┴", "┘", "─"))

    return "\n".join(lines)


# Main function that chooses the best available formatting
def format_evaluation_report(
    report_data: List[Dict[str, Any]], console_width: Optional[int] = None
) -> str:
    """Format evaluation results with best available method"""
    return format_evaluation_report_rich(report_data, console_width)


async def display_evaluation_results(
    eval_data, show_detailed_logs=True, console_width=None
):
    """Enhanced display evaluation results with Rich-like formatting and progress tracking"""
    # Give traces a moment to be stored
    print()
    print("⏳ Waiting for traces to be available...")
    await asyncio.sleep(2)

    print()
    print("📊 Processing evaluation results...")
    print(f"   run_id={eval_data['run'].id}")  # type:ignore

    # Collect data for the report table with progress tracking
    report_data = []
    scenarios_to_process = eval_data["scenarios"]

    # Use Rich progress bar if available, otherwise simple iteration
    if RICH_AVAILABLE:
        scenario_iterator = track(
            scenarios_to_process, description="📋 Processing scenarios"
        )
    else:
        scenario_iterator = scenarios_to_process
        print(f"📋 Processing {len(scenarios_to_process)} scenarios...")

    for i, scenario in enumerate(scenario_iterator):
        if not RICH_AVAILABLE and show_detailed_logs:
            print(
                f"   📄 scenario {i + 1}/{len(scenarios_to_process)}: {scenario['scenario'].id}"
            )  # type:ignore
        elif show_detailed_logs:
            print(f"          scenario_id={scenario['scenario'].id}")  # type:ignore

        case_data = EvaluationTestcaseData().__dict__

        for step_key, result in scenario["results"].items():  # type:ignore
            if result.testcase_id:
                if show_detailed_logs:
                    print(
                        f"                      step_key={str(step_key).ljust(32)}, testcase_id={result.testcase_id}"
                    )
                # Use a more readable case ID
                testcase_short = str(result.testcase_id)[:8]
                case_data["case_id"] = f"{testcase_short}..."

            elif result.trace_id:
                if show_detailed_logs:
                    print(
                        f"                      step_key={str(step_key).ljust(32)},    trace_id={result.trace_id}"
                    )

                # Fetch and process trace data using services module
                try:
                    trace_data = await fetch_trace_data(result.trace_id)
                    if trace_data and "spans" in trace_data:
                        for span_key in trace_data["spans"].keys():
                            step_data = extract_trace_step_data(trace_data, span_key)
                            if step_data:
                                inputs = step_data["inputs"]
                                outputs = step_data["outputs"]
                                trace_type = step_data["trace_type"]
                                trace_evaluator_name = step_data.get("evaluator_name")

                                # Store inputs for report
                                if inputs:
                                    case_data["inputs"] = clean_inputs_for_display(
                                        **(inputs if isinstance(inputs, dict) else {})
                                    )
                                    if show_detailed_logs:
                                        print(
                                            f"                                                                      inputs={inputs}"
                                        )

                                # Determine if this is application or evaluator
                                if outputs:
                                    # Heuristic to classify outputs:
                                    # 1. If outputs is a single string value, it's likely the application output
                                    # 2. If outputs is a dict with keys like 'score', 'myscore', 'success', it's evaluator output
                                    # 3. If we already have application_outputs, everything else is evaluator output

                                    is_application_output = False
                                    if not case_data.get("application_outputs"):
                                        # Check if this looks like a simple application output (single string)
                                        if isinstance(outputs, str):
                                            is_application_output = True
                                        elif (
                                            isinstance(outputs, dict)
                                            and len(outputs) == 0
                                        ):
                                            # Empty dict, skip
                                            is_application_output = False
                                        elif isinstance(outputs, dict):
                                            # If it's a dict with typical evaluator keys, it's an evaluator
                                            evaluator_keys = {
                                                "score",
                                                "myscore",
                                                "success",
                                                "failure",
                                                "passed",
                                                "failed",
                                            }
                                            if any(
                                                key in evaluator_keys
                                                for key in outputs.keys()
                                            ):
                                                is_application_output = False
                                            else:
                                                # Otherwise, it might be application output
                                                is_application_output = True

                                    if is_application_output:
                                        case_data["application_outputs"] = outputs
                                    else:
                                        # This is an evaluator output
                                        # Use the evaluator name from trace data, or fall back to step_key hash
                                        evaluator_name = trace_evaluator_name or (
                                            step_key[:8] if step_key else None
                                        )
                                        process_evaluator_outputs(
                                            case_data,
                                            outputs,
                                            evaluator_name=evaluator_name,
                                        )

                                    if show_detailed_logs:
                                        print(
                                            f"                                                                     outputs={outputs}"
                                        )
                    else:
                        if show_detailed_logs:
                            print(
                                f"                                                                 ⚠️  no_trace_data"
                            )
                except Exception as e:
                    if show_detailed_logs:
                        print(
                            f"                                                                 ❌ trace_fetch_error: {e}"
                        )
            else:
                if show_detailed_logs:
                    print(
                        f"                      step_key={str(step_key).ljust(32)}, ❌ error={result.error}"
                    )

        if case_data["case_id"]:
            report_data.append(case_data)

    # if show_detailed_logs:
    #     print(
    #         f"📈 metrics={json.dumps(eval_data['metrics'].data, indent=4)}"
    #     )  # type:ignore

    # Display the enhanced formatted report table
    print()
    print("📋 Evaluation Report:")
    print(format_evaluation_report(report_data, console_width))

    # Add summary statistics
    if report_data:
        print()
        print(f"✅ Successfully processed {len(report_data)} testcases")

        # Count total evaluators
        all_evaluator_keys = set()
        for case in report_data:
            all_evaluator_keys.update(case.get("evaluator_outputs", {}).keys())

        if all_evaluator_keys:
            print(
                f"🔍 Evaluated with {len(all_evaluator_keys)} metrics: {', '.join(sorted(all_evaluator_keys))}"
            )
    else:
        print("⚠️  No evaluation data found")


from typing import Callable, Dict, Optional, Any

from agenta.sdk.utils.client import authed_api
import asyncio
import json
from typing import Dict, Any, Optional


async def fetch_trace_data(
    trace_id: str, max_retries: int = 3, delay: float = 1.0
) -> Optional[Dict[str, Any]]:
    """
    Fetch trace data from the API with retry logic.

    Args:
        trace_id: The trace ID to fetch
        max_retries: Maximum number of retry attempts
        delay: Delay between retries in seconds

    Returns:
        Trace data dictionary or None if not found
    """
    for attempt in range(max_retries):
        try:
            response = authed_api()(
                method="GET", endpoint=f"/preview/tracing/traces/{trace_id}"
            )
            response.raise_for_status()
            trace_data = response.json()

            # print(trace_data)

            # Get the traces dictionary
            traces = trace_data.get("traces", {})
            if traces:
                # Get the first (and usually only) trace
                for trace_key, trace_content in traces.items():
                    if (
                        trace_content
                        and "spans" in trace_content
                        and trace_content["spans"]
                    ):
                        return trace_content

            # If no data yet, retry on next iteration
            if attempt < max_retries - 1:
                await asyncio.sleep(delay)

        except Exception as e:
            if attempt < max_retries - 1:
                await asyncio.sleep(delay)
                continue
            else:
                print(f"Error fetching trace data: {e}")
                return None

    print("Failed to fetch trace data after retries")
    return None


def extract_trace_step_data(
    trace_data: Dict[str, Any], step_key: str
) -> Optional[Dict[str, Any]]:
    """
    Extract step data from trace information.

    Args:
        trace_data: The complete trace data
        step_key: The step key to extract data for

    Returns:
        Step data dictionary or None if not found
    """
    if not trace_data:
        return None

    spans = trace_data.get("spans", {})
    if not spans or step_key not in spans:
        return None

    span_info = spans[step_key]
    # Extract the actual evaluation data using the correct data structure
    ag_data = span_info.get("attributes", {}).get("ag", {}).get("data", {})

    if not ag_data:
        return None

    # Try to extract evaluator/application name from span
    # The span_name field contains the workflow/evaluator name
    evaluator_name = span_info.get("span_name") or span_info.get("name")

    return {
        "inputs": ag_data.get("inputs", {}),
        "outputs": ag_data.get("outputs", {}),
        "trace_type": span_info.get("trace_type"),
        "evaluator_name": evaluator_name,
        "span_info": span_info,
    }


def process_evaluator_outputs(
    case_data: Dict[str, Any],
    outputs: Dict[str, Any],
    evaluator_name: Optional[str] = None,
) -> None:
    """
    Process evaluator outputs and handle multiple evaluators with same key names.

    Args:
        case_data: The case data to update
        outputs: The evaluator outputs to process
        evaluator_name: Optional evaluator identifier for labeling
    """
    # Handle multiple evaluators with same key names (like 'success', 'score')
    for key, value in outputs.items():
        # Label numeric scores by evaluator to distinguish between multiple evaluators
        display_key = key

        # If we have an evaluator name and this is a numeric value, prefix it
        if (
            evaluator_name
            and isinstance(value, (int, float))
            and not isinstance(value, bool)
        ):
            display_key = f"{evaluator_name}.{key}"

        # Store the value - if the key already exists, convert to list to preserve all values
        if display_key in case_data["evaluator_outputs"]:
            # Create lists for duplicate keys to preserve all values
            existing = case_data["evaluator_outputs"][display_key]
            if not isinstance(existing, list):
                case_data["evaluator_outputs"][display_key] = [existing]
            case_data["evaluator_outputs"][display_key].append(value)
        else:
            case_data["evaluator_outputs"][display_key] = value


def clean_inputs_for_display(**kwargs) -> Dict[str, Any]:
    """
    Clean inputs by removing internal IDs and trace data for cleaner display.

    Args:
        inputs: Raw inputs dictionary

    Returns:
        Cleaned inputs dictionary with only user-facing testcase fields
    """
    inputs = kwargs.get("inputs")
    if inputs:
        # List of keys to exclude from display
        # - Internal IDs (ending with _id)
        # - Testcase internal fields (starting with testcase_)
        # - Trace data (the 'trace' key which contains the full trace structure)
        excluded_keys = {
            "revision",
            "parameters",
            "testcase",
            # "inputs",
            "trace",
            "outputs",
        }

        clean_inputs = {
            k: v
            for k, v in inputs.items()
            if not k.endswith("_id")
            and not k.startswith("testcase_")
            and k not in excluded_keys
        }
        return clean_inputs or inputs
    return inputs
