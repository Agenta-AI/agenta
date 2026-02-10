import asyncio

from dotenv import load_dotenv

load_dotenv()

import agenta as ag  # noqa: E402

ag.init()

from agenta.sdk.models.workflows import (  # noqa: E402
    WorkflowServiceRequestData,
    WorkflowServiceRequest,
)
from agenta.sdk.decorators.running import workflow  # noqa: E402
from agenta.sdk.decorators.tracing import instrument  # noqa: E402
from agenta.sdk.workflows import builtin  # noqa: E402

print("-----------------------------------------------------------------------")

from agenta.sdk.workflows.handlers import echo_v0  # noqa: E402


@instrument(annotate=True)
def echo_custom(aloha: str):
    return {"got": aloha}


echo_manual = workflow(uri="echo")()


print(echo_custom(aloha="mahalo"), echo_custom)
print(echo_v0(aloha="mahalo"), echo_v0)
print(echo_manual(aloha="mahalo"), echo_manual)


print("-----------------------------------------------------------------------")
print()
print("-----------------------------------------------------------------------")

builtin_auto_exact_match = builtin.auto_exact_match()

print(
    builtin_auto_exact_match(
        inputs={"correct_answer": "mahalo"},
        outputs="mahalo",
    ),
    builtin_auto_exact_match,
)
print(
    builtin_auto_exact_match(
        inputs={"correct_answer": "mahalo"},
        outputs="mahala",
    ),
    builtin_auto_exact_match,
)

print("-----------------------------------------------------------------------")

print(
    asyncio.run(builtin_auto_exact_match.inspect()).model_dump(
        mode="json",
        exclude_none=True,
    ),
)

print("-----------------------------------------------------------------------")
print()
print("-----------------------------------------------------------------------")


builtin_auto_regex_test = builtin.auto_regex_test(
    regex_pattern="^ma.*o$",
)

print(
    builtin_auto_regex_test(
        outputs="mahalo",
    ),
    builtin_auto_regex_test,
)

print(
    builtin_auto_regex_test(
        outputs="mahala",
    ),
    builtin_auto_regex_test,
)

print("-----------------------------------------------------------------------")

print(
    asyncio.run(builtin_auto_regex_test.inspect()).model_dump(
        mode="json",
        exclude_none=True,
    ),
)

print("-----------------------------------------------------------------------")
print()
print("-----------------------------------------------------------------------")

builtin_field_match_test = builtin.field_match_test(
    json_field="answer",
    correct_answer_key="aloha",
)

print(
    builtin_field_match_test(
        inputs={"aloha": "mahalo"},
        outputs={"answer": "mahalo"},
    ),
    builtin_field_match_test,
)

print(
    builtin_field_match_test(
        inputs={"aloha": "mahalo"},
        outputs={"answer": "mahala"},
    ),
    builtin_field_match_test,
)

print("-----------------------------------------------------------------------")

print(
    asyncio.run(builtin_field_match_test.inspect()).model_dump(
        mode="json",
        exclude_none=True,
    ),
)

print("-----------------------------------------------------------------------")
print()
print("-----------------------------------------------------------------------")

print("auto_webhook_test")

print("-----------------------------------------------------------------------")
print()
print("-----------------------------------------------------------------------")

builtin_auto_custom_code_run = builtin.auto_custom_code_run(
    code="evaluate = lambda app_params, inputs, output, correct_answer: 1.0 if output in correct_answer else 0.0",
)

print(
    asyncio.run(
        builtin_auto_custom_code_run(
            inputs={"correct_answer": "mahalo"},
            outputs="mahalo",
        )
    ),
    builtin_auto_custom_code_run,
)


print(
    asyncio.run(
        builtin_auto_custom_code_run(
            inputs={"correct_answer": "mahalo"},
            outputs="mahala",
        )
    ),
    builtin_auto_custom_code_run,
)


print("-----------------------------------------------------------------------")

print(
    asyncio.run(builtin_auto_custom_code_run.inspect()).model_dump(
        mode="json",
        exclude_none=True,
    ),
)

print("-----------------------------------------------------------------------")
print()
print("-----------------------------------------------------------------------")

builtin_ai_critique = builtin.auto_ai_critique(
    prompt_template=[
        {
            "role": "system",
            "content": "You are an evaluator grading an LLM App.\nYou will be given INPUTS, the LLM APP OUTPUT, the CORRECT ANSWER used in the LLM APP.\n<grade_criteria>\n- Ensure that the LLM APP OUTPUT has the same meaning as the CORRECT ANSWER\n</grade_criteria>\n\n<score_criteria>\n-The score should be between 0 and 1 with one decimal point\n-A score of 1 means that the answer is perfect. This is the highest (best) score. Only when perfect match, otherwise something betweeen 0 and 1.\nA score of 0 means that the answer does not meet any of the criteria. This is the lowest possible score you can give.\n</score_criteria>\n\n<output_format>\nANSWER ONLY THE SCORE. DO NOT USE MARKDOWN. DO NOT PROVIDE ANYTHING OTHER THAN THE NUMBER\n</output_format>",
        },
        {
            "role": "user",
            "content": "<correct_answer>{{correct_answer}}</correct_answer>\n<llm_app_output>{{prediction}}</llm_app_output>",
        },
    ],
)

print(
    asyncio.run(
        builtin_ai_critique(
            inputs={
                "country": "Germany",
                "correct_answer": "Berlin",
            },
            outputs="Berlin",
        )
    ),
    builtin_ai_critique,
)

print(
    asyncio.run(
        builtin_ai_critique(
            inputs={
                "country": "Germany",
                "correct_answer": "Berlin",
            },
            outputs="Paris",
        )
    ),
    builtin_ai_critique,
)

print("-----------------------------------------------------------------------")

print(
    asyncio.run(builtin_ai_critique.inspect()).model_dump(
        mode="json",
        exclude_none=True,
    ),
)

print("-----------------------------------------------------------------------")

print(
    asyncio.run(
        builtin_ai_critique.invoke(
            request=WorkflowServiceRequest(
                data=WorkflowServiceRequestData(
                    inputs={
                        "country": "Germany",
                        "correct_answer": "Berlin",
                    },
                    outputs="Berlin",
                )
            )
        )
    ).model_dump(mode="json", exclude_none=True),
    builtin_ai_critique,
)

print(
    asyncio.run(
        builtin_ai_critique.invoke(
            request=WorkflowServiceRequest(
                data=WorkflowServiceRequestData(
                    inputs={
                        "country": "Germany",
                        "correct_answer": "Berlin",
                    },
                    outputs="Paris",
                )
            )
        )
    ).model_dump(mode="json", exclude_none=True),
    builtin_ai_critique,
)

print("-----------------------------------------------------------------------")
print()
print("-----------------------------------------------------------------------")

builtin_auto_starts_with = builtin.auto_starts_with(
    prefix="ma",
)

print(
    builtin_auto_starts_with(
        outputs="mahalo",
    ),
    builtin_auto_starts_with,
)

print(
    builtin_auto_starts_with(
        outputs="mohalo",
    ),
    builtin_auto_starts_with,
)

print("-----------------------------------------------------------------------")

print(
    asyncio.run(builtin_auto_starts_with.inspect()).model_dump(
        mode="json",
        exclude_none=True,
    ),
)

print("-----------------------------------------------------------------------")
print()
print("-----------------------------------------------------------------------")

builtin_auto_ends_with = builtin.auto_ends_with(
    suffix="lo",
)

print(
    builtin_auto_ends_with(
        outputs="mahalo",
    ),
    builtin_auto_ends_with,
)

print(
    builtin_auto_ends_with(
        outputs="mahala",
    ),
    builtin_auto_ends_with,
)

print("-----------------------------------------------------------------------")

print(
    asyncio.run(builtin_auto_ends_with.inspect()).model_dump(
        mode="json",
        exclude_none=True,
    ),
)

print("-----------------------------------------------------------------------")
print()
print("-----------------------------------------------------------------------")

builtin_auto_contains = builtin.auto_contains(
    substring="ha",
)

print(
    builtin_auto_contains(
        outputs="mahalo",
    ),
    builtin_auto_contains,
)

print(
    builtin_auto_contains(
        outputs="maala",
    ),
    builtin_auto_contains,
)


print("-----------------------------------------------------------------------")

print(
    asyncio.run(builtin_auto_contains.inspect()).model_dump(
        mode="json",
        exclude_none=True,
    ),
)

print("-----------------------------------------------------------------------")
print()
print("-----------------------------------------------------------------------")

builtin_auto_contains_any = builtin.auto_contains_any(
    substrings=["maha", "lo"],
)

print(
    builtin_auto_contains_any(
        outputs="mahalo",
    ),
    builtin_auto_contains_any,
)

print(
    builtin_auto_contains_any(
        outputs="mohala",
    ),
    builtin_auto_contains_any,
)

print("-----------------------------------------------------------------------")

print(
    asyncio.run(builtin_auto_contains_any.inspect()).model_dump(
        mode="json",
        exclude_none=True,
    ),
)

print("-----------------------------------------------------------------------")
print()
print("-----------------------------------------------------------------------")

builtin_auto_contains_all = builtin.auto_contains_all(
    substrings=["maha", "lo"],
)

print(
    builtin_auto_contains_all(
        outputs="mahalo",
    ),
    builtin_auto_contains_all,
)

print(
    builtin_auto_contains_all(
        outputs="mahala",
    ),
    builtin_auto_contains_all,
)

print("-----------------------------------------------------------------------")

print(
    asyncio.run(builtin_auto_contains_all.inspect()).model_dump(
        mode="json",
        exclude_none=True,
    ),
)

print("-----------------------------------------------------------------------")
print()
print("-----------------------------------------------------------------------")

builtin_auto_contains_json = builtin.auto_contains_json()

print(
    builtin_auto_contains_json(
        outputs='{"aloha": "mahalo"}',
    ),
    builtin_auto_contains_json,
)

print(
    builtin_auto_contains_json(
        outputs={"aloha": "mahalo"},
    ),
    builtin_auto_contains_json,
)

print(
    builtin_auto_contains_json(
        outputs="mahala",
    ),
    builtin_auto_contains_json,
)

print("-----------------------------------------------------------------------")

print(
    asyncio.run(builtin_auto_contains_json.inspect()).model_dump(
        mode="json",
        exclude_none=True,
    ),
)

print("-----------------------------------------------------------------------")
print()
print("-----------------------------------------------------------------------")

builtin_auto_json_diff = builtin.auto_json_diff()

print(
    builtin_auto_json_diff(
        inputs={"correct_answer": {"aloha": "mahalo"}},
        outputs={"aloha": "mahalo"},
    ),
    builtin_auto_json_diff,
)

print(
    builtin_auto_json_diff(
        inputs={"correct_answer": {"aloha": "mahalo"}},
        outputs={"mahalo": "aloha"},
    ),
    builtin_auto_json_diff,
)


print("-----------------------------------------------------------------------")

print(
    asyncio.run(builtin_auto_json_diff.inspect()).model_dump(
        mode="json",
        exclude_none=True,
    ),
)

print("-----------------------------------------------------------------------")
print()
print("-----------------------------------------------------------------------")


builtin_auto_levenshtein_distance = builtin.auto_levenshtein_distance(
    threshold=0.9,
)

print(
    builtin_auto_levenshtein_distance(
        inputs={"correct_answer": "mahalo"},
        outputs="mahalo",
    ),
    builtin_auto_levenshtein_distance,
)

print(
    builtin_auto_levenshtein_distance(
        inputs={"correct_answer": "mahalo"},
        outputs="mahala",
    ),
    builtin_auto_levenshtein_distance,
)

print("-----------------------------------------------------------------------")

print(
    asyncio.run(builtin_auto_levenshtein_distance.inspect()).model_dump(
        mode="json",
        exclude_none=True,
    ),
)

print("-----------------------------------------------------------------------")
print()
print("-----------------------------------------------------------------------")

builtin_auto_similarity_match = builtin.auto_similarity_match(
    threshold=0.9,
)

print(
    builtin_auto_similarity_match(
        inputs={"correct_answer": "mahalo"},
        outputs="mahalo",
    ),
    builtin_auto_similarity_match,
)

print(
    builtin_auto_similarity_match(
        inputs={"correct_answer": "mahalo"},
        outputs="mohala",
    ),
    builtin_auto_similarity_match,
)


print("-----------------------------------------------------------------------")

print(
    asyncio.run(builtin_auto_similarity_match.inspect()).model_dump(
        mode="json",
        exclude_none=True,
    ),
)


print("-----------------------------------------------------------------------")
print()
print("-----------------------------------------------------------------------")

builtin_auto_semantic_similarity = builtin.auto_semantic_similarity(
    threshold=0.9,
)

print(
    asyncio.run(
        builtin_auto_semantic_similarity(
            inputs={"correct_answer": "mahalo"},
            outputs="mahalo",
        )
    ),
    builtin_auto_semantic_similarity,
)

print(
    asyncio.run(
        builtin_auto_semantic_similarity(
            inputs={"correct_answer": "mahalo"},
            outputs="mohala",
        )
    ),
    builtin_auto_semantic_similarity,
)

print("-----------------------------------------------------------------------")

print(
    asyncio.run(builtin_auto_semantic_similarity.inspect()).model_dump(
        mode="json",
        exclude_none=True,
    ),
)


print("-----------------------------------------------------------------------")
print()
print("-----------------------------------------------------------------------")

builtin_completion = builtin.completion(
    config=builtin.SinglePromptConfig(
        **{
            "prompt": {
                "messages": [
                    {
                        "role": "user",
                        "content": "What's the capital of {{country}}?",
                    }
                ]
            }
        }  # type: ignore
    ),
)

print(
    asyncio.run(
        builtin_completion(
            inputs={"country": "Germany"},
        )
    ),
    builtin_completion,
)


print("-----------------------------------------------------------------------")

print(
    asyncio.run(builtin_completion.inspect()).model_dump(
        mode="json",
        exclude_none=True,
    ),
)


print("-----------------------------------------------------------------------")
print()
print("-----------------------------------------------------------------------")

builtin_chat = builtin.chat(
    config=builtin.SinglePromptConfig(
        **{
            "prompt": {
                "messages": [
                    {
                        "role": "assistant",
                        "content": "Always respond in uppercase.",
                    }
                ]
            }
        }
    ),
)

print(
    asyncio.run(
        builtin_chat(
            messages=[
                {
                    "role": "user",
                    "content": "What's the capital of Germany?",
                }
            ]
        )
    ),
    builtin_chat,
)

print("-----------------------------------------------------------------------")

print(
    asyncio.run(builtin_chat.inspect()).model_dump(
        mode="json",
        exclude_none=True,
    ),
)


print("-----------------------------------------------------------------------")
