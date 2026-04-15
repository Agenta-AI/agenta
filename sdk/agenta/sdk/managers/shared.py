from typing import Any, Dict, Optional
from uuid import uuid4

from agenta.sdk.utils.client import authed_api, authed_async_api
from agenta.sdk.utils.exceptions import handle_exceptions
from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.types import ConfigurationResponse, DeploymentResponse

log = get_module_logger(__name__)


def _response_detail(response) -> str:
    try:
        data = response.json()
    except Exception:
        return response.text

    if isinstance(data, dict) and "detail" in data:
        detail = data.get("detail")
        if isinstance(detail, str):
            return detail
        return str(detail)

    return str(data)


def _raise_for_status(response) -> None:
    try:
        response.raise_for_status()
    except Exception as exc:
        raise ValueError(_response_detail(response)) from exc


def _reference_payload(
    *,
    id: Optional[str] = None,
    slug: Optional[str] = None,
    version: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    if id is None and slug is None and version is None:
        return None

    payload: Dict[str, Any] = {}
    if id is not None:
        payload["id"] = id
    if slug is not None:
        payload["slug"] = slug
    if version is not None:
        payload["version"] = str(version)
    return payload


def _flatten_revision_response(
    *,
    application_revision: Dict[str, Any],
    environment_revision: Optional[Dict[str, Any]] = None,
    app_slug: Optional[str] = None,
    variant_slug: Optional[str] = None,
    environment_slug: Optional[str] = None,
) -> Dict[str, Any]:
    data = application_revision.get("data") or {}
    params = data.get("parameters") or {}

    flattened: Dict[str, Any] = {
        "app_id": application_revision.get("application_id")
        or application_revision.get("artifact_id"),
        "app_slug": app_slug or application_revision.get("application_slug"),
        "variant_id": application_revision.get("application_variant_id")
        or application_revision.get("variant_id"),
        "variant_slug": variant_slug or application_revision.get("variant_slug"),
        "variant_version": application_revision.get("version"),
        "committed_at": application_revision.get("updated_at")
        or application_revision.get("created_at"),
        "committed_by": application_revision.get("updated_by"),
        "committed_by_id": application_revision.get("updated_by_id"),
        "params": params,
    }

    if environment_slug:
        flattened["environment_slug"] = environment_slug

    if environment_revision:
        flattened.update(
            {
                "environment_id": environment_revision.get("environment_id")
                or environment_revision.get("artifact_id"),
                "environment_slug": environment_slug
                or environment_revision.get("environment_slug"),
                "environment_version": environment_revision.get("version"),
                "deployed_at": environment_revision.get("updated_at")
                or environment_revision.get("created_at"),
                "deployed_by": environment_revision.get("updated_by"),
                "deployed_by_id": environment_revision.get("updated_by_id"),
            }
        )

    return flattened


def _empty_configuration_response(
    *,
    app_id: Optional[str] = None,
    app_slug: Optional[str] = None,
    variant_id: Optional[str] = None,
    variant_slug: Optional[str] = None,
) -> ConfigurationResponse:
    return ConfigurationResponse(
        app_id=app_id,
        app_slug=app_slug,
        variant_id=variant_id,
        variant_slug=variant_slug,
        variant_version=None,
        committed_at=None,
        committed_by=None,
        committed_by_id=None,
        deployed_at=None,
        deployed_by=None,
        deployed_by_id=None,
        params={},
    )


def _raise_revision_not_found(
    *,
    app_id: Optional[str] = None,
    app_slug: Optional[str] = None,
    variant_id: Optional[str] = None,
    variant_slug: Optional[str] = None,
    variant_version: Optional[int] = None,
) -> None:
    parts = []
    if app_id:
        parts.append(f"app_id={app_id}")
    if app_slug:
        parts.append(f"app_slug={app_slug}")
    if variant_id:
        parts.append(f"variant_id={variant_id}")
    if variant_slug:
        parts.append(f"variant_slug={variant_slug}")
    if variant_version is not None:
        parts.append(f"variant_version={variant_version}")

    details = ", ".join(parts) if parts else "provided references"
    raise ValueError(f"Application revision not found for {details}.")


def _revision_has_parameters(revision: Optional[Dict[str, Any]]) -> bool:
    if not revision:
        return False

    data = revision.get("data") or {}
    parameters = data.get("parameters") if isinstance(data, dict) else None
    return bool(parameters)


class SharedManager:
    @classmethod
    def _parse_fetch_request(
        cls,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
    ):
        if variant_slug and not (app_id or app_slug):
            raise ValueError("`variant_slug` requires `app_id` or `app_slug`")
        if variant_version and not variant_slug:
            raise ValueError("`variant_version` requires `variant_slug`")
        if environment_slug and not (app_id or app_slug):
            raise ValueError("`environment_slug` requires `app_id` or `app_slug`")
        if environment_version and not environment_slug:
            raise ValueError("`environment_version` requires `environment_slug`")

        return {
            "app_id": app_id,
            "app_slug": app_slug,
            "variant_id": variant_id,
            "variant_slug": variant_slug,
            "variant_version": variant_version,
            "environment_id": environment_id,
            "environment_slug": environment_slug,
            "environment_version": environment_version,
        }

    @classmethod
    def _build_application_ref(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        return _reference_payload(id=app_id, slug=app_slug)

    @classmethod
    def _build_variant_ref(
        cls,
        *,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        return _reference_payload(id=variant_id, slug=variant_slug)

    @classmethod
    def _build_revision_ref(
        cls,
        *,
        variant_version: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        return _reference_payload(version=variant_version)

    @classmethod
    def _build_environment_ref(
        cls,
        *,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        return _reference_payload(
            id=environment_id,
            slug=environment_slug,
            version=environment_version,
        )

    @classmethod
    def _query_simple_application(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ) -> Dict[str, Any]:
        if app_id:
            response = authed_api()(
                method="GET",
                endpoint=f"/preview/simple/applications/{app_id}",
            )
            _raise_for_status(response)
            application = response.json().get("application")
            if not application:
                raise ValueError(f"Application '{app_id}' not found.")
            return application

        response = authed_api()(
            method="POST",
            endpoint="/preview/simple/applications/query",
            json={"application": {"slug": app_slug}},
        )
        _raise_for_status(response)
        applications = response.json().get("applications") or []
        if not applications:
            raise ValueError(f"Application '{app_slug}' not found.")
        return applications[0]

    @classmethod
    async def _aquery_simple_application(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ) -> Dict[str, Any]:
        if app_id:
            response = await authed_async_api()(
                method="GET",
                endpoint=f"/preview/simple/applications/{app_id}",
            )
            _raise_for_status(response)
            application = response.json().get("application")
            if not application:
                raise ValueError(f"Application '{app_id}' not found.")
            return application

        response = await authed_async_api()(
            method="POST",
            endpoint="/preview/simple/applications/query",
            json={"application": {"slug": app_slug}},
        )
        _raise_for_status(response)
        applications = response.json().get("applications") or []
        if not applications:
            raise ValueError(f"Application '{app_slug}' not found.")
        return applications[0]

    @classmethod
    def _query_simple_environment(
        cls,
        *,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
    ) -> Dict[str, Any]:
        response = authed_api()(
            method="POST",
            endpoint="/preview/simple/environments/query",
            json={
                "environment": {
                    "slug": environment_slug,
                },
                "environment_refs": (
                    [
                        _reference_payload(
                            id=environment_id,
                            slug=environment_slug,
                            version=environment_version,
                        )
                    ]
                    if environment_id
                    or environment_slug
                    or environment_version is not None
                    else None
                ),
            },
        )
        _raise_for_status(response)
        environments = response.json().get("environments") or []
        if not environments:
            target = environment_id or environment_slug or environment_version
            raise ValueError(f"Environment '{target}' not found.")
        return environments[0]

    @classmethod
    async def _aquery_simple_environment(
        cls,
        *,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
    ) -> Dict[str, Any]:
        response = await authed_async_api()(
            method="POST",
            endpoint="/preview/simple/environments/query",
            json={
                "environment": {
                    "slug": environment_slug,
                },
                "environment_refs": (
                    [
                        _reference_payload(
                            id=environment_id,
                            slug=environment_slug,
                            version=environment_version,
                        )
                    ]
                    if environment_id
                    or environment_slug
                    or environment_version is not None
                    else None
                ),
            },
        )
        _raise_for_status(response)
        environments = response.json().get("environments") or []
        if not environments:
            target = environment_id or environment_slug or environment_version
            raise ValueError(f"Environment '{target}' not found.")
        return environments[0]

    @classmethod
    def _application_key(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ) -> str:
        if app_slug:
            return f"{app_slug}.revision"

        application = cls._query_simple_application(app_id=app_id)
        slug = application.get("slug")
        if not slug:
            raise ValueError("Application slug is required for environment fetch.")
        return f"{slug}.revision"

    @classmethod
    async def _aapplication_key(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ) -> str:
        if app_slug:
            return f"{app_slug}.revision"

        application = await cls._aquery_simple_application(app_id=app_id)
        slug = application.get("slug")
        if not slug:
            raise ValueError("Application slug is required for environment fetch.")
        return f"{slug}.revision"

    @classmethod
    def _retrieve_revision(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
    ) -> ConfigurationResponse:
        fetch_signatures = cls._parse_fetch_request(
            app_id=app_id,
            app_slug=app_slug,
            variant_id=variant_id,
            variant_slug=variant_slug,
            variant_version=variant_version,
            environment_id=environment_id,
            environment_slug=environment_slug,
            environment_version=environment_version,
        )

        request: Dict[str, Any] = {"resolve": True}
        resolved_application_id = fetch_signatures["app_id"]
        resolved_application_slug = fetch_signatures["app_slug"]
        resolved_variant_id = fetch_signatures["variant_id"]
        resolved_variant_slug = fetch_signatures["variant_slug"]

        if fetch_signatures["environment_id"] or fetch_signatures["environment_slug"]:
            request["environment_ref"] = cls._build_environment_ref(
                environment_id=fetch_signatures["environment_id"],
                environment_slug=fetch_signatures["environment_slug"],
                environment_version=fetch_signatures["environment_version"],
            )
            request["key"] = cls._application_key(
                app_id=fetch_signatures["app_id"],
                app_slug=fetch_signatures["app_slug"],
            )
        else:
            request["application_ref"] = cls._build_application_ref(
                app_id=resolved_application_id,
                app_slug=resolved_application_slug,
            )
            request["application_variant_ref"] = cls._build_variant_ref(
                variant_id=resolved_variant_id,
                variant_slug=resolved_variant_slug,
            )
            request["application_revision_ref"] = cls._build_revision_ref(
                variant_version=fetch_signatures["variant_version"],
            )

        response = authed_api()(
            method="POST",
            endpoint="/preview/applications/revisions/retrieve",
            json=request,
        )
        _raise_for_status(response)

        result = response.json()
        revision = result.get("application_revision")

        if not _revision_has_parameters(revision) and not (
            fetch_signatures["environment_id"] or fetch_signatures["environment_slug"]
        ):
            fallback_request = {
                key: value
                for key, value in {
                    "resolve": True,
                    "workflow_ref": request.get("application_ref"),
                    "workflow_variant_ref": request.get("application_variant_ref"),
                    "workflow_revision_ref": request.get("application_revision_ref"),
                }.items()
                if value is not None
            }

            fallback_response = authed_api()(
                method="POST",
                endpoint="/preview/workflows/revisions/retrieve",
                json=fallback_request,
            )
            _raise_for_status(fallback_response)
            fallback_result = fallback_response.json()
            fallback_revision = fallback_result.get("workflow_revision")

            if _revision_has_parameters(fallback_revision):
                revision = fallback_revision

        if not revision:
            variant = None
            if resolved_variant_id or resolved_variant_slug:
                variant = cls._resolve_variant(
                    app_id=resolved_application_id,
                    app_slug=resolved_application_slug,
                    variant_id=resolved_variant_id,
                    variant_slug=resolved_variant_slug,
                )
                resolved_variant_id = (
                    resolved_variant_id
                    or variant.get("application_variant_id")
                    or variant.get("id")
                )
                resolved_variant_slug = resolved_variant_slug or variant.get("slug")
                resolved_application_id = (
                    resolved_application_id
                    or variant.get("application_id")
                    or variant.get("artifact_id")
                )

            if fetch_signatures["variant_version"] is not None:
                _raise_revision_not_found(
                    app_id=resolved_application_id,
                    app_slug=resolved_application_slug,
                    variant_id=resolved_variant_id,
                    variant_slug=resolved_variant_slug,
                    variant_version=fetch_signatures["variant_version"],
                )

            return _empty_configuration_response(
                app_id=resolved_application_id,
                app_slug=resolved_application_slug,
                variant_id=resolved_variant_id,
                variant_slug=resolved_variant_slug,
            )

        return ConfigurationResponse(
            **_flatten_revision_response(
                application_revision=revision,
                app_slug=resolved_application_slug,
                variant_slug=resolved_variant_slug,
                environment_slug=fetch_signatures["environment_slug"],
            )
        )

    @classmethod
    async def _aretrieve_revision(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
    ) -> ConfigurationResponse:
        fetch_signatures = cls._parse_fetch_request(
            app_id=app_id,
            app_slug=app_slug,
            variant_id=variant_id,
            variant_slug=variant_slug,
            variant_version=variant_version,
            environment_id=environment_id,
            environment_slug=environment_slug,
            environment_version=environment_version,
        )

        request: Dict[str, Any] = {"resolve": True}
        resolved_application_id = fetch_signatures["app_id"]
        resolved_application_slug = fetch_signatures["app_slug"]
        resolved_variant_id = fetch_signatures["variant_id"]
        resolved_variant_slug = fetch_signatures["variant_slug"]

        if fetch_signatures["environment_id"] or fetch_signatures["environment_slug"]:
            request["environment_ref"] = cls._build_environment_ref(
                environment_id=fetch_signatures["environment_id"],
                environment_slug=fetch_signatures["environment_slug"],
                environment_version=fetch_signatures["environment_version"],
            )
            request["key"] = await cls._aapplication_key(
                app_id=fetch_signatures["app_id"],
                app_slug=fetch_signatures["app_slug"],
            )
        else:
            request["application_ref"] = cls._build_application_ref(
                app_id=resolved_application_id,
                app_slug=resolved_application_slug,
            )
            request["application_variant_ref"] = cls._build_variant_ref(
                variant_id=resolved_variant_id,
                variant_slug=resolved_variant_slug,
            )
            request["application_revision_ref"] = cls._build_revision_ref(
                variant_version=fetch_signatures["variant_version"],
            )

        response = await authed_async_api()(
            method="POST",
            endpoint="/preview/applications/revisions/retrieve",
            json=request,
        )
        _raise_for_status(response)

        result = response.json()
        revision = result.get("application_revision")

        if not _revision_has_parameters(revision) and not (
            fetch_signatures["environment_id"] or fetch_signatures["environment_slug"]
        ):
            fallback_request = {
                key: value
                for key, value in {
                    "resolve": True,
                    "workflow_ref": request.get("application_ref"),
                    "workflow_variant_ref": request.get("application_variant_ref"),
                    "workflow_revision_ref": request.get("application_revision_ref"),
                }.items()
                if value is not None
            }

            fallback_response = await authed_async_api()(
                method="POST",
                endpoint="/preview/workflows/revisions/retrieve",
                json=fallback_request,
            )
            _raise_for_status(fallback_response)
            fallback_result = fallback_response.json()
            fallback_revision = fallback_result.get("workflow_revision")

            if _revision_has_parameters(fallback_revision):
                revision = fallback_revision

        if not revision:
            variant = None
            if resolved_variant_id or resolved_variant_slug:
                variant = await cls._aresolve_variant(
                    app_id=resolved_application_id,
                    app_slug=resolved_application_slug,
                    variant_id=resolved_variant_id,
                    variant_slug=resolved_variant_slug,
                )
                resolved_variant_id = (
                    resolved_variant_id
                    or variant.get("application_variant_id")
                    or variant.get("id")
                )
                resolved_variant_slug = resolved_variant_slug or variant.get("slug")
                resolved_application_id = (
                    resolved_application_id
                    or variant.get("application_id")
                    or variant.get("artifact_id")
                )

            if fetch_signatures["variant_version"] is not None:
                _raise_revision_not_found(
                    app_id=resolved_application_id,
                    app_slug=resolved_application_slug,
                    variant_id=resolved_variant_id,
                    variant_slug=resolved_variant_slug,
                    variant_version=fetch_signatures["variant_version"],
                )

            return _empty_configuration_response(
                app_id=resolved_application_id,
                app_slug=resolved_application_slug,
                variant_id=resolved_variant_id,
                variant_slug=resolved_variant_slug,
            )

        return ConfigurationResponse(
            **_flatten_revision_response(
                application_revision=revision,
                app_slug=resolved_application_slug,
                variant_slug=resolved_variant_slug,
                environment_slug=fetch_signatures["environment_slug"],
            )
        )

    @classmethod
    def _resolve_variant(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
    ) -> Dict[str, Any]:
        if variant_id:
            response = authed_api()(
                method="GET",
                endpoint=f"/preview/applications/variants/{variant_id}",
            )
            _raise_for_status(response)
            variant = response.json().get("application_variant")
            if not variant:
                raise ValueError(f"Variant '{variant_id}' not found.")
            return variant

        response = authed_api()(
            method="POST",
            endpoint="/preview/applications/variants/query",
            json={
                "application_refs": [
                    cls._build_application_ref(app_id=app_id, app_slug=app_slug)
                ],
                "application_variant": {"slug": variant_slug},
            },
        )
        _raise_for_status(response)
        variants = response.json().get("application_variants") or []
        if not variants:
            raise ValueError(f"Variant '{variant_slug}' not found.")
        return variants[0]

    @classmethod
    async def _aresolve_variant(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
    ) -> Dict[str, Any]:
        if variant_id:
            response = await authed_async_api()(
                method="GET",
                endpoint=f"/preview/applications/variants/{variant_id}",
            )
            _raise_for_status(response)
            variant = response.json().get("application_variant")
            if not variant:
                raise ValueError(f"Variant '{variant_id}' not found.")
            return variant

        response = await authed_async_api()(
            method="POST",
            endpoint="/preview/applications/variants/query",
            json={
                "application_refs": [
                    cls._build_application_ref(app_id=app_id, app_slug=app_slug)
                ],
                "application_variant": {"slug": variant_slug},
            },
        )
        _raise_for_status(response)
        variants = response.json().get("application_variants") or []
        if not variants:
            raise ValueError(f"Variant '{variant_slug}' not found.")
        return variants[0]

    @classmethod
    def _variant_response(cls, *, application: Dict[str, Any], variant: Dict[str, Any]):
        return ConfigurationResponse(
            app_id=application.get("id"),
            app_slug=application.get("slug"),
            variant_id=variant.get("application_variant_id") or variant.get("id"),
            variant_slug=variant.get("slug"),
            params={},
        )

    @classmethod
    @handle_exceptions()
    def add(
        cls,
        *,
        variant_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        application = cls._query_simple_application(app_id=app_id, app_slug=app_slug)

        response = authed_api()(
            method="POST",
            endpoint="/preview/applications/variants/",
            json={
                "application_variant": {
                    "application_id": application.get("id"),
                    "slug": variant_slug,
                }
            },
        )
        _raise_for_status(response)
        variant = response.json().get("application_variant")
        if not variant:
            raise ValueError("Failed to create application variant.")

        return cls._variant_response(application=application, variant=variant)

    @classmethod
    @handle_exceptions()
    async def aadd(
        cls,
        *,
        variant_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        application = await cls._aquery_simple_application(
            app_id=app_id,
            app_slug=app_slug,
        )

        response = await authed_async_api()(
            method="POST",
            endpoint="/preview/applications/variants/",
            json={
                "application_variant": {
                    "application_id": application.get("id"),
                    "slug": variant_slug,
                }
            },
        )
        _raise_for_status(response)
        variant = response.json().get("application_variant")
        if not variant:
            raise ValueError("Failed to create application variant.")

        return cls._variant_response(application=application, variant=variant)

    @classmethod
    @handle_exceptions()
    def fetch(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
    ) -> ConfigurationResponse:
        return cls._retrieve_revision(
            app_id=app_id,
            app_slug=app_slug,
            variant_id=variant_id,
            variant_slug=variant_slug,
            variant_version=variant_version,
            environment_id=environment_id,
            environment_slug=environment_slug,
            environment_version=environment_version,
        )

    @classmethod
    @handle_exceptions()
    async def afetch(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
    ):
        return await cls._aretrieve_revision(
            app_id=app_id,
            app_slug=app_slug,
            variant_id=variant_id,
            variant_slug=variant_slug,
            variant_version=variant_version,
            environment_id=environment_id,
            environment_slug=environment_slug,
            environment_version=environment_version,
        )

    @classmethod
    @handle_exceptions()
    def list(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        response = authed_api()(
            method="POST",
            endpoint="/preview/applications/variants/query",
            json={
                "application_refs": [
                    cls._build_application_ref(app_id=app_id, app_slug=app_slug)
                ],
            },
        )
        _raise_for_status(response)

        variants = response.json().get("application_variants") or []
        return [
            cls.fetch(
                app_id=app_id,
                app_slug=app_slug,
                variant_id=variant.get("application_variant_id") or variant.get("id"),
            )
            for variant in variants
        ]

    @classmethod
    @handle_exceptions()
    async def alist(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        response = await authed_async_api()(
            method="POST",
            endpoint="/preview/applications/variants/query",
            json={
                "application_refs": [
                    cls._build_application_ref(app_id=app_id, app_slug=app_slug)
                ],
            },
        )
        _raise_for_status(response)

        variants = response.json().get("application_variants") or []
        results = []
        for variant in variants:
            results.append(
                await cls.afetch(
                    app_id=app_id,
                    app_slug=app_slug,
                    variant_id=variant.get("application_variant_id")
                    or variant.get("id"),
                )
            )
        return results

    @classmethod
    @handle_exceptions()
    def history(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
    ):
        variant = cls._resolve_variant(
            app_id=app_id,
            app_slug=app_slug,
            variant_id=variant_id,
            variant_slug=variant_slug,
        )

        response = authed_api()(
            method="POST",
            endpoint="/preview/applications/revisions/log",
            json={
                "application": {
                    "application_id": variant.get("application_id")
                    or variant.get("artifact_id"),
                    "application_variant_id": variant.get("application_variant_id")
                    or variant.get("id"),
                }
            },
        )
        _raise_for_status(response)

        revisions = response.json().get("application_revisions") or []
        return [
            ConfigurationResponse(
                **_flatten_revision_response(
                    application_revision=revision,
                    app_slug=app_slug,
                    variant_slug=variant.get("slug"),
                )
            )
            for revision in revisions
        ]

    @classmethod
    @handle_exceptions()
    async def ahistory(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
    ):
        variant = await cls._aresolve_variant(
            app_id=app_id,
            app_slug=app_slug,
            variant_id=variant_id,
            variant_slug=variant_slug,
        )

        response = await authed_async_api()(
            method="POST",
            endpoint="/preview/applications/revisions/log",
            json={
                "application": {
                    "application_id": variant.get("application_id")
                    or variant.get("artifact_id"),
                    "application_variant_id": variant.get("application_variant_id")
                    or variant.get("id"),
                }
            },
        )
        _raise_for_status(response)

        revisions = response.json().get("application_revisions") or []
        return [
            ConfigurationResponse(
                **_flatten_revision_response(
                    application_revision=revision,
                    app_slug=app_slug,
                    variant_slug=variant.get("slug"),
                )
            )
            for revision in revisions
        ]

    @classmethod
    @handle_exceptions()
    def fork(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
    ):
        source = cls.fetch(
            app_id=app_id,
            app_slug=app_slug,
            variant_id=variant_id,
            variant_slug=variant_slug,
            variant_version=variant_version,
            environment_id=environment_id,
            environment_slug=environment_slug,
            environment_version=environment_version,
        )
        fork_slug = f"{source.variant_slug}-fork-{uuid4().hex[:6]}"
        cls.add(
            variant_slug=fork_slug,
            app_id=source.app_id,
            app_slug=source.app_slug,
        )
        return cls.commit(
            parameters=source.params,
            variant_slug=fork_slug,
            app_id=source.app_id,
            app_slug=source.app_slug,
        )

    @classmethod
    @handle_exceptions()
    async def afork(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_id: Optional[str] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
    ):
        source = await cls.afetch(
            app_id=app_id,
            app_slug=app_slug,
            variant_id=variant_id,
            variant_slug=variant_slug,
            variant_version=variant_version,
            environment_id=environment_id,
            environment_slug=environment_slug,
            environment_version=environment_version,
        )
        fork_slug = f"{source.variant_slug}-fork-{uuid4().hex[:6]}"
        await cls.aadd(
            variant_slug=fork_slug,
            app_id=source.app_id,
            app_slug=source.app_slug,
        )
        return await cls.acommit(
            parameters=source.params,
            variant_slug=fork_slug,
            app_id=source.app_id,
            app_slug=source.app_slug,
        )

    @classmethod
    @handle_exceptions()
    def commit(
        cls,
        *,
        parameters: dict,
        variant_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        variant = cls._resolve_variant(
            app_id=app_id,
            app_slug=app_slug,
            variant_slug=variant_slug,
        )

        response = authed_api()(
            method="POST",
            endpoint="/preview/applications/revisions/commit",
            json={
                "application_revision_commit": {
                    "application_id": variant.get("application_id")
                    or variant.get("artifact_id"),
                    "application_variant_id": variant.get("application_variant_id")
                    or variant.get("id"),
                    "slug": uuid4().hex[:12],
                    "data": {"parameters": parameters},
                }
            },
        )
        _raise_for_status(response)

        revision = response.json().get("application_revision")
        if not revision:
            raise ValueError("Failed to commit application revision.")

        return ConfigurationResponse(
            **_flatten_revision_response(
                application_revision=revision,
                app_slug=app_slug,
                variant_slug=variant_slug,
            )
        )

    @classmethod
    @handle_exceptions()
    async def acommit(
        cls,
        *,
        parameters: dict,
        variant_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        variant = await cls._aresolve_variant(
            app_id=app_id,
            app_slug=app_slug,
            variant_slug=variant_slug,
        )

        response = await authed_async_api()(
            method="POST",
            endpoint="/preview/applications/revisions/commit",
            json={
                "application_revision_commit": {
                    "application_id": variant.get("application_id")
                    or variant.get("artifact_id"),
                    "application_variant_id": variant.get("application_variant_id")
                    or variant.get("id"),
                    "slug": uuid4().hex[:12],
                    "data": {"parameters": parameters},
                }
            },
        )
        _raise_for_status(response)

        revision = response.json().get("application_revision")
        if not revision:
            raise ValueError("Failed to commit application revision.")

        return ConfigurationResponse(
            **_flatten_revision_response(
                application_revision=revision,
                app_slug=app_slug,
                variant_slug=variant_slug,
            )
        )

    @classmethod
    @handle_exceptions()
    def deploy(
        cls,
        *,
        variant_slug: str,
        environment_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
    ):
        config = cls.fetch(
            app_id=app_id,
            app_slug=app_slug,
            variant_slug=variant_slug,
            variant_version=variant_version,
        )

        response = authed_api()(
            method="POST",
            endpoint="/preview/applications/revisions/deploy",
            json={
                "application_ref": cls._build_application_ref(
                    app_id=config.app_id,
                    app_slug=config.app_slug,
                ),
                "application_variant_ref": cls._build_variant_ref(
                    variant_id=config.variant_id,
                    variant_slug=config.variant_slug,
                ),
                "application_revision_ref": cls._build_revision_ref(
                    variant_version=config.variant_version,
                ),
                "environment_ref": cls._build_environment_ref(
                    environment_slug=environment_slug,
                ),
            },
        )
        _raise_for_status(response)

        deployed_revision = response.json().get("application_revision")
        if not deployed_revision:
            raise ValueError("Failed to deploy application revision.")

        environment_revision = cls._query_simple_environment(
            environment_slug=environment_slug,
        )

        return DeploymentResponse(
            **_flatten_revision_response(
                application_revision=deployed_revision,
                environment_revision=environment_revision,
                app_slug=config.app_slug,
                variant_slug=config.variant_slug,
                environment_slug=environment_slug,
            )
        )

    @classmethod
    @handle_exceptions()
    async def adeploy(
        cls,
        *,
        variant_slug: str,
        environment_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
    ):
        config = await cls.afetch(
            app_id=app_id,
            app_slug=app_slug,
            variant_slug=variant_slug,
            variant_version=variant_version,
        )

        response = await authed_async_api()(
            method="POST",
            endpoint="/preview/applications/revisions/deploy",
            json={
                "application_ref": cls._build_application_ref(
                    app_id=config.app_id,
                    app_slug=config.app_slug,
                ),
                "application_variant_ref": cls._build_variant_ref(
                    variant_id=config.variant_id,
                    variant_slug=config.variant_slug,
                ),
                "application_revision_ref": cls._build_revision_ref(
                    variant_version=config.variant_version,
                ),
                "environment_ref": cls._build_environment_ref(
                    environment_slug=environment_slug,
                ),
            },
        )
        _raise_for_status(response)

        deployed_revision = response.json().get("application_revision")
        if not deployed_revision:
            raise ValueError("Failed to deploy application revision.")

        environment_revision = await cls._aquery_simple_environment(
            environment_slug=environment_slug,
        )

        return DeploymentResponse(
            **_flatten_revision_response(
                application_revision=deployed_revision,
                environment_revision=environment_revision,
                app_slug=config.app_slug,
                variant_slug=config.variant_slug,
                environment_slug=environment_slug,
            )
        )

    @classmethod
    @handle_exceptions()
    def delete(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
    ):
        del variant_version
        variant = cls._resolve_variant(
            app_id=app_id,
            app_slug=app_slug,
            variant_id=variant_id,
            variant_slug=variant_slug,
        )

        response = authed_api()(
            method="POST",
            endpoint=(
                f"/preview/applications/variants/"
                f"{variant.get('application_variant_id') or variant.get('id')}/archive"
            ),
        )
        _raise_for_status(response)

        return response.json()

    @classmethod
    @handle_exceptions()
    async def adelete(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
    ):
        del variant_version
        variant = await cls._aresolve_variant(
            app_id=app_id,
            app_slug=app_slug,
            variant_id=variant_id,
            variant_slug=variant_slug,
        )

        response = await authed_async_api()(
            method="POST",
            endpoint=(
                f"/preview/applications/variants/"
                f"{variant.get('application_variant_id') or variant.get('id')}/archive"
            ),
        )
        _raise_for_status(response)

        return response.json()
