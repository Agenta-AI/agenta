import os
import pytest

from test_traces import simple_rag_trace

from agenta_backend.services.evaluators_service import (
    auto_levenshtein_distance,
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
        ({"data": {"message": "The capital of Azerbaijan is Baku."}}, None),
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
    assert expected_min <= round(result.value, 3) <= expected_max


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
    "settings_values, expected_min, expected_max",
    [
        (
            {
                "question_key": "rag.retriever.internals.prompt",
                "answer_key": "rag.reporter.outputs.report",
                "contexts_key": "rag.retriever.outputs.movies",
            },
            0.0,
            1.0,
        ),
        # add more use cases
    ],
)
@pytest.mark.asyncio
async def test_rag_faithfulness_evaluator(settings_values, expected_min, expected_max):
    result = await rag_faithfulness(
        {},
        simple_rag_trace,
        {},
        {},
        settings_values,
        {"OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY")},
    )

    assert expected_min <= round(result.value, 1) <= expected_max


@pytest.mark.parametrize(
    "settings_values, expected_min, expected_max",
    [
        (
            {
                "question_key": "rag.retriever.internals.prompt",
                "answer_key": "rag.reporter.outputs.report",
                "contexts_key": "rag.retriever.outputs.movies",
            },
            0.0,
            1.0,
        ),
        # add more use cases
    ],
)
@pytest.mark.asyncio
async def test_rag_context_relevancy_evaluator(
    settings_values, expected_min, expected_max
):
    result = await rag_context_relevancy(
        {},
        simple_rag_trace,
        {},
        {},
        settings_values,
        {"OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY")},
    )

    try:
        assert expected_min <= round(result.value, 1) <= expected_max
    except TypeError as error:
        # exceptions
        # - raised by autoevals -> ValueError (caught already and then passed as a stacktrace to the result)
        # - raised by evaluator (agenta) -> TypeError
        assert not isinstance(result.value, float) or not isinstance(result.value, int)
        assert result.error.message == "Error during RAG Context Relevancy evaluation"
