from typing import Optional, Union, Dict

from agenta.sdk.models.workflows import Reference
from agenta.sdk.decorators.running import workflow, Workflow, application, evaluator
from agenta.sdk.workflows.handlers import SinglePromptConfig


def echo(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
) -> Workflow:
    return workflow(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="echo",
    )()


def auto_exact_match(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
    #
    correct_answer_key: Optional[str] = "correct_answer",
) -> Workflow:
    parameters = dict(
        correct_answer_key=correct_answer_key,
    )

    return evaluator(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="auto_exact_match",
        #
        parameters=parameters,
    )()


def auto_regex_test(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
    #
    regex_pattern: str,
    #
    regex_should_match: Optional[bool] = True,
    case_sensitive: Optional[bool] = True,
) -> Workflow:
    parameters = dict(
        regex_pattern=regex_pattern,
        regex_should_match=regex_should_match,
        case_sensitive=case_sensitive,
    )

    return evaluator(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="auto_regex_test",
        #
        parameters=parameters,
    )()


def field_match_test(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
    #
    json_field: str,
    #
    correct_answer_key: Optional[str] = "correct_answer",
) -> Workflow:
    parameters = dict(
        json_field=json_field,
        correct_answer_key=correct_answer_key,
    )

    return evaluator(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="field_match_test",
        #
        parameters=parameters,
    )()


def auto_webhook_test(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
    #
    webhook_url: str,
    #
    correct_answer_key: Optional[str] = "correct_answer",
) -> Workflow:
    parameters = dict(
        webhook_url=webhook_url,
        correct_answer_key=correct_answer_key,
    )

    return evaluator(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="auto_webhook_test",
        #
        parameters=parameters,
    )()


def auto_custom_code_run(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
    #
    code: str,
    #
    correct_answer_key: Optional[str] = "correct_answer",
    threshold: Optional[float] = 0.5,
) -> Workflow:
    parameters = dict(
        code=code,
        correct_answer_key=correct_answer_key,
        threshold=threshold,
    )

    return evaluator(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="auto_custom_code_run",
        #
        parameters=parameters,
    )()


def auto_ai_critique(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
    #
    prompt_template: list[dict[str, str]],
    #
    correct_answer_key: Optional[str] = "correct_answer",
    model: Optional[str] = "gpt-3.5-turbo",
) -> Workflow:
    parameters = dict(
        prompt_template=prompt_template,
        correct_answer_key=correct_answer_key,
        model=model,
        version=3,
        template_format="curly",
    )

    return evaluator(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="auto_ai_critique",
        #
        parameters=parameters,
    )()


def auto_starts_with(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
    #
    prefix: str,
    #
    case_sensitive: Optional[bool] = True,
) -> Workflow:
    parameters = dict(
        prefix=prefix,
        case_sensitive=case_sensitive,
    )

    return evaluator(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="auto_starts_with",
        #
        parameters=parameters,
    )()


def auto_ends_with(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
    #
    suffix: str,
    #
    case_sensitive: Optional[bool] = True,
) -> Workflow:
    parameters = dict(
        suffix=suffix,
        case_sensitive=case_sensitive,
    )

    return evaluator(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="auto_ends_with",
        #
        parameters=parameters,
    )()


def auto_contains(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
    #
    substring: str,
    #
    case_sensitive: Optional[bool] = True,
) -> Workflow:
    parameters = dict(
        substring=substring,
        case_sensitive=case_sensitive,
    )

    return evaluator(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="auto_contains",
        #
        parameters=parameters,
    )()


def auto_contains_any(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
    #
    substrings: list[str],
    #
    case_sensitive: Optional[bool] = True,
) -> Workflow:
    parameters = dict(
        substrings=substrings,
        case_sensitive=case_sensitive,
    )

    return evaluator(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="auto_contains_any",
        #
        parameters=parameters,
    )()


def auto_contains_all(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
    #
    substrings: list[str],
    #
    case_sensitive: Optional[bool] = True,
) -> Workflow:
    parameters = dict(
        substrings=substrings,
        case_sensitive=case_sensitive,
    )

    return evaluator(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="auto_contains_all",
        #
        parameters=parameters,
    )()


def auto_contains_json(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
) -> Workflow:
    return evaluator(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="auto_contains_json",
    )()


def auto_json_diff(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
    #
    correct_answer_key: Optional[str] = "correct_answer",
    threshold: Optional[float] = 0.5,
    predict_keys: Optional[bool] = False,
    case_insensitive_keys: Optional[bool] = False,
    compare_schema_only: Optional[bool] = False,
) -> Workflow:
    parameters = dict(
        correct_answer_key=correct_answer_key,
        threshold=threshold,
        predict_keys=predict_keys,
        case_insensitive_keys=case_insensitive_keys,
        compare_schema_only=compare_schema_only,
    )

    return evaluator(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="auto_json_diff",
        #
        parameters=parameters,
    )()


def auto_levenshtein_distance(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
    #
    correct_answer_key: Optional[str] = "correct_answer",
    case_sensitive: Optional[bool] = True,
    threshold: Optional[float] = 0.5,
) -> Workflow:
    parameters = dict(
        correct_answer_key=correct_answer_key,
        case_sensitive=case_sensitive,
        threshold=threshold,
    )

    return evaluator(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="auto_levenshtein_distance",
        #
        parameters=parameters,
    )()


def auto_similarity_match(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
    #
    correct_answer_key: Optional[str] = "correct_answer",
    case_sensitive: Optional[bool] = True,
    threshold: Optional[float] = 0.5,
) -> Workflow:
    parameters = dict(
        correct_answer_key=correct_answer_key,
        case_sensitive=case_sensitive,
        threshold=threshold,
    )

    return evaluator(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="auto_similarity_match",
        #
        parameters=parameters,
    )()


def auto_semantic_similarity(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
    #
    correct_answer_key: Optional[str] = "correct_answer",
    threshold: Optional[float] = 0.5,
    embedding_model: Optional[str] = "text-embedding-3-small",
) -> Workflow:
    parameters = dict(
        correct_answer_key=correct_answer_key,
        threshold=threshold,
        embedding_model=embedding_model,
    )

    return evaluator(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="auto_semantic_similarity",
        #
        parameters=parameters,
    )()


def completion(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
    #
    config: SinglePromptConfig,
) -> Workflow:
    parameters = config.model_dump(
        mode="json",
        exclude_none=True,
    )

    return application(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="completion",
        #
        parameters=parameters,
    )()


def chat(
    *,
    slug: Optional[str] = None,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    variant_slug: Optional[str] = None,
    #
    config: SinglePromptConfig,
) -> Workflow:
    parameters = config.model_dump(
        mode="json",
        exclude_none=True,
    )

    return application(
        slug=slug,
        #
        name=name,
        description=description,
        #
        variant_slug=variant_slug,
        #
        uri="chat",
        #
        parameters=parameters,
    )()
