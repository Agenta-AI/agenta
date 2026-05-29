"""FastMCP front door for the Agenta authoring surface."""

from __future__ import annotations

import os
from typing import Any, Literal

from mcp.server.fastmcp import FastMCP

from .client import AgentaClient


def _port_from_env() -> int:
    value = os.getenv("MCP_PORT", "8001")
    try:
        return int(value)
    except ValueError:
        return 8001


mcp = FastMCP(
    "Agenta MCP",
    host=os.getenv("MCP_HOST", "0.0.0.0"),
    port=_port_from_env(),
    stateless_http=True,
    json_response=True,
)


def _client() -> AgentaClient:
    return AgentaClient()


def _windowing(
    limit: int | None = None, next: str | None = None
) -> dict[str, Any] | None:
    payload = {"limit": limit, "next": next}
    clean = {key: value for key, value in payload.items() if value is not None}
    return clean or None


def _base_payload(
    *,
    name: str | None = None,
    description: str | None = None,
    slug: str | None = None,
    flags: dict[str, Any] | None = None,
    tags: dict[str, Any] | None = None,
    meta: dict[str, Any] | None = None,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        key: value
        for key, value in {
            "name": name,
            "description": description,
            "slug": slug,
            "flags": flags,
            "tags": tags,
            "meta": meta,
            "data": data,
        }.items()
        if value is not None
    }


def _merge_dicts(*values: dict[str, Any] | None) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for value in values:
        if value:
            merged.update(value)
    return merged


def _known_application_flags(flags: dict[str, Any]) -> dict[str, Any]:
    known = {
        "is_application",
        "is_evaluator",
        "is_snippet",
        "is_managed",
        "is_custom",
        "is_llm",
        "is_hook",
        "is_code",
        "is_match",
        "is_feedback",
        "is_chat",
        "has_url",
        "has_script",
        "has_handler",
    }
    return {key: value for key, value in flags.items() if key in known}


AUTO_EVALUATOR_TEMPLATE_KEYS: dict[str, str] = {
    "exact_match": "auto_exact_match",
    "exact-match": "auto_exact_match",
    "auto_exact_match": "auto_exact_match",
    "contains_json": "auto_contains_json",
    "contains-json": "auto_contains_json",
    "auto_contains_json": "auto_contains_json",
    "llm_as_a_judge": "auto_ai_critique",
    "llm-as-a-judge": "auto_ai_critique",
    "ai_critique": "auto_ai_critique",
    "auto_ai_critique": "auto_ai_critique",
    "regex": "auto_regex_test",
    "regex_test": "auto_regex_test",
    "auto_regex_test": "auto_regex_test",
    "json_multi_field_match": "json_multi_field_match",
    "json-diff": "auto_json_diff",
    "json_diff": "auto_json_diff",
    "auto_json_diff": "auto_json_diff",
    "levenshtein": "auto_levenshtein_distance",
    "levenshtein_distance": "auto_levenshtein_distance",
    "auto_levenshtein_distance": "auto_levenshtein_distance",
    "similarity": "auto_similarity_match",
    "similarity_match": "auto_similarity_match",
    "auto_similarity_match": "auto_similarity_match",
    "semantic_similarity": "auto_semantic_similarity",
    "semantic-similarity": "auto_semantic_similarity",
    "auto_semantic_similarity": "auto_semantic_similarity",
    "webhook": "auto_webhook_test",
    "webhook_test": "auto_webhook_test",
    "auto_webhook_test": "auto_webhook_test",
    "custom_code": "auto_custom_code_run",
    "custom-code": "auto_custom_code_run",
    "custom_code_run": "auto_custom_code_run",
    "auto_custom_code_run": "auto_custom_code_run",
}


def _resolve_auto_evaluator_template_key(auto_evaluator_type: str | None) -> str | None:
    if not auto_evaluator_type:
        return None
    normalized = auto_evaluator_type.strip().lower().replace(" ", "_")
    return AUTO_EVALUATOR_TEMPLATE_KEYS.get(normalized, normalized)


async def _application_catalog_defaults(
    *,
    client: AgentaClient,
    template_key: str | None,
    preset_key: str | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if not template_key:
        return {}, {}

    template_response = await client.get_application_template(template_key)
    template = template_response.get("template") or {}
    template_data = dict(template.get("data") or {})
    template_flags = dict(template.get("flags") or {})

    if not preset_key:
        return template_data, _known_application_flags(template_flags)

    preset_response = await client.get_application_preset(
        template_key=template_key,
        preset_key=preset_key,
    )
    preset = preset_response.get("preset") or {}
    preset_data = dict(preset.get("data") or {})
    preset_flags = dict(preset.get("flags") or {})

    data = {
        "uri": preset_data.get("uri") or template_data.get("uri"),
        "parameters": _merge_dicts(
            template_data.get("parameters"),
            preset_data.get("parameters"),
        )
        or None,
        "schemas": template_data.get("schemas"),
    }
    return (
        {key: value for key, value in data.items() if value is not None},
        _known_application_flags(
            _merge_dicts(
                template_flags,
                preset_flags,
            )
        ),
    )


async def _evaluator_catalog_defaults(
    *,
    client: AgentaClient,
    evaluator_type: str | None,
    auto_evaluator_type: str | None,
    template_key: str | None,
    preset_key: str | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    resolved_template_key = template_key
    resolved_preset_key = preset_key

    if evaluator_type == "auto":
        resolved_template_key = resolved_template_key or _resolve_auto_evaluator_template_key(
            auto_evaluator_type
        )
        if not resolved_template_key:
            raise ValueError(
                "auto evaluators require auto_evaluator_type or template_key"
            )
    elif evaluator_type == "human":
        resolved_template_key = resolved_template_key or "feedback"
        resolved_preset_key = resolved_preset_key or "quality-rating"
    elif not resolved_template_key and not resolved_preset_key:
        return {}, {}

    if not resolved_template_key:
        raise ValueError("preset_key requires template_key")

    template_response = await client.get_evaluator_template(resolved_template_key)
    template = template_response.get("template") or {}
    template_data = dict(template.get("data") or {})
    template_flags = dict(template.get("flags") or {})

    if not resolved_preset_key:
        return template_data, _known_application_flags(template_flags)

    preset_response = await client.get_evaluator_preset(
        template_key=resolved_template_key,
        preset_key=resolved_preset_key,
    )
    preset = preset_response.get("preset") or {}
    preset_data = dict(preset.get("data") or {})
    preset_flags = dict(preset.get("flags") or {})
    data = {
        "uri": preset_data.get("uri") or template_data.get("uri"),
        "parameters": _merge_dicts(
            template_data.get("parameters"),
            preset_data.get("parameters"),
        )
        or None,
        "schemas": preset_data.get("schemas") or template_data.get("schemas"),
    }
    return (
        {key: value for key, value in data.items() if value is not None},
        _known_application_flags(_merge_dicts(template_flags, preset_flags)),
    )


@mcp.tool()
async def list_applications(
    limit: int | None = 20,
    next: str | None = None,
    include_archived: bool = False,
    filter: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """List Agenta applications from `POST /simple/applications/query`.

    Use this before creating evaluations or editing prompts. `filter` is the
    confirmed simple application filter passthrough for fields such as `slug`,
    `slugs`, `flags`, and `meta`. Pagination uses `windowing.limit` and
    `windowing.next`; do not use page numbers.
    """

    return await _client().query(
        "application",
        filter=filter,
        include_archived=include_archived,
        windowing=_windowing(limit, next),
    )


@mcp.tool()
async def get_application(application_id: str) -> dict[str, Any]:
    """Fetch one application by UUID from `GET /simple/applications/{id}`.

    The response includes the current `variant_id`, `revision_id`, and merged
    `data` with `parameters` and `schemas` when the application has them.
    """

    return await _client().get("application", application_id)


@mcp.tool()
async def get_application_schema(application_id: str) -> dict[str, Any]:
    """Return the current application schema and parameter defaults.

    This fetches the simple application and extracts `application.data.schemas`
    (`parameters`, `inputs`, `outputs`) plus current `application.data.parameters`.
    Use this before `update_application_prompt` so edits preserve the existing
    config shape.
    """

    response = await _client().get("application", application_id)
    application = response.get("application") or {}
    data = application.get("data") or {}
    return {
        "count": 1 if application else 0,
        "application_id": application.get("id"),
        "revision_id": application.get("revision_id"),
        "schemas": data.get("schemas"),
        "parameters": data.get("parameters"),
    }


@mcp.tool()
async def list_application_templates(include_archived: bool = False) -> dict[str, Any]:
    """List application catalog templates such as `chat` and `completion`.

    Use this before creating a prompt app when you need to choose the runnable
    type. Templates include `data.uri`, `data.parameters`, `data.schemas`, and
    flags consumed by `create_application`.
    """

    return await _client().list_application_templates(
        include_archived=include_archived,
    )


@mcp.tool()
async def list_application_presets(
    template_key: str,
    include_archived: bool = False,
) -> dict[str, Any]:
    """List catalog presets for one application template.

    Presets override the template's default parameters while keeping the
    template schemas. Pass the selected `preset_key` to `create_application`.
    """

    return await _client().list_application_presets(
        template_key=template_key,
        include_archived=include_archived,
    )


@mcp.tool()
async def create_application(
    name: str,
    slug: str | None = None,
    description: str | None = None,
    app_type: Literal["chat", "completion", "custom"] | None = None,
    template_key: str | None = None,
    preset_key: str | None = None,
    uri: str | None = None,
    parameters: dict[str, Any] | None = None,
    schemas: dict[str, Any] | None = None,
    flags: dict[str, Any] | None = None,
    tags: dict[str, Any] | None = None,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create an application artifact, default variant, and first revision.

    `app_type` is the user-facing selector: `chat`, `completion`, or `custom`.
    If omitted, this falls back to `completion`. Chat/completion use catalog
    defaults so the created revision loads with runnable prompt/model config.
    Custom apps require an explicit `uri`; optional `parameters` and `schemas`
    are passed through. `template_key` remains an advanced override.
    """

    resolved_template_key = template_key
    if resolved_template_key is None and app_type != "custom":
        resolved_template_key = app_type or "completion"

    if app_type == "custom" and not uri:
        raise ValueError("custom applications require an explicit uri")

    client = _client()
    catalog_data, catalog_flags = await _application_catalog_defaults(
        client=client,
        template_key=resolved_template_key,
        preset_key=preset_key,
    )

    merged_flags = _merge_dicts(
        _known_application_flags(catalog_flags),
        {
            "is_application": True,
            "is_evaluator": False,
            "is_snippet": False,
        },
        _known_application_flags(flags or {}),
    )
    merged_parameters = _merge_dicts(
        catalog_data.get("parameters"),
        parameters,
    )
    data = {
        key: value
        for key, value in {
            "uri": uri or catalog_data.get("uri"),
            "parameters": merged_parameters or None,
            "schemas": schemas or catalog_data.get("schemas"),
        }.items()
        if value is not None
    }
    return await client.create(
        "application",
        _base_payload(
            name=name,
            slug=slug,
            description=description,
            flags=merged_flags,
            tags=tags,
            meta=meta,
            data=data or None,
        ),
    )


@mcp.tool()
async def update_application_prompt(
    application_id: str,
    prompt: Any,
    parameter_key: str = "prompt",
) -> dict[str, Any]:
    """Update one prompt/config field in `application.data.parameters`.

    This is a reversible authoring edit via `PUT /simple/applications/{id}`. It
    first fetches the application, preserves existing `data`, then sets
    `data.parameters[parameter_key] = prompt`. Use `get_application_schema` to
    inspect valid parameter keys before calling.
    """

    current = await _client().get("application", application_id)
    application = current.get("application") or {}
    data = dict(application.get("data") or {})
    parameters = dict(data.get("parameters") or {})
    parameters[parameter_key] = prompt
    data["parameters"] = parameters
    return await _client().edit(
        "application",
        application_id,
        {"id": application_id, "data": data},
    )


@mcp.tool()
async def list_evaluator_templates(include_archived: bool = False) -> dict[str, Any]:
    """List evaluator catalog templates, including auto and human evaluators.

    Auto evaluator template keys include `auto_exact_match`,
    `auto_contains_json`, and `auto_ai_critique` (LLM-as-a-judge). Human
    evaluators use the `feedback` template plus a preset such as
    `quality-rating`. Use `list_evaluator_presets` for preset discovery.
    """

    return await _client().list_evaluator_templates(include_archived=include_archived)


@mcp.tool()
async def list_evaluator_presets(
    template_key: str,
    include_archived: bool = False,
) -> dict[str, Any]:
    """List presets for one evaluator template.

    Use this for human feedback evaluators (`template_key="feedback"`) and any
    auto evaluator template that exposes named starting configurations.
    """

    return await _client().list_evaluator_presets(
        template_key=template_key,
        include_archived=include_archived,
    )


@mcp.tool()
async def list_evaluators(
    limit: int | None = 20,
    next: str | None = None,
    include_archived: bool = False,
    filter: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """List evaluator artifacts from `POST /simple/evaluators/query`.

    `filter` is a confirmed passthrough for evaluator attributes such as slug,
    flags, and meta. Returned rows include current revision `data.parameters`.
    """

    return await _client().query(
        "evaluator",
        filter=filter,
        include_archived=include_archived,
        windowing=_windowing(limit, next),
    )


@mcp.tool()
async def get_evaluator(evaluator_id: str) -> dict[str, Any]:
    """Fetch one evaluator by UUID from `GET /simple/evaluators/{id}`."""

    return await _client().get("evaluator", evaluator_id)


@mcp.tool()
async def create_evaluator(
    name: str,
    uri: str | None = None,
    evaluator_type: Literal["auto", "human"] | None = None,
    auto_evaluator_type: Literal[
        "exact_match",
        "contains_json",
        "llm_as_a_judge",
        "regex",
        "json_multi_field_match",
        "json_diff",
        "levenshtein_distance",
        "similarity_match",
        "semantic_similarity",
        "webhook",
        "custom_code",
    ]
    | None = None,
    template_key: str | None = None,
    preset_key: str | None = None,
    parameters: dict[str, Any] | None = None,
    slug: str | None = None,
    description: str | None = None,
    schemas: dict[str, Any] | None = None,
    flags: dict[str, Any] | None = None,
    tags: dict[str, Any] | None = None,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create an auto or human evaluator.

    For AI agents: ask whether the evaluator is `auto` or `human`. If auto,
    ask for `auto_evaluator_type` such as `exact_match`, `contains_json`, or
    `llm_as_a_judge`. If human, this defaults to the `feedback` template with
    `quality-rating` preset. Use `template_key`, `preset_key`, or `uri` only
    for advanced overrides.
    """

    if not uri and not evaluator_type and not template_key:
        raise ValueError(
            "create_evaluator requires evaluator_type, template_key, or uri"
        )

    client = _client()
    catalog_data, catalog_flags = await _evaluator_catalog_defaults(
        client=client,
        evaluator_type=evaluator_type,
        auto_evaluator_type=auto_evaluator_type,
        template_key=template_key,
        preset_key=preset_key,
    )
    merged_flags = _merge_dicts(
        _known_application_flags(catalog_flags),
        {
            "is_application": False,
            "is_evaluator": True,
            "is_snippet": False,
        },
        _known_application_flags(flags or {}),
    )
    merged_parameters = _merge_dicts(
        catalog_data.get("parameters"),
        parameters,
    )
    data = {
        key: value
        for key, value in {
            "uri": uri or catalog_data.get("uri"),
            "parameters": merged_parameters or None,
            "schemas": schemas or catalog_data.get("schemas"),
        }.items()
        if value is not None
    }
    return await client.create(
        "evaluator",
        _base_payload(
            name=name,
            slug=slug,
            description=description,
            flags=merged_flags,
            tags=tags,
            meta=meta,
            data=data,
        ),
    )


@mcp.tool()
async def list_testsets(
    limit: int | None = 20,
    next: str | None = None,
    include_archived: bool = False,
    filter: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """List testsets from `POST /simple/testsets/query`.

    Returned testsets include latest revision rows under `data.testcases`.
    """

    return await _client().query(
        "testset",
        filter=filter,
        include_archived=include_archived,
        windowing=_windowing(limit, next),
    )


@mcp.tool()
async def get_testset(testset_id: str) -> dict[str, Any]:
    """Fetch one testset by UUID from `GET /simple/testsets/{id}`."""

    return await _client().get("testset", testset_id)


@mcp.tool()
async def create_testset(
    name: str,
    testcases: list[dict[str, Any]],
    slug: str | None = None,
    description: str | None = None,
    tags: dict[str, Any] | None = None,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a testset with inline rows in `data.testcases`.

    Each testcase may be either a full testcase object or a simple row. Simple
    rows are wrapped as `{ "data": row }`, because confirmed testcase row
    values live in `testcase.data`.
    """

    normalized = [row if "data" in row else {"data": row} for row in testcases]
    return await _client().create(
        "testset",
        _base_payload(
            name=name,
            slug=slug,
            description=description,
            tags=tags,
            meta=meta,
            data={"testcases": normalized},
        ),
    )


@mcp.tool()
async def upload_testset_file(
    file_path: str,
    file_type: Literal["csv", "json"] = "csv",
    testset_id: str | None = None,
    testset_slug: str | None = None,
    testset_name: str | None = None,
    testset_description: str | None = None,
    testset_tags: str | None = None,
    testset_meta: str | None = None,
) -> dict[str, Any]:
    """Upload a CSV or JSON testset file via the simple upload endpoint.

    If `testset_id` is provided, uploads a new revision to that testset. If it
    is omitted, creates a new testset and accepts `testset_slug`,
    `testset_name`, `testset_description`, `testset_tags`, and `testset_meta`
    form fields as confirmed by the OpenAPI multipart schema.
    """

    return await _client().upload_testset_file(
        file_path=file_path,
        file_type=file_type,
        testset_id=testset_id,
        testset_slug=testset_slug,
        testset_name=testset_name,
        testset_description=testset_description,
        testset_tags=testset_tags,
        testset_meta=testset_meta,
    )


@mcp.tool()
async def list_evaluations(
    limit: int | None = 20,
    next: str | None = None,
    filter: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """List evaluation configs/runs from `POST /simple/evaluations/query`.

    Simple evaluation query supports only `evaluation` and `windowing`; there
    is no `include_archived` or `evaluation_refs` field in the confirmed schema.
    """

    return await _client().query(
        "evaluation", filter=filter, windowing=_windowing(limit, next)
    )


@mcp.tool()
async def get_evaluation(evaluation_id: str) -> dict[str, Any]:
    """Fetch one evaluation config/run by UUID from `GET /simple/evaluations/{id}`."""

    return await _client().get("evaluation", evaluation_id)


@mcp.tool()
async def create_evaluation(
    name: str,
    application_revision_ids: list[str],
    evaluator_revision_ids: list[str],
    testset_revision_id: str | None = None,
    repeats: int | None = None,
    description: str | None = None,
    flags: dict[str, Any] | None = None,
    tags: dict[str, Any] | None = None,
    meta: dict[str, Any] | None = None,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create an evaluation configuration without starting execution.

    Confirmed simple step shape is `{revision_id: "auto"}` for testset,
    application, and evaluator revision IDs. This tool wires
    `testset_steps`, `application_steps`, and `evaluator_steps` from revision
    IDs. Optional `data` is a passthrough for other confirmed simple evaluation
    fields such as `query_steps`, explicit origins (`custom`/`human`/`auto`),
    `status`, or `repeats`; provided ID arguments take precedence.
    """

    eval_data = dict(data or {})
    if testset_revision_id:
        eval_data["testset_steps"] = {testset_revision_id: "auto"}
    eval_data["application_steps"] = {
        revision_id: "auto" for revision_id in application_revision_ids
    }
    eval_data["evaluator_steps"] = {
        revision_id: "auto" for revision_id in evaluator_revision_ids
    }
    if repeats is not None:
        eval_data["repeats"] = repeats
    merged_flags = {
        "is_live": False,
        "is_active": True,
        "is_closed": False,
        **(flags or {}),
    }
    payload = {
        key: value
        for key, value in {
            "name": name,
            "description": description,
            "flags": merged_flags,
            "tags": tags,
            "meta": meta,
            "data": eval_data,
        }.items()
        if value is not None
    }
    return await _client().create("evaluation", payload)


@mcp.tool()
async def list_environments(
    limit: int | None = 20,
    next: str | None = None,
    include_archived: bool = False,
    filter: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """List environments from `POST /simple/environments/query`.

    v1 is read-only for environments. Environment `data.references` can show
    which resources an environment points at, but this server does not deploy,
    guard, unguard, archive, or edit environments.
    """

    return await _client().query(
        "environment",
        filter=filter,
        include_archived=include_archived,
        windowing=_windowing(limit, next),
    )


def main() -> None:
    """Run the MCP server.

    Defaults to stdio; set AGENTA_MCP_TRANSPORT=streamable-http for HTTP.
    """

    transport = os.getenv("AGENTA_MCP_TRANSPORT", "stdio") or "stdio"
    mcp.run(transport=transport)


if __name__ == "__main__":
    main()
