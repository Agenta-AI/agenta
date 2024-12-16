import pytest
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from typing import Dict, List
from pydantic import ValidationError

sys.path.append(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "completion-new-sdk-prompt"))
from _app import (
    PromptTemplate,
    ModelConfig,
    Message,
    InputValidationError,
    TemplateFormatError,
    ResponseFormat
)
from .mock_litellm import MockLiteLLM

# Test Data
BASIC_MESSAGES = [
    Message(role="system", content="You are a {type} assistant"),
    Message(role="user", content="Help me with {task}")
]

TOOL_MESSAGES = [
    Message(role="system", content="You are a function calling assistant"),
    Message(role="user", content="Get the weather for {location}")
]

WEATHER_TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the current weather",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string"},
                "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}
            },
            "required": ["location"]
        }
    }
}

class TestPromptTemplateBasics:
    """Test basic functionality of PromptTemplate"""
    
    def test_create_template(self):
        """Test creating a basic template"""
        template = PromptTemplate(messages=BASIC_MESSAGES)
        assert len(template.messages) == 2
        assert template.messages[0].role == "system"
        assert template.messages[1].role == "user"

    def test_create_template_with_model_config(self):
        """Test creating template with custom model config"""
        model_config = ModelConfig(
            model="gpt-4",
            temperature=0.7,
            max_tokens=100
        )
        template = PromptTemplate(
            messages=BASIC_MESSAGES,
            model_config=model_config
        )
        assert template.model_config.model == "gpt-4"
        assert template.model_config.temperature == 0.7
        assert template.model_config.max_tokens == 100

    def test_invalid_model_config(self):
        """Test validation errors for invalid model config"""
        with pytest.raises(ValidationError):
            ModelConfig(temperature=3.0)  # temperature > 2.0
        
        with pytest.raises(ValidationError):
            ModelConfig(max_tokens=-2)  # max_tokens < -1

class TestPromptFormatting:
    """Test template formatting functionality"""

    def test_basic_format(self):
        """Test basic formatting with valid inputs"""
        template = PromptTemplate(messages=BASIC_MESSAGES)
        formatted = template.format(type="coding", task="Python")
        assert formatted.messages[0].content == "You are a coding assistant"
        assert formatted.messages[1].content == "Help me with Python"

    def test_format_with_validation(self):
        """Test formatting with input validation"""
        template = PromptTemplate(
            messages=BASIC_MESSAGES,
            input_keys=["type", "task"]
        )
        # Valid inputs
        formatted = template.format(type="coding", task="Python")
        assert formatted.messages[0].content == "You are a coding assistant"

        # Missing input
        with pytest.raises(InputValidationError) as exc:
            template.format(type="coding")
        assert "Missing required inputs: task" in str(exc.value)

        # Extra input
        with pytest.raises(InputValidationError) as exc:
            template.format(type="coding", task="Python", extra="value")
        assert "Unexpected inputs: extra" in str(exc.value)

    @pytest.mark.parametrize("template_format,template_string,inputs,expected", [
        ("fstring", "Hello {name}", {"name": "World"}, "Hello World"),
        ("jinja2", "Hello {{ name }}", {"name": "World"}, "Hello World"),
        ("curly", "Hello {{name}}", {"name": "World"}, "Hello World"),
    ])
    def test_format_types(self, template_format, template_string, inputs, expected):
        """Test different format types"""
        template = PromptTemplate(
            messages=[Message(role="user", content=template_string)],
            template_format=template_format
        )
        formatted = template.format(**inputs)
        assert formatted.messages[0].content == expected

    def test_format_errors(self):
        """Test formatting error cases"""
        template = PromptTemplate(messages=BASIC_MESSAGES)
        
        # Missing variable
        with pytest.raises(TemplateFormatError) as exc:
            template.format(type="coding")  # missing 'task'
        assert "Missing required variable" in str(exc.value)

        # Invalid template
        bad_template = PromptTemplate(
            messages=[Message(role="user", content="Hello {")]
        )
        with pytest.raises(TemplateFormatError):
            bad_template.format(name="World")

class TestOpenAIIntegration:
    """Test OpenAI/LiteLLM integration features"""

    def test_basic_openai_kwargs(self):
        """Test basic OpenAI kwargs generation"""
        template = PromptTemplate(
            messages=BASIC_MESSAGES,
            model_config=ModelConfig(
                model="gpt-4",
                temperature=0.7,
                max_tokens=100
            )
        )
        kwargs = template.to_openai_kwargs()
        assert kwargs["model"] == "gpt-4"
        assert kwargs["temperature"] == 0.7
        assert kwargs["max_tokens"] == 100
        assert len(kwargs["messages"]) == 2

    def test_tools_openai_kwargs(self):
        """Test OpenAI kwargs with tools"""
        template = PromptTemplate(
            messages=TOOL_MESSAGES,
            model_config=ModelConfig(
                model="gpt-4",
                tools=[WEATHER_TOOL],
                tool_choice="auto"
            )
        )
        kwargs = template.to_openai_kwargs()
        assert len(kwargs["tools"]) == 1
        assert kwargs["tools"][0]["type"] == "function"
        assert kwargs["tool_choice"] == "auto"

    def test_json_mode_openai_kwargs(self):
        """Test OpenAI kwargs with JSON mode"""
        template = PromptTemplate(
            messages=BASIC_MESSAGES,
            model_config=ModelConfig(
                model="gpt-4",
                response_format=ResponseFormat(type="json_object")
            )
        )
        kwargs = template.to_openai_kwargs()
        assert kwargs["response_format"]["type"] == "json_object"

    def test_optional_params_openai_kwargs(self):
        """Test that optional params are only included when non-default"""
        template = PromptTemplate(
            messages=BASIC_MESSAGES,
            model_config=ModelConfig(
                model="gpt-4",
                frequency_penalty=0.0,  # default value
                presence_penalty=0.5    # non-default value
            )
        )
        kwargs = template.to_openai_kwargs()
        assert "frequency_penalty" not in kwargs
        assert kwargs["presence_penalty"] == 0.5

class TestEndToEndScenarios:
    """Test end-to-end scenarios"""

    @pytest.mark.asyncio
    async def test_chat_completion(self, mock_litellm):
        """Test chat completion with basic prompt"""
        template = PromptTemplate(
            messages=[
                Message(role="user", content="Say hello to {name}")
            ],
            model_config=ModelConfig(model="gpt-3.5-turbo")
        )
        formatted = template.format(name="World")
        kwargs = formatted.to_openai_kwargs()
        
        response = await mock_litellm.acompletion(**kwargs)
        assert response.choices[0].message.content is not None

    @pytest.mark.asyncio
    async def test_function_calling(self, mock_litellm):
        """Test function calling scenario"""
        template = PromptTemplate(
            messages=TOOL_MESSAGES,
            model_config=ModelConfig(
                model="gpt-4",
                tools=[WEATHER_TOOL],
                tool_choice="auto"
            )
        )
        formatted = template.format(location="London")
        kwargs = formatted.to_openai_kwargs()
        
        response = await mock_litellm.acompletion(**kwargs)
        assert response.choices[0].message.tool_calls is not None

    @pytest.mark.asyncio
    async def test_json_mode(self, mock_litellm):
        """Test JSON mode response"""
        template = PromptTemplate(
            messages=[
                Message(role="user", content="List 3 colors in JSON")
            ],
            model_config=ModelConfig(
                model="gpt-4",
                response_format=ResponseFormat(type="json_object")
            )
        )
        kwargs = template.to_openai_kwargs()
        
        response = await mock_litellm.acompletion(**kwargs)
        assert response.choices[0].message.content.startswith("{")
        assert response.choices[0].message.content.endswith("}")
