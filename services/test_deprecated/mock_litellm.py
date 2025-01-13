import pytest
from typing import List, Optional, Dict, Any
from dataclasses import dataclass


@dataclass
class Message:
    role: str
    content: str
    tool_calls: Optional[List[Dict[str, Any]]] = None


@dataclass
class Choice:
    message: Message
    index: int = 0
    finish_reason: str = "stop"


@dataclass
class Response:
    choices: List[Choice]
    model: str = "gpt-4"
    id: str = "mock-response-id"


class MockLiteLLM:
    """Mock LiteLLM for testing"""

    async def acompletion(self, **kwargs):
        """Mock async completion"""
        model = kwargs.get("model", "gpt-4")
        messages = kwargs.get("messages", [])
        tools = kwargs.get("tools", [])
        response_format = kwargs.get("response_format", None)

        # Simulate different response types based on input
        if tools:
            # Function calling response
            tool_calls = [
                {
                    "id": "call_123",
                    "type": "function",
                    "function": {
                        "name": "get_weather",
                        "arguments": '{"location": "London", "unit": "celsius"}',
                    },
                }
            ]
            message = Message(role="assistant", content=None, tool_calls=tool_calls)
        elif response_format and response_format["type"] == "json_object":
            # JSON response
            message = Message(
                role="assistant", content='{"colors": ["red", "blue", "green"]}'
            )
        else:
            # Regular text response
            message = Message(role="assistant", content="This is a mock response")

        return Response(choices=[Choice(message=message)], model=model)


@pytest.fixture
def mock_litellm():
    """Fixture to provide mock LiteLLM instance"""
    return MockLiteLLM()
