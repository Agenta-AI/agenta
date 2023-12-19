import httpx


def get_llm_app_output(uri, input):
    try:
        url = f"{uri}/generate"

        # TODO: adjust these hardcoded values in this payload
        payload = {
            "temperature": 1,
            "model": "gpt-3.5-turbo",
            "max_tokens": -1,
            "prompt_system": "You are an expert in geography.",
            "prompt_user": f"What is the capital of {input}?",
            "top_p": 1,
            "inputs": {"country": input},
        }

        with httpx.Client() as client:
            response = client.post(url, json=payload)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        print(f"An HTTP error occurred: {e}")
    except Exception as e:
        print(f"An error occurred: {e}")

    return None
