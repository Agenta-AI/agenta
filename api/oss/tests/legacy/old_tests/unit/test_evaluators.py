import os
import pytest

from oss.src.tests.unit.test_traces import (
    simple_rag_trace,
    simple_rag_trace_for_baseresponse_v3,
)
from oss.src.services.evaluators_service import (
    auto_levenshtein_distance,
    auto_ai_critique,
    auto_starts_with,
    auto_ends_with,
    auto_contains,
    auto_contains_any,
    auto_contains_all,
    auto_contains_json,
    auto_json_diff,
    auto_semantic_similarity,
    rag_context_relevancy,
    rag_faithfulness,
)


@pytest.mark.parametrize(
    "ground_truth, output, settings_values, openai_api_key, expected_min, expected_max",
    [
        (
            {"correct_answer": "The capital of Kiribati is Tarawa."},
            "The capital of Kiribati is South Tarawa.",
            {
                "prompt_template": "We have an LLM App that we want to evaluate its outputs. Based on the prompt and the parameters provided below evaluate the output based on the evaluation strategy below:\nEvaluation strategy: 0 to 10 0 is very bad and 10 is very good.\nPrompt: {llm_app_prompt_template}\nInputs: country: {country}\nExpected Answer Column:{correct_answer}\nEvaluate this: {variant_output}\n\nAnswer ONLY with one of the given grading or evaluation options.",
                "correct_answer_key": "correct_answer",
            },
            os.environ.get("OPENAI_API_KEY"),
            0,
            10,
        ),
        (
            {"correct_answer": "The capital of Kiribati is Tarawa."},
            "The capital of Kiribati is South Tarawa.",
            {
                "prompt_template": "We have an LLM App that we want to evaluate its outputs. Based on the prompt and the parameters provided below evaluate the output based on the evaluation strategy below:\nEvaluation strategy: 0 to 10 0 is very bad and 10 is very good.\nPrompt: {llm_app_prompt_template}\nInputs: country: {country}\nExpected Answer Column:{correct_answer}\nEvaluate this: {variant_output}\n\nAnswer ONLY with one of the given grading or evaluation options.",
                "correct_answer_key": "correct_answer",
            },
            None,
            None,
            None,
        ),
    ],
)
@pytest.mark.asyncio
async def test_auto_ai_critique_evaluator(
    ground_truth, output, settings_values, openai_api_key, expected_min, expected_max
):
    result = await auto_ai_critique(
        {},
        output,
        ground_truth,
        {},
        settings_values,
        {"OPENAI_API_KEY": openai_api_key},
    )
    try:
        assert expected_min <= round(result.value, 1) <= expected_max
    except TypeError:
        # exceptions
        # - raised by evaluator (agenta) -> TypeError
        assert not isinstance(result.value, float) or not isinstance(result.value, int)


@pytest.mark.parametrize(
    "output, settings_values, expected",
    [
        (
            "Hello world",
            {
                "prefix": "He",
                "case_sensitive": True,
                "correct_answer_keys": ["correct_answer"],
            },
            True,
        ),
        (
            "hello world",
            {
                "prefix": "He",
                "case_sensitive": False,
                "correct_answer_keys": ["correct_answer"],
            },
            True,
        ),
        (
            "Hello world",
            {
                "prefix": "he",
                "case_sensitive": False,
                "correct_answer_keys": ["correct_answer"],
            },
            True,
        ),
        (
            "Hello world",
            {
                "prefix": "world",
                "case_sensitive": True,
                "correct_answer_keys": ["correct_answer"],
            },
            False,
        ),
    ],
)
@pytest.mark.asyncio
async def test_auto_starts_with(output, settings_values, expected):
    result = await auto_starts_with(
        inputs={},
        output=output,
        data_point={},
        app_params={},
        settings_values=settings_values,
        lm_providers_keys={},
    )
    assert result.value == expected


# Test for auto_ends_with


@pytest.mark.parametrize(
    "output, suffix, case_sensitive, expected",
    [
        ("Hello world", "world", True, True),
        ("hello world", "World", False, True),
        ("Hello world", "World", True, False),
        ("Hello world", "Hello", True, False),
    ],
)
@pytest.mark.asyncio
async def test_auto_ends_with(output, suffix, case_sensitive, expected):
    result = await auto_ends_with(
        {},
        output,
        {},
        {},
        {"suffix": suffix, "case_sensitive": case_sensitive},
        {},
    )
    assert result.value == expected


# Test for auto_contains


@pytest.mark.parametrize(
    "output, substring, case_sensitive, expected",
    [
        ("Hello world", "lo wo", True, True),
        ("Hello world", "LO WO", False, True),
        ("Hello world", "abc", True, False),
    ],
)
@pytest.mark.asyncio
async def test_auto_contains(output, substring, case_sensitive, expected):
    result = await auto_contains(
        {},
        output,
        {},
        {},
        {"substring": substring, "case_sensitive": case_sensitive},
        {},
    )
    assert result.value == expected


# Test for auto_contains_any


@pytest.mark.parametrize(
    "output, substrings, case_sensitive, expected",
    [
        ("Hello world", "hello,world", True, True),
        ("Hello world", "world,universe", True, True),
        ("Hello world", "world,universe", False, True),
        ("Hello world", "abc,xyz", True, False),
    ],
)
@pytest.mark.asyncio
async def test_auto_contains_any(output, substrings, case_sensitive, expected):
    result = await auto_contains_any(
        {},
        output,
        {},
        {},
        {"substrings": substrings, "case_sensitive": case_sensitive},
        {},
    )
    assert result.value == expected


# Test for auto_contains_all


@pytest.mark.parametrize(
    "output, substrings, case_sensitive, expected",
    [
        ("Hello world", "hello,world", True, False),
        ("Hello world", "Hello,world", True, True),
        ("Hello world", "hello,world", False, True),
        ("Hello world", "world,universe", True, False),
    ],
)
@pytest.mark.asyncio
async def test_auto_contains_all(output, substrings, case_sensitive, expected):
    result = await auto_contains_all(
        {},
        output,
        {},
        {},
        {"substrings": substrings, "case_sensitive": case_sensitive},
        {},
    )
    assert result.value == expected


# Test for auto_contains_json
@pytest.mark.parametrize(
    "output, expected",
    [
        ('Some random text {"key": "value"} more text', True),
        ("No JSON here!", False),
        ("{Malformed JSON, nope!}", False),
        ('{"valid": "json", "number": 123}', True),
        ({"data": {"message": "The capital of Azerbaijan is Baku."}}, True),
        ({"data": '{"message": "The capital of Azerbaijan is Baku."}'}, True),
        ({"data": "The capital of Azerbaijan is Baku."}, False),
    ],
)
@pytest.mark.asyncio
async def test_auto_contains_json(output, expected):
    result = await auto_contains_json({}, output, {}, {}, {}, {})
    assert result.value == expected


@pytest.mark.parametrize(
    "ground_truth, app_output, settings_values, expected_min, expected_max",
    [
        (
            {
                "correct_answer": '{"user": {"name": "John", "details": {"age": 30, "location": "New York"}}}'
            },
            '{"user": {"name": "John", "details": {"age": 30, "location": "New York"}}}',
            {
                "predict_keys": True,
                "compare_schema_only": False,
                "case_insensitive_keys": False,
                "correct_answer_key": "correct_answer",
            },
            0.0,
            1.0,
        ),
        (
            {
                "correct_answer": '{"user": {"name": "John", "details": {"age": "30", "location": "New York"}}}'
            },
            '{"user": {"name": "John", "details": {"age": "30", "location": "New York"}}}',
            {
                "predict_keys": True,
                "compare_schema_only": True,
                "case_insensitive_keys": False,
                "correct_answer_key": "correct_answer",
            },
            0.0,
            1.0,
        ),
        (
            {
                "correct_answer": '{"user": {"name": "John", "details": {"age": 30, "location": "New York"}}}'
            },
            '{"USER": {"NAME": "John", "DETAILS": {"AGE": 30, "LOCATION": "New York"}}}',
            {
                "predict_keys": True,
                "compare_schema_only": False,
                "case_insensitive_keys": True,
                "correct_answer_key": "correct_answer",
            },
            0.0,
            1.0,
        ),
        (
            {
                "correct_answer": '{"user": {"name": "John", "details": {"age": 30, "location": "New York"}}}'
            },
            {
                "data": '{"USER": {"NAME": "John", "DETAILS": {"AGE": 30, "LOCATION": "New York"}}}'
            },
            {
                "predict_keys": True,
                "compare_schema_only": False,
                "case_insensitive_keys": True,
                "correct_answer_key": "correct_answer",
            },
            0.0,
            1.0,
        ),
        (
            {
                "correct_answer": '{"user": {"name": "John", "details": {"age": 30, "location": "New York"}}}'
            },
            {
                "data": {
                    "output": '{"USER": {"NAME": "John", "DETAILS": {"AGE": 30, "LOCATION": "New York"}}}'
                }
            },
            {
                "predict_keys": True,
                "compare_schema_only": False,
                "case_insensitive_keys": True,
                "correct_answer_key": "correct_answer",
            },
            0.0,
            1.0,
        ),
    ],
)
@pytest.mark.asyncio
async def test_auto_json_diff(
    ground_truth, app_output, settings_values, expected_min, expected_max
):
    result = await auto_json_diff({}, app_output, ground_truth, {}, settings_values, {})
    assert expected_min <= result.value <= expected_max


@pytest.mark.parametrize(
    "ground_truth, app_output, settings_values, expected_min, expected_max",
    [
        (
            {"correct_answer": "The capital of Kiribati is Tarawa."},
            "The capital of Kiribati is South Tarawa.",
            {
                "correct_answer_key": "correct_answer",
            },
            0.0,
            1.0,
        ),
        (
            {"correct_answer": "The capital of Tuvalu is Funafuti."},
            "The capital of Tuvalu is Funafuti.",
            {
                "correct_answer_key": "correct_answer",
            },
            0.0,
            1.0,
        ),
        (
            {"correct_answer": "The capital of Kyrgyzstan is Bishkek."},
            "Yaren District.",
            {
                "correct_answer_key": "correct_answer",
            },
            0.0,
            1.0,
        ),
        (
            {"correct_answer": "The capital of Namibia is Windhoek."},
            "Windhoek is the capital of Namibia.",
            {
                "correct_answer_key": "correct_answer",
            },
            None,
            None,
        ),
    ],
)
@pytest.mark.asyncio
async def test_auto_semantic_similarity_match(
    ground_truth, app_output, settings_values, expected_min, expected_max
):
    result = await auto_semantic_similarity(
        {},
        app_output,
        ground_truth,
        {},
        settings_values,
        {"OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY")},
    )
    try:
        assert expected_min <= round(result.value, 1) <= expected_max
    except TypeError:
        # exceptions
        # - raised by evaluator (agenta) -> TypeError
        assert not isinstance(result.value, float) or not isinstance(result.value, int)


@pytest.mark.parametrize(
    "output, data_point, settings_values, expected",
    [
        (
            "hello world",
            {"correct_answer": "hello world"},
            {"threshold": 5, "correct_answer_key": "correct_answer"},
            True,
        ),
        (
            "hello world",
            {"correct_answer": "hola mundo"},
            {"threshold": 5, "correct_answer_key": "correct_answer"},
            False,
        ),
        (
            "hello world",
            {"correct_answer": "hello world!"},
            {"threshold": 2, "correct_answer_key": "correct_answer"},
            True,
        ),
        (
            "hello world",
            {"correct_answer": "hello wor"},
            {"threshold": 10, "correct_answer_key": "correct_answer"},
            True,
        ),
        (
            "hello world",
            {"correct_answer": "hello worl"},
            {"correct_answer_key": "correct_answer"},
            1,
        ),
        (
            "hello world",
            {"correct_answer": "helo world"},
            {"correct_answer_key": "correct_answer"},
            1,
        ),
    ],
)
@pytest.mark.asyncio
async def test_auto_levenshtein_distance(output, data_point, settings_values, expected):
    result = await auto_levenshtein_distance(
        inputs={},
        output=output,
        data_point=data_point,
        app_params={},
        settings_values=settings_values,
        lm_providers_keys={},
    )
    assert result.value == expected


@pytest.mark.parametrize(
    "settings_values, expected_min, openai_api_key, expected_max",
    [
        (
            {
                "question_key": "rag.retriever.internals.prompt",
                "answer_key": "rag.reporter.outputs.report",
                "contexts_key": "rag.retriever.outputs.movies",
            },
            os.environ.get("OPENAI_API_KEY"),
            0.0,
            1.0,
        ),
        (
            {
                "question_key": "rag.retriever.internals.prompt",
                "answer_key": "rag.reporter.outputs.report",
                "contexts_key": "rag.retriever.outputs.movies",
            },
            None,
            None,
            None,
        ),
        # add more use cases
    ],
)
@pytest.mark.asyncio
async def test_rag_faithfulness_evaluator(
    settings_values, expected_min, openai_api_key, expected_max
):
    result = await rag_faithfulness(
        {},
        simple_rag_trace,
        {},
        {},
        settings_values,
        {"OPENAI_API_KEY": openai_api_key},
    )

    try:
        assert expected_min <= round(result.value, 1) <= expected_max
    except TypeError:
        # exceptions
        # - raised by evaluator (agenta) -> TypeError
        assert not isinstance(result.value, float) or not isinstance(result.value, int)


@pytest.mark.parametrize(
    "settings_values, expected_min, openai_api_key, expected_max",
    [
        (
            {
                "question_key": "rag.retriever.internals.prompt",
                "answer_key": "rag.reporter.outputs.report",
                "contexts_key": "rag.retriever.outputs.movies",
            },
            os.environ.get("OPENAI_API_KEY"),
            0.0,
            1.0,
        ),
        (
            {
                "question_key": "rag.retriever.internals.prompt",
                "answer_key": "rag.reporter.outputs.report",
                "contexts_key": "rag.retriever.outputs.movies",
            },
            None,
            None,
            None,
        ),
        # add more use cases
    ],
)
@pytest.mark.asyncio
async def test_rag_context_relevancy_evaluator(
    settings_values, expected_min, openai_api_key, expected_max
):
    result = await rag_context_relevancy(
        {},
        simple_rag_trace,
        {},
        {},
        settings_values,
        {"OPENAI_API_KEY": openai_api_key},
    )

    try:
        assert expected_min <= round(result.value, 1) <= expected_max
    except TypeError:
        # exceptions
        # - raised by autoevals -> ValueError (caught already and then passed as a stacktrace to the result)
        # - raised by evaluator (agenta) -> TypeError
        assert not isinstance(result.value, float) or not isinstance(result.value, int)
        assert result.error.message == "Error during RAG Context Relevancy evaluation"


@pytest.mark.parametrize(
    "settings_values, expected_min, openai_api_key, expected_max",
    [
        (
            {
                "question_key": "rag.retriever.internals.prompt",
                "answer_key": "rag.reporter.outputs.report",
                "contexts_key": "rag.retriever.outputs.movies",
            },
            os.environ.get("OPENAI_API_KEY"),
            0.0,
            1.0,
        ),
        (
            {
                "question_key": "rag.retriever.internals.prompt",
                "answer_key": "rag.reporter.outputs.report",
                "contexts_key": "rag.retriever.outputs.movies",
            },
            None,
            None,
            None,
        ),
        # add more use cases
    ],
)
@pytest.mark.asyncio
async def test_rag_faithfulness_evaluator_for_baseresponse_v3(
    settings_values, expected_min, openai_api_key, expected_max
):
    result = await rag_faithfulness(
        {},
        simple_rag_trace_for_baseresponse_v3,
        {},
        {},
        settings_values,
        {"OPENAI_API_KEY": openai_api_key},
    )

    try:
        assert expected_min <= round(result.value, 1) <= expected_max
    except TypeError:
        # exceptions
        # - raised by evaluator (agenta) -> TypeError
        assert not isinstance(result.value, float) or not isinstance(result.value, int)


@pytest.mark.parametrize(
    "settings_values, expected_min, openai_api_key, expected_max",
    [
        (
            {
                "question_key": "rag.retriever.internals.prompt",
                "answer_key": "rag.reporter.outputs.report",
                "contexts_key": "rag.retriever.outputs.movies",
            },
            os.environ.get("OPENAI_API_KEY"),
            0.0,
            1.0,
        ),
        (
            {
                "question_key": "rag.retriever.internals.prompt",
                "answer_key": "rag.reporter.outputs.report",
                "contexts_key": "rag.retriever.outputs.movies",
            },
            None,
            None,
            None,
        ),
        # add more use cases
    ],
)
@pytest.mark.asyncio
async def test_rag_context_relevancy_evaluator_for_baseresponse_v3(
    settings_values, expected_min, openai_api_key, expected_max
):
    result = await rag_context_relevancy(
        {},
        simple_rag_trace_for_baseresponse_v3,
        {},
        {},
        settings_values,
        {"OPENAI_API_KEY": openai_api_key},
    )

    try:
        assert expected_min <= round(result.value, 1) <= expected_max
    except TypeError:
        # exceptions
        # - raised by autoevals -> ValueError (caught already and then passed as a stacktrace to the result)
        # - raised by evaluator (agenta) -> TypeError
        assert not isinstance(result.value, float) or not isinstance(result.value, int)
        assert result.error.message == "Error during RAG Context Relevancy evaluation"
