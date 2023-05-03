import httpx
from api.models.model import LLMCall

base_url = "http://localhost:8000"


def test_create_chat_completion():
    original_count = LLMCall.objects.count()
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
    new_count = LLMCall.objects.count()
    assert new_count == original_count + 1
    llm_call = LLMCall.objects.order_by('-id').first()

    # Convert the list of dictionaries to a list of lists
    converted_llm_call_prompt = [dict(d) for d in llm_call.prompt]
    assert converted_llm_call_prompt == request_data["messages"]

    assert llm_call.output == response.json()
