from typing import List, Dict, Any

import pytest
from pydantic import BaseModel


class Prompt(BaseModel):
    temperature: float
    model: str
    max_tokens: int
    messages: List[Dict[str, Any]]
    top_p: float
    frequency_penalty: float
    presence_penalty: float


class Parameters(BaseModel):
    temperature: float
    model: str
    max_tokens: int


@pytest.fixture
def prompt():
    # Sample Prompt object to use in tests
    return Prompt(
        temperature=0.6,
        model="gpt-3.5-turbo",
        max_tokens=150,
        messages=[
            {
                "role": "system",
                "content": "You are an assistant that provides concise answers",
            },
            {"role": "user", "content": "Explain {topic} in simple terms"},
        ],
        top_p=1.0,
        frequency_penalty=0.0,
        presence_penalty=0.0,
    )
