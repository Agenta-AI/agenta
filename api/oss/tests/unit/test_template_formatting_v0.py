"""
Unit tests for _format_with_template function in core services (v0.py).

This module tests the template formatting logic used in workflow services.
The function handles three template formats: fstring, jinja2, and curly.

Test Coverage:
--------------
✅ Curly format basic replacement
✅ Multiple variable replacement
✅ Missing variables raise ValueError
✅ User input containing {{}} is preserved (AGE-2946 fix)
✅ Self-referential values work ({{x}} = "{{x}}")
✅ Cross-referential values (single-pass replacement)
✅ Backslash sequences are preserved
✅ Regex metacharacters in variable names
✅ Empty templates and inputs
✅ F-string format basic tests
✅ Jinja2 format basic tests

Why These Tests Matter:
-----------------------
These edge cases were discovered through production bugs:
1. LLM responses with backslash sequences caused regex errors
2. Users couldn't ask questions about template syntax (AGE-2946)
3. Variable names with special characters failed to match
4. Self-referential values caused false positive errors

The tests ensure these bugs never resurface.
"""

import pytest
import sys
from pathlib import Path

# Add the oss/src directory to the path to import the module directly
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from core.services.v0 import _format_with_template


class TestFormatWithTemplateCurly:
    """Tests for curly brace template format ({{variable}})."""

    def test_simple_variable_replacement(self):
        """Single variable is replaced correctly."""
        content = "Hello {{name}}!"
        result = _format_with_template(content, "curly", {"name": "Alice"})
        assert result == "Hello Alice!"

    def test_multiple_variable_replacement(self):
        """Multiple variables are replaced correctly."""
        content = "{{greeting}} {{name}}, you are {{age}} years old"
        result = _format_with_template(
            content, "curly", {"greeting": "Hello", "name": "Bob", "age": "25"}
        )
        assert result == "Hello Bob, you are 25 years old"

    def test_missing_variable_raises_error(self):
        """Missing template variable raises ValueError."""
        content = "Hello {{name}}, age {{age}}"

        with pytest.raises(ValueError, match="Template variables not found in inputs: age"):
            _format_with_template(content, "curly", {"name": "Charlie"})

    def test_multiple_missing_variables(self):
        """Multiple missing variables are reported."""
        content = "{{a}} {{b}} {{c}}"

        with pytest.raises(ValueError, match="Template variables not found in inputs"):
            _format_with_template(content, "curly", {"a": "1"})

    def test_user_input_with_curly_braces(self):
        """User input containing {{}} is preserved (AGE-2946 fix)."""
        content = "Answer: {{question}}"
        result = _format_with_template(
            content, "curly", {"question": "What does {{variable}} mean?"}
        )
        assert result == "Answer: What does {{variable}} mean?"
        assert "{{variable}}" in result

    def test_self_referential_value(self):
        """Self-referential value works ({{x}} = '{{x}}')."""
        content = "Value: {{x}}"
        result = _format_with_template(content, "curly", {"x": "{{x}}"})
        assert result == "Value: {{x}}"

    def test_cross_referential_values(self):
        """Cross-referential values handled by single-pass replacement."""
        content = "{{a}} and {{b}}"
        result = _format_with_template(
            content, "curly", {"a": "{{b}}", "b": "{{a}}"}
        )
        assert result == "{{b}} and {{a}}"

    def test_user_discussing_same_variable_name(self):
        """User input can contain same variable name as template."""
        content = "User {{name}} said: {{message}}"
        result = _format_with_template(
            content,
            "curly",
            {"name": "Alice", "message": "I use {{name}} in my templates"},
        )
        assert result == "User Alice said: I use {{name}} in my templates"
        assert result.count("{{name}}") == 1  # Only in the message part

    def test_backslash_sequences_preserved(self):
        """Backslash sequences in values are preserved."""
        content = "Path: {{path}}"
        result = _format_with_template(
            content, "curly", {"path": "C:\\Users\\Documents"}
        )
        assert result == "Path: C:\\Users\\Documents"

    def test_hex_escape_sequences(self):
        """Hex escape sequences are preserved (original bug)."""
        content = "Color: {{color}}"
        result = _format_with_template(
            content, "curly", {"color": "\\x1b[31mRed\\x1b[0m"}
        )
        assert result == "Color: \\x1b[31mRed\\x1b[0m"

    def test_newline_tab_sequences(self):
        """Newline and tab sequences are preserved."""
        content = "Text: {{text}}"
        result = _format_with_template(
            content, "curly", {"text": "Line1\\nLine2\\tTabbed"}
        )
        assert result == "Text: Line1\\nLine2\\tTabbed"

    def test_regex_metacharacters_in_variable_name(self):
        """Variable names with regex special characters work."""
        content = "Value: {{my.var}}"
        result = _format_with_template(content, "curly", {"my.var": "test"})
        assert result == "Value: test"

    def test_variable_with_brackets(self):
        """Variable names with brackets work."""
        content = "First: {{data[0]}}"
        result = _format_with_template(content, "curly", {"data[0]": "first"})
        assert result == "First: first"

    def test_variable_with_dollar_sign(self):
        """Variable names with dollar sign work."""
        content = "Price: {{price$}}"
        result = _format_with_template(content, "curly", {"price$": "99.99"})
        assert result == "Price: 99.99"

    def test_empty_template(self):
        """Template with no variables works."""
        content = "Just plain text"
        result = _format_with_template(content, "curly", {})
        assert result == "Just plain text"

    def test_empty_content(self):
        """Empty content string works."""
        content = ""
        result = _format_with_template(content, "curly", {})
        assert result == ""

    def test_extra_inputs_ignored(self):
        """Extra inputs that aren't in template are ignored."""
        content = "Hello {{name}}"
        result = _format_with_template(
            content, "curly", {"name": "Alice", "age": "25", "city": "NYC"}
        )
        assert result == "Hello Alice"

    def test_same_variable_multiple_times(self):
        """Same variable used multiple times is replaced consistently."""
        content = "{{name}} and {{name}} and {{name}}"
        result = _format_with_template(content, "curly", {"name": "Bob"})
        assert result == "Bob and Bob and Bob"

    def test_adjacent_variables(self):
        """Adjacent variables without spaces work."""
        content = "{{first}}{{second}}"
        result = _format_with_template(
            content, "curly", {"first": "Hello", "second": "World"}
        )
        assert result == "HelloWorld"

    def test_unc_path_with_double_backslash(self):
        """UNC paths with double backslashes work."""
        content = "Server: {{server}}"
        result = _format_with_template(
            content, "curly", {"server": "\\\\Server\\Share"}
        )
        assert result == "Server: \\\\Server\\Share"

    def test_json_with_escapes(self):
        """JSON strings with escape sequences work."""
        content = "JSON: {{json}}"
        result = _format_with_template(
            content,
            "curly",
            {"json": '{"message": "Hello\\nWorld", "code": "\\t\\tindented"}'},
        )
        assert result == 'JSON: {"message": "Hello\\nWorld", "code": "\\t\\tindented"}'


class TestFormatWithTemplateFString:
    """Tests for f-string template format."""

    def test_simple_fstring_replacement(self):
        """F-string format works for simple replacement."""
        content = "Hello {name}!"
        result = _format_with_template(content, "fstring", {"name": "Alice"})
        assert result == "Hello Alice!"

    def test_fstring_missing_key_raises_error(self):
        """F-string format raises KeyError for missing keys."""
        content = "Hello {name}!"

        with pytest.raises(KeyError):
            _format_with_template(content, "fstring", {"other": "value"})


class TestFormatWithTemplateJinja2:
    """Tests for Jinja2 template format."""

    def test_simple_jinja2_replacement(self):
        """Jinja2 format works for simple replacement."""
        content = "Hello {{ name }}!"
        result = _format_with_template(content, "jinja2", {"name": "Alice"})
        assert result == "Hello Alice!"

    def test_jinja2_with_filter(self):
        """Jinja2 format works with filters."""
        content = "Hello {{ name|upper }}!"
        result = _format_with_template(content, "jinja2", {"name": "alice"})
        assert result == "Hello ALICE!"

    def test_jinja2_error_returns_original(self):
        """Jinja2 template error returns original content."""
        content = "Hello {{ name|invalid_filter }}!"
        result = _format_with_template(content, "jinja2", {"name": "Alice"})
        # On error, returns original content
        assert result == content


class TestFormatWithTemplateEdgeCases:
    """Edge cases and special scenarios."""

    def test_whitespace_in_variable_name(self):
        """Variable names are trimmed of whitespace."""
        content = "{{ name }}"  # Jinja2 style with spaces
        # Curly format expects {{name}} without spaces
        # This should not match and remain unreplaced
        with pytest.raises(ValueError):
            _format_with_template(content, "curly", {"name": "Alice"})

    def test_numeric_values(self):
        """Numeric values are converted to strings."""
        content = "Age: {{age}}, Score: {{score}}"
        result = _format_with_template(
            content, "curly", {"age": 25, "score": 95.5}
        )
        assert result == "Age: 25, Score: 95.5"

    def test_boolean_values(self):
        """Boolean values are converted to strings."""
        content = "Active: {{active}}"
        result = _format_with_template(content, "curly", {"active": True})
        assert result == "Active: True"

    def test_none_value(self):
        """None value is converted to string 'None'."""
        content = "Value: {{val}}"
        result = _format_with_template(content, "curly", {"val": None})
        assert result == "Value: None"
