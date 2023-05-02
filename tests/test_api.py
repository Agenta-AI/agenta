import httpx
from api.models.model import LLMCall

base_url = "http://localhost:8000"


def test_create_chat_completion():
    request_data = {
        "model": "gpt-3.5-turbo",
        "messages": [
            {"role": "system",
                "content": "You are an AI trained to help users.", "name": "AI"},
            {"role": "user", "content": "What's the weather like today?", "name": "User"},
        ]
    }
    response = httpx.post(f"{base_url}/v1/chat/completions", json=request_data)

    assert response.status_code == 200
    # Check if the LLMCall object was saved to the database
    assert LLMCall.objects.count() == 1
    llm_call = LLMCall.objects.first()

    assert llm_call.prompt == request_data["messages"]
    assert llm_call.output == response.json()
    assert llm_call.parameters["model"] == request_data["model"]
