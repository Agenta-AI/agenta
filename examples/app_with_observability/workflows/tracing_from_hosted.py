import os
import requests
import agenta as ag


os.environ["AGENTA_LLM_RUN_ENVIRONMENT"] = "cloud"
API_URL = "https://xxxxxxx.xxx"


tracing = ag.Tracing(
    app_id="xxxxxxxx",
    host="https://cloud.agenta.ai",
    api_key="xxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
)


def hosted_platform_call(content: str):
    span = tracing.start_span(
        name="gpt3.5-llm-call",
        spankind="llm",
        input={"content": content},
    )
    response = requests.post(
        url=API_URL,
        json={
            "inputs": [{"role": "user", "content": content}],
            "environment": "production",
        },
    )
    tracing.end_span(outputs=response.json(), span=span)
    return response.json()


def query(content: str):
    tracing.start_parent_span(
        name="query",
        inputs={"content": content},
        environment=os.environ.get("AGENTA_LLM_RUN_PLAYGROUND"),
    )
    response = hosted_platform_call(content=content)
    tracing.end_recording(outputs=response, span=tracing.active_trace)
    return response


if __name__ == "__main__":
    result = query(
        content="How is a vector database used when building LLM applications?"
    )
    print("\n\n============== Result ============== \n\n", result["message"])
