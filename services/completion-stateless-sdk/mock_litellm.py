from typing import Dict, Any, List
from dataclasses import dataclass

@dataclass
class MockUsage:
    prompt_tokens: int = 10
    completion_tokens: int = 20
    total_tokens: int = 30

    def dict(self):
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens
        }

@dataclass
class MockMessage:
    content: str = "This is a mock response from the LLM."

@dataclass
class MockChoice:
    message: MockMessage = MockMessage()

@dataclass
class MockCompletion:
    choices: List[MockChoice] = None
    usage: MockUsage = None
    
    def __init__(self):
        self.choices = [MockChoice()]
        self.usage = MockUsage()

class MockLiteLLM:
    async def acompletion(self, model: str, messages: List[Dict[str, Any]], temperature: float, max_tokens: int = None, **kwargs) -> MockCompletion:
        return MockCompletion()

    class cost_calculator:
        @staticmethod
        def completion_cost(completion_response, model):
            return 0.0001  # Mock cost
