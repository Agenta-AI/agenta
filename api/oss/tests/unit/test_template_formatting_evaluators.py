"""
Unit tests for _format_with_template function in evaluators service.

This module tests the template formatting logic used in AI critique evaluators
and other evaluator services. The function handles three template formats:
fstring, jinja2, and curly.

Key Difference from v0.py:
--------------------------
This version has a try-catch block that returns the original content on error,
making it more lenient than the v0.py implementation. This is intentional
for backwards compatibility with existing evaluators.

Test Coverage:
--------------
✅ Curly format basic replacement
✅ User input containing {{}} is preserved (AGE-2946 fix)
✅ Self-referential values work ({{x}} = "{{x}}")
✅ Cross-referential values (single-pass replacement)
✅ Backslash sequences are preserved
✅ Regex metacharacters in variable names
✅ Lenient error handling (returns original on error)
✅ F-string format basic tests
✅ Jinja2 format basic tests

Production Context:
-------------------
This function is used in AI critique evaluators where users provide prompt
templates that get formatted with test case data. The lenient error handling
ensures evaluators don't fail completely if template formatting has issues.
"""

import pytest
import sys
from pathlib import Path

# Add the oss/src directory to the path to import the module directly
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from services.evaluators_service import _format_with_template


class TestEvaluatorsFormatWithTemplateCurly:
    """Tests for curly brace template format in evaluators service."""

    def test_simple_variable_replacement(self):
        """Single variable is replaced correctly."""
        content = "Evaluate: {{prediction}}"
        result = _format_with_template(content, "curly", {"prediction": "correct"})
        assert result == "Evaluate: correct"

    def test_multiple_variable_replacement(self):
        """Multiple variables are replaced correctly."""
        content = "Prediction: {{prediction}}, Ground truth: {{ground_truth}}"
        result = _format_with_template(
            content,
            "curly",
            {"prediction": "answer A", "ground_truth": "answer B"},
        )
        assert result == "Prediction: answer A, Ground truth: answer B"

    def test_missing_variable_returns_original(self):
        """Missing variable returns original content (lenient behavior)."""
        content = "Hello {{name}}, age {{age}}"
        # Note: evaluators_service.py returns original content on error
        result = _format_with_template(content, "curly", {"name": "Charlie"})
        # The lenient implementation returns original content
        assert result == content

    def test_user_input_with_curly_braces(self):
        """User input containing {{}} is preserved (AGE-2946 fix)."""
        content = "Question: {{question}}"
        result = _format_with_template(
            content, "curly", {"question": "What does {{variable}} mean?"}
        )
        assert result == "Question: What does {{variable}} mean?"
        assert "{{variable}}" in result

    def test_self_referential_value(self):
        """Self-referential value works ({{x}} = '{{x}}')."""
        content = "Template: {{template}}"
        result = _format_with_template(
            content, "curly", {"template": "{{template}}"}
        )
        assert result == "Template: {{template}}"

    def test_cross_referential_values(self):
        """Cross-referential values handled by single-pass replacement."""
        content = "{{input1}} and {{input2}}"
        result = _format_with_template(
            content, "curly", {"input1": "{{input2}}", "input2": "{{input1}}"}
        )
        assert result == "{{input2}} and {{input1}}"

    def test_llm_response_with_curly_braces(self):
        """LLM response containing template syntax is preserved."""
        content = "Prediction: {{prediction}}"
        llm_response = "The template uses {{variable}} for substitution"
        result = _format_with_template(content, "curly", {"prediction": llm_response})
        assert result == f"Prediction: {llm_response}"
        assert "{{variable}}" in result

    def test_backslash_sequences_preserved(self):
        """Backslash sequences in values are preserved."""
        content = "Path: {{file_path}}"
        result = _format_with_template(
            content, "curly", {"file_path": "C:\\Users\\Documents\\file.txt"}
        )
        assert result == "Path: C:\\Users\\Documents\\file.txt"

    def test_ansi_color_codes(self):
        """ANSI color codes with hex escapes are preserved."""
        content = "Output: {{output}}"
        result = _format_with_template(
            content, "curly", {"output": "\\x1b[31mError\\x1b[0m"}
        )
        assert result == "Output: \\x1b[31mError\\x1b[0m"

    def test_json_escape_sequences(self):
        """JSON strings with escape sequences work."""
        content = "Response: {{json_response}}"
        json_str = '{"message": "Hello\\nWorld", "status": "ok"}'
        result = _format_with_template(content, "curly", {"json_response": json_str})
        assert result == f"Response: {json_str}"

    def test_regex_metacharacters_in_variable_name(self):
        """Variable names with regex special characters work."""
        content = "Score: {{score.value}}"
        result = _format_with_template(content, "curly", {"score.value": "95"})
        assert result == "Score: 95"

    def test_variable_with_brackets(self):
        """Variable names with brackets work."""
        content = "First item: {{items[0]}}"
        result = _format_with_template(content, "curly", {"items[0]": "apple"})
        assert result == "First item: apple"

    def test_empty_template(self):
        """Template with no variables works."""
        content = "Static evaluation prompt"
        result = _format_with_template(content, "curly", {})
        assert result == "Static evaluation prompt"

    def test_extra_inputs_ignored(self):
        """Extra inputs that aren't in template are ignored."""
        content = "Prediction: {{prediction}}"
        result = _format_with_template(
            content,
            "curly",
            {
                "prediction": "correct",
                "ground_truth": "also correct",
                "metadata": "extra",
            },
        )
        assert result == "Prediction: correct"

    def test_same_variable_multiple_times(self):
        """Same variable used multiple times is replaced consistently."""
        content = "Compare {{prediction}} with {{prediction}}"
        result = _format_with_template(content, "curly", {"prediction": "answer"})
        assert result == "Compare answer with answer"

    def test_ai_critique_template_realistic(self):
        """Realistic AI critique evaluator template."""
        content = """Rate the following on a scale of 0-10:
Prediction: {{prediction}}
Ground Truth: {{ground_truth}}
Context: {{context}}"""

        result = _format_with_template(
            content,
            "curly",
            {
                "prediction": "Paris is the capital",
                "ground_truth": "Paris is the capital of France",
                "context": "Geography quiz",
            },
        )

        assert "Paris is the capital" in result
        assert "Geography quiz" in result
        assert "{{" not in result  # All variables should be replaced

    def test_unc_path_double_backslash(self):
        """UNC paths with double backslashes work."""
        content = "Network path: {{network_path}}"
        result = _format_with_template(
            content, "curly", {"network_path": "\\\\Server\\Shared\\file.txt"}
        )
        assert result == "Network path: \\\\Server\\Shared\\file.txt"


class TestEvaluatorsFormatWithTemplateFString:
    """Tests for f-string template format in evaluators service."""

    def test_simple_fstring_replacement(self):
        """F-string format works for simple replacement."""
        content = "Prediction: {prediction}"
        result = _format_with_template(content, "fstring", {"prediction": "correct"})
        assert result == "Prediction: correct"

    def test_fstring_error_returns_original(self):
        """F-string format error returns original content (lenient)."""
        content = "Prediction: {missing_key}"
        # Lenient error handling returns original
        result = _format_with_template(content, "fstring", {"other": "value"})
        assert result == content


class TestEvaluatorsFormatWithTemplateJinja2:
    """Tests for Jinja2 template format in evaluators service."""

    def test_simple_jinja2_replacement(self):
        """Jinja2 format works for simple replacement."""
        content = "Prediction: {{ prediction }}"
        result = _format_with_template(content, "jinja2", {"prediction": "correct"})
        assert result == "Prediction: correct"

    def test_jinja2_with_filter(self):
        """Jinja2 format works with filters."""
        content = "{{ prediction|upper }}"
        result = _format_with_template(content, "jinja2", {"prediction": "correct"})
        assert result == "CORRECT"

    def test_jinja2_error_returns_original(self):
        """Jinja2 template error returns original content."""
        content = "{{ prediction|invalid_filter }}"
        result = _format_with_template(content, "jinja2", {"prediction": "test"})
        # On error, returns original content
        assert result == content


class TestEvaluatorsFormatWithTemplateEdgeCases:
    """Edge cases specific to evaluators service."""

    def test_numeric_score_values(self):
        """Numeric score values are converted to strings."""
        content = "Score: {{score}}"
        result = _format_with_template(content, "curly", {"score": 8.5})
        assert result == "Score: 8.5"

    def test_boolean_flag_values(self):
        """Boolean values are converted to strings."""
        content = "Passed: {{passed}}"
        result = _format_with_template(content, "curly", {"passed": True})
        assert result == "Passed: True"

    def test_none_value_in_evaluation(self):
        """None value is converted to string 'None'."""
        content = "Ground truth: {{ground_truth}}"
        result = _format_with_template(content, "curly", {"ground_truth": None})
        assert result == "Ground truth: None"

    def test_multiline_prompt_template(self):
        """Multiline templates work correctly."""
        content = """Evaluate the prediction:

Prediction: {{prediction}}
Ground Truth: {{ground_truth}}

Rate from 0-10:"""

        result = _format_with_template(
            content,
            "curly",
            {"prediction": "answer A", "ground_truth": "answer B"},
        )

        assert "answer A" in result
        assert "answer B" in result
        assert "{{" not in result

    def test_lenient_behavior_on_exception(self):
        """Any exception returns original content (lenient behavior)."""
        # This is the key difference from v0.py
        # If anything goes wrong, we get back the original content
        content = "Template: {{var}}"

        # Even with completely invalid inputs, we get original back
        result = _format_with_template(content, "curly", {})
        # Missing variable, returns original
        assert result == content
