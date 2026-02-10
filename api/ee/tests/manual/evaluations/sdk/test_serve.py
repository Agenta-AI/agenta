from typing import Optional
import os

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI  # noqa: E402

os.environ["AGENTA_SERVICE_MIDDLEWARE_AUTH_ENABLED"] = "false"

import agenta as ag  # noqa: E402

ag.init(
    api_url="http://localhost",
    api_key="...",
)


from agenta.sdk.models.workflows import (  # noqa: E402
    WorkflowServiceResponseData,
    WorkflowServiceBatchResponse,
    WorkflowServiceStreamResponse,
)
from agenta.sdk.decorators.routing import (  # noqa: E402
    route,
    default_app,
    create_app,
)
from agenta.sdk.decorators.running import (  # noqa: E402
    WorkflowServiceRequest,
    workflow,
)

from agenta.sdk.workflows import builtin  # noqa: E402


custom_app = create_app()

public_app = FastAPI()

public_app.mount("/services", app=default_app)

app = public_app


@route("/tokens-async", app=default_app)
async def async_gen(request: WorkflowServiceRequest):
    for i in range((request.data.inputs or {}).get("count", 3)):
        yield {"async_token": chr(97 + i)}


"""
curl -i -N \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"prompt": "hello"}}}' \
  http://127.0.0.1:8000/services/tokens-async/invoke
"""

"""
curl -i -N \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"prompt": "hello"}}}' \
  http://127.0.0.1:8000/services/tokens-async/invoke
"""


@route("/tokens-sync", app=default_app)
def sync_tokens(request: WorkflowServiceRequest):
    for i in range((request.data.inputs or {}).get("count", 2)):
        yield {"async_token": chr(120 + i)}


"""
curl -i -N \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"prompt": "hello"}}}' \
  http://127.0.0.1:8000/services/tokens-sync/invoke
"""

"""
curl -i -N \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"prompt": "hello"}}}' \
  http://127.0.0.1:8000/services/tokens-sync/invoke
"""


@route("/tokens-batch", app=default_app)
@workflow(aggregate=True)
def batch_tokens(request: WorkflowServiceRequest):
    for i in range((request.data.inputs or {}).get("count", 2)):
        yield {"token": chr(ord("A") + i)}


"""
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"prompt": "hello"}}}' \
  http://127.0.0.1:8000/services/tokens-batch/invoke
"""


@route("/greet-async", app=default_app)
async def greet(request: WorkflowServiceRequest):
    name = (request.data.inputs or {}).get("name", "world")
    return {"message": f"Hello, {name}!"}


"""
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"name": "Agenta"}}}' \
  http://127.0.0.1:8000/services/greet-async/invoke
"""


@route("/echo-sync", app=default_app)
def echo(request: WorkflowServiceRequest):
    return {"echo": request.data.inputs}


"""
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"aloha": "mahalo"}}}' \
  http://127.0.0.1:8000/services/echo-sync/invoke
"""


@route("/already-batch", app=default_app)
def already_batch(request: WorkflowServiceRequest):
    return WorkflowServiceBatchResponse(
        data=WorkflowServiceResponseData(outputs={"ready": True})
    )


"""
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"aloha": "mahalo"}}}' \
  http://127.0.0.1:8000/services/already-batch/invoke
"""


@route("/already-stream", app=default_app)
def already_stream(request: WorkflowServiceRequest):
    async def iterator():
        yield {"ready": "no"}
        yield {"ready": "go"}

    return WorkflowServiceStreamResponse(generator=iterator)


"""
curl -i -N \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"aloha": "mahalo"}}}' \
  http://127.0.0.1:8000/services/already-stream/invoke
"""


@route("/kwargs", app=default_app)
def kwargs_handler(**kwargs):
    return {"got": sorted(kwargs.keys())}


"""
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"aloha": "mahalo"}}}' \
  http://127.0.0.1:8000/services/kwargs/invoke
"""


@route("/unknown", app=default_app)
def unknown_handler(unknown: str):
    return {"got": unknown}


"""
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"aloha": "mahalo"}}}' \
  http://127.0.0.1:8000/services/unknown/invoke
"""


@route("/echo_custom", app=default_app)
def echo_custom(aloha: str):
    return {"got": aloha}


"""
curl -i http://127.0.0.1:8000/services/echo_custom/inspect
"""

"""
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"aloha": "mahalo"}}}' \
  http://127.0.0.1:8000/services/echo_custom/invoke
"""


echo_manual = workflow(uri="echo")()

route("/echo_manual", app=default_app)(echo_manual)

builtin_echo = builtin.echo()

route("/echo", app=default_app)(builtin_echo)


"""
curl -i http://127.0.0.1:8000/services/echo/inspect
"""

"""
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"inputs": {"aloha": "mahalo"}}}' \
  http://127.0.0.1:8000/services/echo/invoke
"""

route("/auto_exact_match", app=default_app)(builtin.auto_exact_match())


"""
curl -i http://127.0.0.1:8000/services/auto_exact_match/inspect
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":true}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"correct_answer_key": "correct_answer"}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahalo"}}' \
  http://127.0.0.1:8000/services/auto_exact_match/invoke
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":false}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"correct_answer_key": "correct_answer"}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahala"}}' \
  http://127.0.0.1:8000/services/auto_exact_match/invoke
"""

route("/auto_regex_test", app=default_app)(
    builtin.auto_regex_test(
        regex_pattern="^ma.*o$",
    )
)

"""
curl -i http://127.0.0.1:8000/services/auto_regex_test/inspect
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":true}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"regex_pattern": "^ma.*o$"}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahalo"}}' \
  http://127.0.0.1:8000/services/auto_regex_test/invoke
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":false}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"regex_pattern": "^ma.*o$"}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahala"}}' \
  http://127.0.0.1:8000/services/auto_regex_test/invoke
"""

route("/field_match_test", app=default_app)(
    builtin.field_match_test(
        json_field="answer",
    )
)

"""
curl -i http://127.0.0.1:8000/services/field_match_test/inspect
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":true}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"json_field": "answer", "correct_answer_key": "correct_answer"}, "inputs": {"correct_answer": "mahalo"}, "outputs": {"answer": "mahalo"}}}' \
  http://127.0.0.1:8000/services/field_match_test/invoke
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":false}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"json_field": "answer", "correct_answer_key": "correct_answer"}, "inputs": {"correct_answer": "mahalo"}, "outputs": {"answer": "mahala"}}}' \
  http://127.0.0.1:8000/services/field_match_test/invoke
"""


@public_app.post("/my_webhook")
async def my_webhook(
    inputs: Optional[dict] = None,
    output: Optional[str] = None,
    correct_answer: Optional[str] = None,
):
    return {"score": 1 if output == correct_answer else 0}


""" curl on http://127.0.0.1:8000/my_webhook
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"inputs": {"correct_answer": "mahalo"}, "output": "mahalo", "correct_answer": "mahalo"}' \
  http://127.0.0.1:8000/my_webhook
"""

route("/auto_webhook_test", app=default_app)(
    builtin.auto_webhook_test(
        webhook_url="http://127.0.0.1:8000/my_webhook",
    )
)

"""
curl -i http://127.0.0.1:8000/services/auto_webhook_test/inspect
"""


""" {"version":"2025.07.14","data":{"outputs":{"success":true}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"correct_answer_key": "correct_answer", "webhook_url": "http://127.0.0.1:8000/my_webhook"}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahalo"}}' \
  http://127.0.0.1:8000/services/auto_webhook_test/invoke
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":false}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"correct_answer_key": "correct_answer", "webhook_url": "http://127.0.0.1:8000/my_webhook"}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahala"}}' \
  http://127.0.0.1:8000/services/auto_webhook_test/invoke
"""

route("/auto_custom_code_run", app=default_app)(
    builtin.auto_custom_code_run(
        code="evaluate = lambda app_params, inputs, output, correct_answer: 1.0 if output in correct_answer else 0.0",
    )
)

"""
curl -i http://127.0.0.1:8000/services/auto_custom_code_run/inspect
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":true}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"correct_answer_key": "correct_answer", "code": "evaluate = lambda app_params, inputs, output, correct_answer: 1.0 if output in correct_answer else 0.0"}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahalo"}}' \
  http://127.0.0.1:8000/services/auto_custom_code_run/invoke
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":false}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"correct_answer_key": "correct_answer", "code": "evaluate = lambda app_params, inputs, output, correct_answer: 1.0 if output in correct_answer else 0.0"}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahala"}}' \
  http://127.0.0.1:8000/services/auto_custom_code_run/invoke
"""

route("/auto_ai_critique", app=default_app)(
    builtin.auto_ai_critique(
        prompt_template=[
            {
                "role": "system",
                "content": "You are an evaluator grading an LLM App.\nYou will be given INPUTS, the LLM APP OUTPUT, the CORRECT ANSWER used in the LLM APP.\n<grade_criteria>\n- Ensure that the LLM APP OUTPUT has the same meaning as the CORRECT ANSWER\n</grade_criteria>\n\n<score_criteria>\n-The score should be between 0 and 1\n-A score of 1 means that the answer is perfect. This is the highest (best) score.\nA score of 0 means that the answer does not meet any of the criteria. This is the lowest possible score you can give.\n</score_criteria>\n\n<output_format>\nANSWER ONLY THE SCORE. DO NOT USE MARKDOWN. DO NOT PROVIDE ANYTHING OTHER THAN THE NUMBER\n</output_format>",
            },
            {
                "role": "user",
                "content": "<correct_answer>{{correct_answer}}</correct_answer>\n<llm_app_output>{{prediction}}</llm_app_output>",
            },
        ]
    )
)

"""
curl -i http://127.0.0.1:8000/services/auto_ai_critique/inspect
"""

""" {"version":"2025.07.14","data":{"outputs":{"score":1,0,"success":true}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -H "Authorization: ApiKey your_api_key_here" \
  -d '{
    "data": {
      "inputs": {
        "country": "Germany",
        "correct_answer": "Berlin"
      },
      "outputs": "Berlin",
      "parameters": {
        "correct_answer_key": "correct_answer",
        "prompt_template": [
          {
            "role": "system",
            "content": "You are an evaluator grading an LLM App.\nYou will be given INPUTS, the LLM APP OUTPUT, the CORRECT ANSWER used in the LLM APP.\n<grade_criteria>\n- Ensure that the LLM APP OUTPUT has the same meaning as the CORRECT ANSWER\n</grade_criteria>\n\n<score_criteria>\n-The score should be between 0 and 1\n-A score of 1 means that the answer is perfect. This is the highest (best) score.\nA score of 0 means that the answer does not meet any of the criteria. This is the lowest possible score you can give.\n</score_criteria>\n\n<output_format>\nANSWER ONLY THE SCORE. DO NOT USE MARKDOWN. DO NOT PROVIDE ANYTHING OTHER THAN THE NUMBER\n</output_format>"
          },
          {
            "role": "user",
            "content": "<correct_answer>{{correct_answer}}</correct_answer>\n<llm_app_output>{{prediction}}</llm_app_output>"
          }
        ]
      }
    }
  }' \
  http://127.0.0.1:8000/services/auto_ai_critique/invoke
"""

""" {"version":"2025.07.14","data":{"outputs":{"score":0.0,"success":false}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -H "Authorization: ApiKey your_api_key_here" \
  -d '{
    "data": {
      "inputs": {
        "country": "Germany",
        "correct_answer": "Berlin"
      },
      "outputs": "Kyoto",
      "parameters": {
        "correct_answer_key": "correct_answer",
        "prompt_template": [
          {
            "role": "system",
            "content": "You are an evaluator grading an LLM App.\nYou will be given INPUTS, the LLM APP OUTPUT, the CORRECT ANSWER used in the LLM APP.\n<grade_criteria>\n- Ensure that the LLM APP OUTPUT has the same meaning as the CORRECT ANSWER\n</grade_criteria>\n\n<score_criteria>\n-The score should be between 0 and 1\n-A score of 1 means that the answer is perfect. This is the highest (best) score.\nA score of 0 means that the answer does not meet any of the criteria. This is the lowest possible score you can give.\n</score_criteria>\n\n<output_format>\nANSWER ONLY THE SCORE. DO NOT USE MARKDOWN. DO NOT PROVIDE ANYTHING OTHER THAN THE NUMBER\n</output_format>"
          },
          {
            "role": "user",
            "content": "<correct_answer>{{correct_answer}}</correct_answer>\n<llm_app_output>{{prediction}}</llm_app_output>"
          }
        ]
      }
    }
  }' \
  http://127.0.0.1:8000/services/auto_ai_critique/invoke
"""

route("/auto_starts_with", app=default_app)(
    builtin.auto_starts_with(
        prefix="ma",
    )
)

"""
curl -i http://127.0.0.1:8000/services/auto_starts_with/inspect
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":true}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"prefix": "ma"}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahalo"}}' \
  http://127.0.0.1:8000/services/auto_starts_with/invoke
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":false}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"prefix": "ma"}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mohalo"}}' \
  http://127.0.0.1:8000/services/auto_starts_with/invoke
"""

route("/auto_ends_with", app=default_app)(
    builtin.auto_ends_with(
        suffix="lo",
    )
)

"""
curl -i http://127.0.0.1:8000/services/auto_ends_with/inspect
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":true}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"suffix": "lo"}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahalo"}}' \
  http://127.0.0.1:8000/services/auto_ends_with/invoke
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":false}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"suffix": "lo"}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahala"}}' \
  http://127.0.0.1:8000/services/auto_ends_with/invoke
"""

route("/auto_contains", app=default_app)(
    builtin.auto_contains(
        substring="ha",
    )
)

"""
curl -i http://127.0.0.1:8000/services/auto_contains/inspect
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":true}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"substring": "mahalo"}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahalo"}}' \
  http://127.0.0.1:8000/services/auto_contains/invoke
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":false}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"substring": "mahalo"}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahala"}}' \
  http://127.0.0.1:8000/services/auto_contains/invoke
"""

route("/auto_contains_any", app=default_app)(
    builtin.auto_contains_any(
        substrings=["maha", "lo"],
    )
)

"""
curl -i http://127.0.0.1:8000/services/auto_contains_any/inspect
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":true}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"substrings": ["maha","lo"]}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahalo"}}' \
  http://127.0.0.1:8000/services/auto_contains_any/invoke
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":false}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"substrings": ["moha","lo"]}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahala"}}' \
  http://127.0.0.1:8000/services/auto_contains_any/invoke
"""

route("/auto_contains_all", app=default_app)(
    builtin.auto_contains_all(
        substrings=["maha", "lo"],
    )
)

"""
curl -i http://127.0.0.1:8000/services/auto_contains_all/inspect
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":true}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"substrings": ["maha","lo"]}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahalo"}}' \
  http://127.0.0.1:8000/services/auto_contains_all/invoke
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":false}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"substrings": ["maha","lo"]}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahala"}}' \
  http://127.0.0.1:8000/services/auto_contains_all/invoke
"""

route("/auto_contains_json", app=default_app)(builtin.auto_contains_json())

"""
curl -i http://127.0.0.1:8000/services/auto_contains_json/inspect
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":true}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"outputs": {"aloha": "mahalo"}}}' \
  http://127.0.0.1:8000/services/auto_contains_json/invoke
"""

""" {"version":"2025.07.14","data":{"outputs":{"success":false}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"outputs": "mahalo"}}' \
  http://127.0.0.1:8000/services/auto_contains_json/invoke
"""

route("/auto_json_diff", app=default_app)(builtin.auto_json_diff())

"""
curl -i http://127.0.0.1:8000/services/auto_json_diff/inspect
"""

""" {"version":"2025.07.14","data":{"outputs":{"score":1.0,"success":true}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"correct_answer_key": "correct_answer"}, "inputs": {"correct_answer": {"aloha": "mahalo"}}, "outputs": {"aloha": "mahalo"}}}' \
  http://127.0.0.1:8000/services/auto_json_diff/invoke
"""

""" {"version":"2025.07.14","data":{"outputs":{"score":1.0,"success":false}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"correct_answer_key": "correct_answer"}, "inputs": {"correct_answer": {"aloha": "mahalo"}}, "outputs": {"mahalo": "aloha"}}}' \
  http://127.0.0.1:8000/services/auto_json_diff/invoke
"""

route("/auto_levenshtein_distance", app=default_app)(
    builtin.auto_levenshtein_distance()
)

"""
curl -i http://127.0.0.1:8000/services/auto_levenshtein_distance/inspect
"""

""" {"version":"2025.07.14","data":{"outputs":{"score":1.0,"success":true}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"correct_answer_key": "correct_answer"}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahalo"}}' \
  http://127.0.0.1:8000/services/auto_levenshtein_distance/invoke
"""

""" {"version":"2025.07.14","data":{"outputs":{"score":0.166,"success":false}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"correct_answer_key": "correct_answer"}, "inputs": {"correct_answer": "mahalo"}, "outputs": "aloha"}}' \
  http://127.0.0.1:8000/services/auto_levenshtein_distance/invoke
"""

route("/auto_similarity_match", app=default_app)(builtin.auto_similarity_match())

"""
curl -i http://127.0.0.1:8000/services/auto_similarity_match/inspect
"""

""" {"version":"2025.07.14","data":{"outputs":{"score":1.0,"success":true}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"correct_answer_key": "correct_answer"}, "inputs": {"correct_answer": "mahalo"}, "outputs": "mahalo"}}' \
  http://127.0.0.1:8000/services/auto_similarity_match/invoke
"""

""" {"version":"2025.07.14","data":{"outputs":{"score":0.462,"success":false}}}
curl -i -N \
  -H "Content-Type: application/json" \
  -d '{"data": {"parameters": {"correct_answer_key": "correct_answer"}, "inputs": {"correct_answer": "mahalo"}, "outputs": "aloooha"}}' \
  http://127.0.0.1:8000/services/auto_similarity_match/invoke
"""

route("/auto_semantic_similarity", app=default_app)(builtin.auto_semantic_similarity())

"""
curl -i http://127.0.0.1:8000/services/auto_semantic_similarity/inspect
"""


route("/completion", app=default_app)(
    builtin.completion(
        config=builtin.SinglePromptConfig(),
    )
)

"""
curl -i http://127.0.0.1:8000/services/completion/inspect
"""

"""
curl -i -N \
  -H "Content-Type: application/json" \
  -H "Authorization: ApiKey your_api_key_here" \
  -d '{"data": {"inputs": {"country": "Germany"}, "parameters": {"prompt": {"messages": [{"role": "assistant", "content": "What's the capital of {{country}}?"}]}}}}' \
  http://127.0.0.1:8000/services/completion/invoke
"""


route("/chat", app=default_app)(
    builtin.chat(
        config=builtin.SinglePromptConfig(),
    )
)

"""
curl -i http://127.0.0.1:8000/services/chat/inspect
"""

"""
curl -i -N \
  -H "Content-Type: application/json" \
  -H "Authorization: ApiKey your_api_key_here" \
  -d '{"data": {"inputs": {"country": "Germany"}, "parameters": {"prompt": {"messages": [{"role": "user", "content": "Hello, world!"}]}}}}' \
  http://127.0.0.1:8000/services/chat/invoke
"""
