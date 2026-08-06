from typing import Any, Dict, Iterable, Optional
from uuid import UUID

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


def _environment_slug(value: Any) -> Optional[Any]:
    if isinstance(value, dict):
        return value.get("slug") or value.get("name")
    return value


LEGACY_REFERENCE_FIELDS = (
    ("application", "id", "application_id", "application_id", None),
    ("application", "id", "app_id", "application_id", None),
    ("application", "slug", "application_slug", None, None),
    ("application", "slug", "app_slug", None, None),
    ("application", "slug", "app", None, None),
    ("application_variant", "id", "variant_id", None, None),
    ("application_variant", "slug", "variant_slug", None, None),
    ("application_revision", "version", "variant_version", None, str),
    ("environment", "id", "environment_id", None, None),
    ("environment", "slug", "environment_slug", None, None),
    ("environment_revision", "version", "environment_version", None, str),
    ("environment", "slug", "environment", None, _environment_slug),
)


def _without_empty(value: Any) -> Any:
    if isinstance(value, dict):
        cleaned = {
            key: _without_empty(item) for key, item in value.items() if item is not None
        }
        return {key: item for key, item in cleaned.items() if item not in ({}, [])}
    if isinstance(value, list):
        return [_without_empty(item) for item in value if item is not None]
    return value


def _reference_value(
    body: Dict[str, Any],
    query: Dict[str, str],
    body_key: str,
    query_key: Optional[str] = None,
) -> Optional[Any]:
    value = body.get(body_key)
    if value is not None:
        return value
    return query.get(query_key or body_key)


def _selector_key(
    *,
    body: Dict[str, Any],
    query: Dict[str, str],
    references: Dict[str, Any],
) -> Optional[str]:
    selector = body.get("selector")
    if isinstance(selector, dict) and selector.get("key"):
        return selector["key"]

    for key in ("key", "selector_key"):
        value = _reference_value(body, query, key)
        if value:
            return value

    has_environment_refs = any(
        references.get(ref_name)
        for ref_name in (
            "environment",
            "environment_variant",
            "environment_revision",
        )
    )
    has_application_revision_refs = any(
        references.get(ref_name)
        for ref_name in (
            "application_variant",
            "application_revision",
        )
    )

    application_slug = (references.get("application") or {}).get("slug")
    if has_environment_refs and not has_application_revision_refs and application_slug:
        return f"{application_slug}.revision"

    return None


def build_legacy_invoke_payload(
    *,
    body: Dict[str, Any],
    query: Dict[str, str],
) -> Dict[str, Any]:
    inputs = dict(body.get("inputs") or {})
    if "messages" in body:
        inputs["messages"] = body.get("messages")

    references = {}
    for ref_name, ref_field, body_key, query_key, transform in LEGACY_REFERENCE_FIELDS:
        value = _reference_value(body, query, body_key, query_key)
        if value is None:
            continue
        if transform is not None:
            value = transform(value)
        if value is None:
            continue
        references.setdefault(ref_name, {})[ref_field] = value

    references = _without_empty(references)
    selector_key = _selector_key(body=body, query=query, references=references)

    return _without_empty(
        {
            "data": {
                "inputs": inputs,
                "parameters": body.get("ag_config"),
            },
            "references": references,
            "selector": {
                "key": selector_key,
            },
        }
    )


def legacy_response(payload: Dict[str, Any]) -> Dict[str, Any]:
    outputs = (payload.get("data") or {}).get("outputs")
    trace_id = payload.get("trace_id")

    try:
        tree_id = str(UUID(trace_id)) if trace_id else None
    except ValueError:
        tree_id = trace_id

    return {
        "version": "3.0",
        "data": outputs,
        "content_type": "text/plain"
        if isinstance(outputs, str)
        else "application/json",
        "tree": None,
        "tree_id": tree_id,
        "trace_id": trace_id,
        "span_id": payload.get("span_id"),
    }


async def legacy_invoke(
    *,
    app: FastAPI,
    service: str,
    target_version: str,
    request: Request,
) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:
        body = {}

    payload = build_legacy_invoke_payload(
        body=body if isinstance(body, dict) else {},
        query=dict(request.query_params),
    )

    headers = {}
    if authorization := request.headers.get("authorization"):
        headers["authorization"] = authorization

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://services.local",
    ) as client:
        response = await client.post(
            f"/{service}/{target_version}/invoke",
            json=payload,
            headers=headers,
        )

    response_payload = response.json()
    if response.status_code >= 400:
        return JSONResponse(response_payload, status_code=response.status_code)

    return JSONResponse(
        legacy_response(response_payload),
        status_code=response.status_code,
    )


def legacy_endpoint(*, app: FastAPI, service: str, target_version: str):
    async def endpoint(request: Request) -> JSONResponse:
        return await legacy_invoke(
            app=app,
            service=service,
            target_version=target_version,
            request=request,
        )

    return endpoint


def register_legacy_routes(
    *,
    app: FastAPI,
    services: Iterable[str],
    paths: Iterable[str],
    target_version: str,
) -> None:
    for service in services:
        for path in paths:
            app.add_api_route(
                f"/{service}/{path}",
                legacy_endpoint(
                    app=app,
                    service=service,
                    target_version=target_version,
                ),
                methods=["POST"],
                name=f"{service}_{path}",
            )
