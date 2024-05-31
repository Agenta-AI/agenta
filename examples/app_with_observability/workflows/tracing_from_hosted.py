import os
import requests
import agenta as ag


API_URL = "https://xxxxxxx.xxx"
llm_config = {"environment": "production"}

ag.init(
    app_id="xxxxxxxx",
    host="https://cloud.agenta.ai",
    api_key="xxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
)


def hosted_platform_call(content: str):
    ag.tracing.start_span(
        name="gpt3.5-llm-call",
        spankind="llm",
        input={"content": content},
    )
    response = requests.post(
        url=API_URL,
        json={
            "inputs": [{"role": "user", "content": content}],
            "environment": llm_config["environment"],
        },
    )
    ag.tracing.end_span(outputs=response.json())
    return response.json()


def query(content: str):
    ag.tracing.start_span(
        name="query",
        input={"content": content},
        spankind="workflow",
        config=llm_config,
    )
    response = hosted_platform_call(content=content)
    ag.tracing.end_span(outputs=response)
    return response


if __name__ == "__main__":
    result = query(
        content="How is a vector database used when building LLM applications?"
    )
    print("\n\n============== Result ============== \n\n", result["message"])
