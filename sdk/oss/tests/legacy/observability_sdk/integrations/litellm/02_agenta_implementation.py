import litellm
import agenta as ag

# os.environ["OTEL_EXPORTER"]="otlp_http"
# os.environ["OTEL_ENDPOINT"]="http://localhost/api/observability/v1/otlp/traces"
# AGENTA_APP_ID="0192b441-ab58-7af3-91d0-2f1818690828"
# AGENTA_API_KEY="xxx"
# os.environ["OTEL_HEADERS"]=f"AG-APP-ID={AGENTA_APP_ID}"
from tmphandler import litellm_handler

ag.init()


@ag.instrument()
async def agenerate_completion():
    litellm.callbacks = [ag.callbacks.litellm_handler()]

    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Write a short story about AI Engineering."},
    ]
    temperature = 0.2
    max_tokens = 100
    chat_completion = await litellm.acompletion(
        model="gpt-3.5-turbo",
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return chat_completion


@ag.instrument()
def generate_completion():
    litellm.callbacks = [litellm_handler()]

    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Write a short story about AI Engineering."},
    ]
    temperature = 0.2
    max_tokens = 100
    chat_completion = litellm.completion(
        model="gpt-3.5-turbo",
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return chat_completion


if __name__ == "__main__":
    # asyncio.run(agenerate_completion())
    generate_completion()
