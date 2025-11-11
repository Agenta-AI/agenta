"""
Unit tests for PromptTemplate class template formatting functionality.

This module tests the _format_with_template method in the PromptTemplate class
from agenta.sdk.types. The PromptTemplate is a core SDK type used for managing
LLM prompts with variable substitution.

Test Coverage:
--------------
✅ Curly format basic replacement
✅ Multiple variable replacement
✅ Missing variables raise TemplateFormatError
✅ User input containing {{}} is preserved (AGE-2946 fix)
✅ Self-referential values work ({{x}} = "{{x}}")
✅ Cross-referential values (single-pass replacement)
✅ Backslash sequences are preserved
✅ Regex metacharacters in variable names
✅ Complete format() method workflow
✅ Input validation with input_keys
✅ Message content formatting
✅ F-string format basic tests
✅ Jinja2 format basic tests

Why These Tests Matter:
-----------------------
The PromptTemplate class is used by SDK users to create reusable prompt
templates. These edge cases were discovered through production bugs:

1. LLM responses with backslash sequences caused regex errors
2. Users couldn't ask questions about template syntax (AGE-2946)
3. Variable names with special characters failed to match
4. Self-referential values caused false positive errors

The tests ensure SDK users have a robust template system.

Test Architecture:
------------------
Tests are organized into classes by functionality:
- TestPromptTemplateFormatWithTemplate: Core formatting logic
- TestPromptTemplateFormat: Complete format() method workflow
- TestPromptTemplateEdgeCases: Special scenarios and edge cases
"""

import pytest
from agenta.sdk.types import (
    PromptTemplate,
    Message,
    TemplateFormatError,
    InputValidationError,
)


class TestPromptTemplateFormatWithTemplate:
    """Tests for the _format_with_template method (curly format)."""

    def setup_method(self):
        """Set up test fixtures."""
        self.template = PromptTemplate(
            messages=[Message(role="user", content="{{input}}")],
            template_format="curly",
        )

    def test_simple_variable_replacement(self):
        """Single variable is replaced correctly."""
        result = self.template._format_with_template("Hello {{name}}!", {"name": "Alice"})
        assert result == "Hello Alice!"

    def test_multiple_variable_replacement(self):
        """Multiple variables are replaced correctly."""
        result = self.template._format_with_template(
            "{{greeting}} {{name}}, you are {{age}} years old",
            {"greeting": "Hi", "name": "Bob", "age": "30"},
        )
        assert result == "Hi Bob, you are 30 years old"

    def test_missing_variable_raises_template_error(self):
        """Missing template variable raises TemplateFormatError."""
        with pytest.raises(TemplateFormatError, match="Unreplaced variables"):
            self.template._format_with_template(
                "Hello {{name}}, age {{age}}", {"name": "Charlie"}
            )

    def test_user_input_with_curly_braces(self):
        """User input containing {{}} is preserved (AGE-2946 fix)."""
        result = self.template._format_with_template(
            "Answer: {{question}}",
            {"question": "What does {{variable}} mean?"},
        )
        assert result == "Answer: What does {{variable}} mean?"
        assert "{{variable}}" in result

    def test_self_referential_value(self):
        """Self-referential value works ({{x}} = '{{x}}')."""
        result = self.template._format_with_template("Value: {{x}}", {"x": "{{x}}"})
        assert result == "Value: {{x}}"

    def test_cross_referential_values(self):
        """Cross-referential values handled by single-pass replacement."""
        result = self.template._format_with_template(
            "{{a}} and {{b}}", {"a": "{{b}}", "b": "{{a}}"}
        )
        assert result == "{{b}} and {{a}}"

    def test_user_discussing_template_variable_name(self):
        """User input can contain same variable name as template."""
        result = self.template._format_with_template(
            "User {{name}} said: {{message}}",
            {"name": "Alice", "message": "I use {{name}} in my templates"},
        )
        assert result == "User Alice said: I use {{name}} in my templates"

    def test_backslash_sequences_preserved(self):
        """Backslash sequences in values are preserved."""
        result = self.template._format_with_template(
            "Path: {{path}}", {"path": "C:\\Users\\Documents"}
        )
        assert result == "Path: C:\\Users\\Documents"

    def test_hex_escape_sequences(self):
        """Hex escape sequences are preserved (original bug)."""
        result = self.template._format_with_template(
            "Color: {{color}}", {"color": "\\x1b[31mRed\\x1b[0m"}
        )
        assert result == "Color: \\x1b[31mRed\\x1b[0m"

    def test_newline_tab_sequences(self):
        """Newline and tab sequences are preserved."""
        result = self.template._format_with_template(
            "Text: {{text}}", {"text": "Line1\\nLine2\\tTabbed"}
        )
        assert result == "Text: Line1\\nLine2\\tTabbed"

    def test_regex_metacharacters_in_variable_name(self):
        """Variable names with regex special characters work."""
        result = self.template._format_with_template(
            "Value: {{my.var}}", {"my.var": "test"}
        )
        assert result == "Value: test"

    def test_variable_with_brackets(self):
        """Variable names with brackets work."""
        result = self.template._format_with_template(
            "First: {{data[0]}}", {"data[0]": "first"}
        )
        assert result == "First: first"

    def test_variable_with_special_chars(self):
        """Variable names with various special characters work."""
        result = self.template._format_with_template(
            "Price: {{price$}}", {"price$": "99.99"}
        )
        assert result == "Price: 99.99"

    def test_empty_template(self):
        """Template with no variables works."""
        result = self.template._format_with_template("Just plain text", {})
        assert result == "Just plain text"

    def test_extra_inputs_ignored(self):
        """Extra inputs that aren't in template are ignored."""
        result = self.template._format_with_template(
            "Hello {{name}}",
            {"name": "Alice", "age": "25", "city": "NYC"},
        )
        assert result == "Hello Alice"

    def test_same_variable_multiple_times(self):
        """Same variable used multiple times is replaced consistently."""
        result = self.template._format_with_template(
            "{{name}} and {{name}} and {{name}}", {"name": "Bob"}
        )
        assert result == "Bob and Bob and Bob"

    def test_unc_path_double_backslash(self):
        """UNC paths with double backslashes work."""
        result = self.template._format_with_template(
            "Server: {{server}}", {"server": "\\\\Server\\Share"}
        )
        assert result == "Server: \\\\Server\\Share"

    def test_json_with_escapes(self):
        """JSON strings with escape sequences work."""
        json_str = '{"message": "Hello\\nWorld", "code": "\\t\\tindented"}'
        result = self.template._format_with_template("JSON: {{json}}", {"json": json_str})
        assert result == f"JSON: {json_str}"


class TestPromptTemplateFormat:
    """Tests for the complete format() method workflow."""

    def test_format_simple_message(self):
        """Basic format() workflow with single message."""
        template = PromptTemplate(
            messages=[Message(role="user", content="Hello {{name}}!")],
            template_format="curly",
        )

        formatted = template.format(name="Alice")

        assert len(formatted.messages) == 1
        assert formatted.messages[0].content == "Hello Alice!"
        assert formatted.messages[0].role == "user"

    def test_format_multiple_messages(self):
        """Format() works with multiple messages."""
        template = PromptTemplate(
            messages=[
                Message(role="system", content="You are {{role}}"),
                Message(role="user", content="{{question}}"),
            ],
            template_format="curly",
        )

        formatted = template.format(role="helpful assistant", question="What is AI?")

        assert len(formatted.messages) == 2
        assert formatted.messages[0].content == "You are helpful assistant"
        assert formatted.messages[1].content == "What is AI?"

    def test_format_with_input_keys_validation(self):
        """Input validation works when input_keys is set."""
        template = PromptTemplate(
            messages=[Message(role="user", content="{{input}}")],
            template_format="curly",
            input_keys=["input"],
        )

        # Valid input
        formatted = template.format(input="test")
        assert formatted.messages[0].content == "test"

        # Missing input
        with pytest.raises(InputValidationError, match="Missing required inputs"):
            template.format()

        # Extra input
        with pytest.raises(InputValidationError, match="Unexpected inputs"):
            template.format(input="test", extra="value")

    def test_format_without_input_keys_accepts_any(self):
        """Without input_keys set, any inputs are accepted."""
        template = PromptTemplate(
            messages=[Message(role="user", content="{{input}}")],
            template_format="curly",
            # input_keys not set
        )

        # Extra inputs are fine when input_keys is None
        formatted = template.format(input="test", extra="ignored")
        assert formatted.messages[0].content == "test"

    def test_format_preserves_message_attributes(self):
        """Format preserves all message attributes."""
        template = PromptTemplate(
            messages=[
                Message(
                    role="user",
                    content="{{input}}",
                    name="test_user",
                )
            ],
            template_format="curly",
        )

        formatted = template.format(input="hello")
        assert formatted.messages[0].role == "user"
        assert formatted.messages[0].name == "test_user"
        assert formatted.messages[0].content == "hello"

    def test_format_with_user_input_containing_curly_braces(self):
        """Complete format() workflow with user input containing {{}}."""
        template = PromptTemplate(
            messages=[
                Message(role="system", content="You are a helpful assistant"),
                Message(role="user", content="{{question}}"),
            ],
            template_format="curly",
        )

        formatted = template.format(question="How do I use {{variable}} in templates?")

        assert formatted.messages[1].content == "How do I use {{variable}} in templates?"
        assert "{{variable}}" in formatted.messages[1].content

    def test_format_error_includes_message_index(self):
        """Format error includes which message failed."""
        template = PromptTemplate(
            messages=[
                Message(role="system", content="OK"),
                Message(role="user", content="{{missing}}"),
            ],
            template_format="curly",
        )

        with pytest.raises(TemplateFormatError, match="Error in message 1"):
            template.format()


class TestPromptTemplateFStringFormat:
    """Tests for f-string template format."""

    def test_fstring_simple_replacement(self):
        """F-string format works for simple replacement."""
        template = PromptTemplate(
            messages=[Message(role="user", content="Hello {name}!")],
            template_format="fstring",
        )

        formatted = template.format(name="Alice")
        assert formatted.messages[0].content == "Hello Alice!"

    def test_fstring_missing_key_raises_error(self):
        """F-string format raises error for missing keys."""
        template = PromptTemplate(
            messages=[Message(role="user", content="Hello {name}!")],
            template_format="fstring",
        )

        with pytest.raises(TemplateFormatError):
            template.format(other="value")


class TestPromptTemplateJinja2Format:
    """Tests for Jinja2 template format."""

    def test_jinja2_simple_replacement(self):
        """Jinja2 format works for simple replacement."""
        template = PromptTemplate(
            messages=[Message(role="user", content="Hello {{ name }}!")],
            template_format="jinja2",
        )

        formatted = template.format(name="Alice")
        assert formatted.messages[0].content == "Hello Alice!"

    def test_jinja2_with_filter(self):
        """Jinja2 format works with filters."""
        template = PromptTemplate(
            messages=[Message(role="user", content="Hello {{ name|upper }}!")],
            template_format="jinja2",
        )

        formatted = template.format(name="alice")
        assert formatted.messages[0].content == "Hello ALICE!"


class TestPromptTemplateEdgeCases:
    """Edge cases and special scenarios."""

    def test_numeric_values(self):
        """Numeric values are converted to strings."""
        template = PromptTemplate(
            messages=[Message(role="user", content="Age: {{age}}, Score: {{score}}")],
            template_format="curly",
        )

        formatted = template.format(age=25, score=95.5)
        assert formatted.messages[0].content == "Age: 25, Score: 95.5"

    def test_boolean_values(self):
        """Boolean values are converted to strings."""
        template = PromptTemplate(
            messages=[Message(role="user", content="Active: {{active}}")],
            template_format="curly",
        )

        formatted = template.format(active=True)
        assert formatted.messages[0].content == "Active: True"

    def test_none_value(self):
        """None value is converted to string 'None'."""
        template = PromptTemplate(
            messages=[Message(role="user", content="Value: {{val}}")],
            template_format="curly",
        )

        formatted = template.format(val=None)
        assert formatted.messages[0].content == "Value: None"

    def test_multiline_content(self):
        """Multiline message content works correctly."""
        template = PromptTemplate(
            messages=[
                Message(
                    role="system",
                    content="""You are a helpful assistant.
Please answer {{question}}.""",
                )
            ],
            template_format="curly",
        )

        formatted = template.format(question="carefully")
        assert "carefully" in formatted.messages[0].content
        assert "\\n" not in formatted.messages[0].content  # Real newline, not escaped

    def test_empty_message_content(self):
        """Empty message content is handled."""
        template = PromptTemplate(
            messages=[
                Message(role="system", content=None),
                Message(role="user", content="{{input}}"),
            ],
            template_format="curly",
        )

        formatted = template.format(input="test")
        assert formatted.messages[0].content is None
        assert formatted.messages[1].content == "test"

    def test_realistic_llm_prompt_template(self):
        """Realistic LLM prompt template with multiple variables."""
        template = PromptTemplate(
            messages=[
                Message(
                    role="system",
                    content="You are a {{role}}. Be {{tone}} in your responses.",
                ),
                Message(
                    role="user",
                    content="""Context: {{context}}

Question: {{question}}

Please provide a detailed answer.""",
                ),
            ],
            template_format="curly",
            input_keys=["role", "tone", "context", "question"],
        )

        formatted = template.format(
            role="helpful assistant",
            tone="friendly and concise",
            context="The user is learning about Python",
            question="What are decorators?",
        )

        assert "helpful assistant" in formatted.messages[0].content
        assert "friendly and concise" in formatted.messages[0].content
        assert "Python" in formatted.messages[1].content
        assert "decorators" in formatted.messages[1].content
