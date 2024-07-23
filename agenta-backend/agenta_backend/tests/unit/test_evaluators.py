import os
import pytest

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
    # rag
    get_field_value_from_trace,
    get_user_key_from_settings,
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
def test_auto_starts_with(output, settings_values, expected):
    result = auto_starts_with(
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
def test_auto_ends_with(output, suffix, case_sensitive, expected):
    result = auto_ends_with(
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
def test_auto_contains(output, substring, case_sensitive, expected):
    result = auto_contains(
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
def test_auto_contains_any(output, substrings, case_sensitive, expected):
    result = auto_contains_any(
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
def test_auto_contains_all(output, substrings, case_sensitive, expected):
    result = auto_contains_all(
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
    ],
)
def test_auto_contains_json(output, expected):
    result = auto_contains_json({}, output, {}, {}, {}, {})
    assert result.value == expected


@pytest.mark.parametrize(
    "ground_truth, app_output, settings_values, expected_score",
    [
        (
            {
                "correct_answer": {
                    "user": {
                        "name": "John",
                        "details": {"age": 30, "location": "New York"},
                    }
                }
            },
            '{"user": {"name": "John", "details": {"age": 30, "location": "New York"}}}',
            {
                "predict_keys": True,
                "compare_schema_only": False,
                "case_insensitive_keys": False,
                "correct_answer_key": "correct_answer",
            },
            1.0,
        ),
        (
            {
                "correct_answer": {
                    "user": {
                        "name": "John",
                        "details": {"age": 30, "location": "New York"},
                    }
                }
            },
            '{"user": {"name": "John", "details": {"age": "30", "location": "New York"}}}',
            {
                "predict_keys": True,
                "compare_schema_only": True,
                "case_insensitive_keys": False,
                "correct_answer_key": "correct_answer",
            },
            0.6666666666666666,
        ),
        (
            {
                "correct_answer": {
                    "user": {
                        "name": "John",
                        "details": {"age": 30, "location": "New York"},
                    }
                }
            },
            '{"USER": {"NAME": "John", "DETAILS": {"AGE": 30, "LOCATION": "New York"}}}',
            {
                "predict_keys": True,
                "compare_schema_only": False,
                "case_insensitive_keys": True,
                "correct_answer_key": "correct_answer",
            },
            0.5,
        ),
    ],
)
def test_auto_json_diff(ground_truth, app_output, settings_values, expected_score):
    result = auto_json_diff({}, app_output, ground_truth, {}, settings_values, {})
    assert result.value == expected_score


@pytest.mark.parametrize(
    "ground_truth, app_output, settings_values, expected_score",
    [
        (
            {"correct_answer": "The capital of Kiribati is Tarawa."},
            "The capital of Kiribati is South Tarawa.",
            {
                "correct_answer_key": "correct_answer",
            },
            0.929,
        ),
        (
            {"correct_answer": "The capital of Tuvalu is Funafuti."},
            "The capital of Tuvalu is Funafuti.",
            {
                "correct_answer_key": "correct_answer",
            },
            1,
        ),
        (
            {"correct_answer": "The capital of Kyrgyzstan is Bishkek."},
            "Yaren District.",
            {
                "correct_answer_key": "correct_answer",
            },
            0.205,
        ),
    ],
)
def test_auto_semantic_similarity_match(
    ground_truth, app_output, settings_values, expected_score
):
    result = auto_semantic_similarity(
        {},
        app_output,
        ground_truth,
        {},
        settings_values,
        {"OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY")},
    )
    assert round(result.value, 3) == expected_score


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
def test_auto_levenshtein_distance(output, data_point, settings_values, expected):
    result = auto_levenshtein_distance(
        inputs={},
        output=output,
        data_point=data_point,
        app_params={},
        settings_values=settings_values,
        lm_providers_keys={},
    )
    assert result.value == expected


app_output = {
    "trace_id": "669e4d55e51a875e6b94c492",
    "cost": None,
    "tokens": None,
    "latency": 0.000617,
    "rag": {
        "start_time": "2024-07-22T12:15:17.335835+00:00",
        "end_time": "2024-07-22T12:15:17.336452+00:00",
        "inputs": {"topic": "enchantment", "genre": "fiction", "count": 5},
        "outputs": {"report": ""},
        "locals": {},
        "retriever": {
            "start_time": "2024-07-22T12:15:17.336041+00:00",
            "end_time": "2024-07-22T12:15:17.336147+00:00",
            "inputs": {"topic": "enchantment", "genre": "fiction", "count": 5},
            "outputs": {
                "movies": ["ex machina", "i am mother", "mother/android"],
                "prompt": "List 3 movies about sci-fi in the genre of fiction.",
            },
            "locals": {"prompt": "List 3 movies about sci-fi in the genre of fiction."},
        },
        "generator": {
            "start_time": "2024-07-22T12:15:17.336192+00:00",
            "end_time": "2024-07-22T12:15:17.336239+00:00",
            "inputs": {"movies": ["ex machina", "i am mother", "mother/android"]},
            "outputs": {
                "report": "These three films explore the complex relationship between humans and artificial intelligence. In 'Ex Machina,' a programmer interacts with a humanoid AI, questioning consciousness and morality. 'I Am Mother' features a girl raised by a robot in a post-extinction world, who challenges her understanding of trust and the outside world when a human arrives. 'Mother/Android' follows a pregnant woman and her boyfriend navigating a post-apocalyptic landscape controlled by hostile androids, highlighting themes of survival and human resilience."
            },
            "locals": {},
        },
        "summarizer": [
            {
                "start_time": "2024-07-22T12:15:17.336281+00:00",
                "end_time": "2024-07-22T12:15:17.336325+00:00",
                "inputs": {
                    "report": "These three films explore the complex relationship between humans and artificial intelligence. In 'Ex Machina,' a programmer interacts with a humanoid AI, questioning consciousness and morality. 'I Am Mother' features a girl raised by a robot in a post-extinction world, who challenges her understanding of trust and the outside world when a human arrives. 'Mother/Android' follows a pregnant woman and her boyfriend navigating a post-apocalyptic landscape controlled by hostile androids, highlighting themes of survival and human resilience."
                },
                "outputs": {
                    "report": "These three films explore the complex relationship between humans and artificial intelligence. In 'Ex Machina,' a programmer interacts with a humanoid AI, questioning consciousness and morality. 'I Am Mother' features a girl raised by a robot in a post-extinction world, who challenges her understanding of trust and the outside world when a human arrives. 'Mother/Android' follows a pregnant woman and her boyfriend navigating a post-apocalyptic landscape controlled by hostile androids, highlighting themes of survival and human resilience."
                },
                "locals": {},
            },
            {
                "start_time": "2024-07-22T12:15:17.336355+00:00",
                "end_time": "2024-07-22T12:15:17.336429+00:00",
                "inputs": {
                    "report": "These three films explore the complex relationship between humans and artificial intelligence. In 'Ex Machina,' a programmer interacts with a humanoid AI, questioning consciousness and morality. 'I Am Mother' features a girl raised by a robot in a post-extinction world, who challenges her understanding of trust and the outside world when a human arrives. 'Mother/Android' follows a pregnant woman and her boyfriend navigating a post-apocalyptic landscape controlled by hostile androids, highlighting themes of survival and human resilience."
                },
                "outputs": {
                    "report": "These three films explore the complex relationship between humans and artificial intelligence. In 'Ex Machina,' a programmer interacts with a humanoid AI, questioning consciousness and morality. 'I Am Mother' features a girl raised by a robot in a post-extinction world, who challenges her understanding of trust and the outside world when a human arrives. 'Mother/Android' follows a pregnant woman and her boyfriend navigating a post-apocalyptic landscape controlled by hostile androids, highlighting themes of survival and human resilience."
                },
                "locals": {},
            },
        ],
    },
}


@pytest.mark.parametrize(
    "evaluator_function, expected_name, settings_values, expected_score",
    [
        (
            rag_faithfulness,
            "Faithfulness",
            {
                "question_key": {
                    # ...
                    "type": "string",
                    "default": "rag.retriever.outputs.prompt",
                },
                "answer_key": {
                    # ...
                    "type": "string",
                    "default": "rag.generator.outputs.report",
                },
                "contexts_key": {
                    # ...
                    "type": "string",
                    "default": "rag.retriever.outputs.movies",
                },
            },
            0.0,
        ),
        (
            rag_context_relevancy,
            "Context Relevancy",
            {
                "question_key": {
                    # ...
                    "type": "string",
                    "default": "rag.retriever.outputs.prompt",
                },
                "answer_key": {
                    # ...
                    "type": "string",
                    "default": "rag.generator.outputs.report",
                },
                "contexts_key": {
                    # ...
                    "type": "string",
                    "default": "rag.retriever.outputs.movies",
                },
            },
            0.9,
        ),
    ],
)
def test_rag_evaluator(
    evaluator_function, expected_name, settings_values, expected_score
):
    question_key = get_user_key_from_settings(settings_values, "question_key")
    answer_key = get_user_key_from_settings(settings_values, "answer_key")
    contexts_key = get_user_key_from_settings(settings_values, "contexts_key")

    question_value = get_field_value_from_trace(app_output, question_key)
    answer_value = get_field_value_from_trace(app_output, answer_key)
    contexts_value = get_field_value_from_trace(app_output, contexts_key)

    result = evaluator_function(
        {},
        app_output,
        {},
        {},
        settings_values,
        {},
    )

    assert round(result.value, 1) == expected_score
