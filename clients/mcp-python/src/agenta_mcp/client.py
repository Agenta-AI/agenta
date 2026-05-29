"""MCP-agnostic async Agenta API client for the simple authoring surface."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import httpx

from .config import Settings


RESOURCE_PLURALS: dict[str, str] = {
    "application": "applications",
    "evaluator": "evaluators",
    "testset": "testsets",
    "evaluation": "evaluations",
    "environment": "environments",
}


class AgentaError(RuntimeError):
    """Normalized, model-readable Agenta API error."""


def _clean_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}


def _flatten_detail(detail: Any) -> str:
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list):
        return "; ".join(_flatten_detail(item) for item in detail)
    if isinstance(detail, dict):
        message = detail.get("msg") or detail.get("message") or detail.get("detail")
        loc = detail.get("loc")
        if message and loc:
            loc_text = ".".join(str(part) for part in loc)
            return f"{loc_text}: {message}"
        if message:
            return str(message)
        return ", ".join(
            f"{key}={_flatten_detail(value)}" for key, value in detail.items()
        )
    return str(detail)


class AgentaClient:
    """Small async HTTP client for Agenta's `/simple/*` API facade.

    This core deliberately has no MCP imports so agent loops can import and use
    it directly.
    """

    def __init__(self, settings: Settings | None = None, timeout: float = 30.0):
        self.settings = settings or Settings.from_env()
        self.timeout = timeout

    @property
    def headers(self) -> dict[str, str]:
        return {
            "Authorization": self.settings.authorization_value,
            "Accept": "application/json",
        }

    def _url(self, path: str) -> str:
        return f"{self.settings.api_url}/{path.lstrip('/')}"

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        files: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        headers = self.headers
        if files is None:
            headers = {**headers, "Content-Type": "application/json"}

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.request(
                    method,
                    self._url(path),
                    headers=headers,
                    json=json,
                    params=_clean_payload(params or {}),
                    data=data,
                    files=files,
                )
            except httpx.HTTPError as exc:
                raise AgentaError(f"Agenta API request failed: {exc}") from exc

        if response.is_error:
            raise AgentaError(self._error_message(response))

        if not response.content:
            return {}

        try:
            data = response.json()
        except ValueError as exc:
            raise AgentaError(
                f"Agenta API returned non-JSON response: {response.text[:500]}"
            ) from exc

        if isinstance(data, dict):
            return data
        return {"data": data}

    def _error_message(self, response: httpx.Response) -> str:
        prefix = f"Agenta API error {response.status_code}"
        try:
            payload = response.json()
        except ValueError:
            return f"{prefix}: {response.text[:500]}"

        if isinstance(payload, dict) and "detail" in payload:
            return f"{prefix}: {_flatten_detail(payload['detail'])}"
        return f"{prefix}: {_flatten_detail(payload)}"

    def _plural(self, resource: str) -> str:
        try:
            return RESOURCE_PLURALS[resource]
        except KeyError as exc:
            raise ValueError(f"Unsupported resource {resource!r}") from exc

    async def create(self, resource: str, payload: dict[str, Any]) -> dict[str, Any]:
        plural = self._plural(resource)
        return await self._request("POST", f"/simple/{plural}/", json={resource: payload})

    async def get(self, resource: str, resource_id: str) -> dict[str, Any]:
        plural = self._plural(resource)
        return await self._request("GET", f"/simple/{plural}/{resource_id}")

    async def edit(
        self, resource: str, resource_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        plural = self._plural(resource)
        return await self._request(
            "PUT", f"/simple/{plural}/{resource_id}", json={resource: payload}
        )

    async def query(
        self,
        resource: str,
        *,
        filter: dict[str, Any] | None = None,
        refs: Sequence[Mapping[str, Any]] | None = None,
        include_archived: bool | None = None,
        windowing: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        plural = self._plural(resource)
        body: dict[str, Any] = {resource: filter or {}}
        if resource != "evaluation":
            body[f"{resource}_refs"] = list(refs) if refs is not None else None
            body["include_archived"] = include_archived
        body["windowing"] = windowing
        return await self._request(
            "POST", f"/simple/{plural}/query", json=_clean_payload(body)
        )

    async def list_evaluator_templates(
        self, *, include_archived: bool = False
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            "/evaluators/catalog/templates/",
            params={"include_archived": include_archived},
        )

    async def get_evaluator_template(self, template_key: str) -> dict[str, Any]:
        return await self._request(
            "GET",
            f"/evaluators/catalog/templates/{template_key}",
        )

    async def list_evaluator_presets(
        self, *, template_key: str, include_archived: bool = False
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            f"/evaluators/catalog/templates/{template_key}/presets/",
            params={"include_archived": include_archived},
        )

    async def get_evaluator_preset(
        self, *, template_key: str, preset_key: str
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            f"/evaluators/catalog/templates/{template_key}/presets/{preset_key}",
        )

    async def list_application_templates(
        self, *, include_archived: bool = False
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            "/workflows/catalog/templates/",
            params={"is_application": True, "include_archived": include_archived},
        )

    async def get_application_template(self, template_key: str) -> dict[str, Any]:
        return await self._request(
            "GET",
            f"/applications/catalog/templates/{template_key}",
        )

    async def list_application_presets(
        self, *, template_key: str, include_archived: bool = False
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            f"/applications/catalog/templates/{template_key}/presets/",
            params={"include_archived": include_archived},
        )

    async def get_application_preset(
        self, *, template_key: str, preset_key: str
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            f"/applications/catalog/templates/{template_key}/presets/{preset_key}",
        )

    async def upload_testset_file(
        self,
        *,
        file_path: str,
        file_type: str = "csv",
        testset_id: str | None = None,
        testset_slug: str | None = None,
        testset_name: str | None = None,
        testset_description: str | None = None,
        testset_tags: str | None = None,
        testset_meta: str | None = None,
    ) -> dict[str, Any]:
        path = (
            f"/simple/testsets/{testset_id}/upload"
            if testset_id
            else "/simple/testsets/upload"
        )
        form_fields = _clean_payload(
            {
                "file_type": file_type,
                "testset_slug": None if testset_id else testset_slug,
                "testset_name": testset_name,
                "testset_description": testset_description,
                "testset_tags": testset_tags,
                "testset_meta": testset_meta,
            }
        )
        with open(file_path, "rb") as file_obj:
            files = {"file": (file_path.rsplit("/", 1)[-1], file_obj)}
            return await self._request("POST", path, data=form_fields, files=files)
