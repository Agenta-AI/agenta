# tests/test_app.py
from fastapi.testclient import TestClient
from api.main import app
import mongomock
import pytest
from api.db import connect_to_db
from api.models.model import LLMCall

client = TestClient(app)


def test_create_chat_completion():
    request_data = {
        "model": "text-davinci-002",
        "messages": [
            {"role": "system", "content": "You are an AI trained to help users."},
            {"role": "user", "content": "What's the weather like today?"}
        ]
    }
    response = client.post("/v1/chat/completions", json=request_data)

    assert response.status_code == 200
    assert "id" in response.json()

    # Check if the LLMCall object was saved to the database
    assert LLMCall.objects.count() == 1
    llm_call = LLMCall.objects.first()

    assert llm_call.prompt == request_data["messages"]
    assert llm_call.output == response.json()
    assert llm_call.parameters["model"] == request_data["model"]

# Add more test cases here
