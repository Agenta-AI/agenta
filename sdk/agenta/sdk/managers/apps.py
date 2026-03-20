from typing import List, Literal, Optional

from agenta.sdk.utils.client import authed_api, authed_async_api
from agenta.sdk.utils.exceptions import handle_exceptions
from agenta.sdk.utils.types import ReferencesResponse

AppType = Literal["SERVICE:completion", "SERVICE:chat", "CUSTOM"]

DEFAULT_APP_TYPE = "SERVICE:completion"


def _build_flags(app_type: Optional[AppType]) -> dict:
    if app_type == "SERVICE:chat":
        return {"is_chat": True}
    if app_type == "CUSTOM":
        return {"is_custom": True}
    return {}


def _build_simple_application_payload(
    *,
    app_slug: str,
    app_type: Optional[AppType],
    app_id: Optional[str] = None,
) -> dict:
    payload = {
        "slug": app_slug,
        "name": app_slug,
    }

    if app_id:
        payload["id"] = app_id

    flags = _build_flags(app_type)
    if flags:
        payload["flags"] = flags

    return {"application": payload}


def _parse_application_reference(payload: dict) -> ReferencesResponse:
    return ReferencesResponse(
        app_id=payload.get("id"),
        app_slug=payload.get("slug"),
    )


class AppManager:
    @classmethod
    @handle_exceptions()
    def create(
        cls,
        *,
        app_slug: str,
        template_key: Optional[AppType] = None,
        app_type: Optional[AppType] = DEFAULT_APP_TYPE,
    ) -> ReferencesResponse:
        response = authed_api()(
            method="POST",
            endpoint="/preview/simple/applications",
            json=_build_simple_application_payload(
                app_slug=app_slug,
                app_type=template_key or app_type,
            ),
        )
        response.raise_for_status()

        return _parse_application_reference(response.json()["application"])

    @classmethod
    @handle_exceptions()
    async def acreate(
        cls,
        *,
        app_slug: str,
        template_key: Optional[AppType] = None,
        app_type: Optional[AppType] = DEFAULT_APP_TYPE,
    ) -> ReferencesResponse:
        response = await authed_async_api()(
            method="POST",
            endpoint="/preview/simple/applications",
            json=_build_simple_application_payload(
                app_slug=app_slug,
                app_type=template_key or app_type,
            ),
        )
        response.raise_for_status()

        return _parse_application_reference(response.json()["application"])

    @classmethod
    @handle_exceptions()
    def list(cls) -> List[ReferencesResponse]:
        response = authed_api()(
            method="POST",
            endpoint="/preview/simple/applications/query",
            json={},
        )
        response.raise_for_status()

        return [
            _parse_application_reference(application)
            for application in response.json().get("applications", [])
        ]

    @classmethod
    @handle_exceptions()
    async def alist(cls) -> List[ReferencesResponse]:
        response = await authed_async_api()(
            method="POST",
            endpoint="/preview/simple/applications/query",
            json={},
        )
        response.raise_for_status()

        return [
            _parse_application_reference(application)
            for application in response.json().get("applications", [])
        ]

    @classmethod
    @handle_exceptions()
    def update(cls, *, app_id: str, app_slug: str) -> ReferencesResponse:
        response = authed_api()(
            method="PUT",
            endpoint=f"/preview/simple/applications/{app_id}",
            json=_build_simple_application_payload(
                app_slug=app_slug,
                app_type=None,
                app_id=app_id,
            ),
        )
        response.raise_for_status()

        return _parse_application_reference(response.json()["application"])

    @classmethod
    @handle_exceptions()
    async def aupdate(cls, *, app_id: str, app_slug: str) -> ReferencesResponse:
        response = await authed_async_api()(
            method="PUT",
            endpoint=f"/preview/simple/applications/{app_id}",
            json=_build_simple_application_payload(
                app_slug=app_slug,
                app_type=None,
                app_id=app_id,
            ),
        )
        response.raise_for_status()

        return _parse_application_reference(response.json()["application"])

    @classmethod
    @handle_exceptions()
    def delete(cls, *, app_id: str):
        response = authed_api()(
            method="POST",
            endpoint=f"/preview/simple/applications/{app_id}/archive",
        )
        response.raise_for_status()
        return None

    @classmethod
    @handle_exceptions()
    async def adelete(cls, *, app_id: str):
        response = await authed_async_api()(
            method="POST",
            endpoint=f"/preview/simple/applications/{app_id}/archive",
        )
        response.raise_for_status()
        return None
