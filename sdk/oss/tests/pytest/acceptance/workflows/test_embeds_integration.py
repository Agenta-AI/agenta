"""
SDK E2E tests for embeds resolution integration.

These tests make real API calls to validate embed resolution behavior.
"""

from uuid import uuid4

import pytest
import requests

from tests.pytest.utils.constants import BASE_TIMEOUT

pytestmark = [pytest.mark.e2e]


def _random_slug(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:8]}"


def _assert_status(response: requests.Response, status_code: int) -> dict:
    assert response.status_code == status_code, (
        f"Expected {status_code}, got {response.status_code}: {response.text}"
    )
    return response.json()


@pytest.fixture(scope="class")
def authed_api(api_credentials):
    host, api_key = api_credentials
    api_url = f"{host}/api"

    def _request(method: str, endpoint: str, **kwargs):
        headers = kwargs.pop("headers", {})
        headers.setdefault("Authorization", f"ApiKey {api_key}")
        return requests.request(
            method=method,
            url=f"{api_url}{endpoint}",
            headers=headers,
            timeout=BASE_TIMEOUT,
            **kwargs,
        )

    return _request


def _create_workflow(
    authed_api, *, slug: str, name: str, is_evaluator: bool | None = None
):
    workflow = {"slug": slug, "name": name}
    if is_evaluator is not None:
        workflow["is_evaluator"] = is_evaluator

    body = _assert_status(
        authed_api("POST", "/workflows/", json={"workflow": workflow}),
        200,
    )
    return body["workflow"]["id"]


def _create_workflow_variant(authed_api, *, workflow_id: str):
    body = _assert_status(
        authed_api(
            "POST",
            "/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": _random_slug("variant"),
                    "name": "Default",
                    "workflow_id": workflow_id,
                }
            },
        ),
        200,
    )
    variant_id = body["workflow_variant"]["id"]

    # Create a version-0 stub so the first real commit gets version 1.
    # The API assigns version 0 to the first revision per variant and nullifies
    # its data, so we must seed an empty commit before committing real data.
    authed_api(
        "POST",
        "/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": _random_slug("stub"),
                "workflow_id": workflow_id,
                "workflow_variant_id": variant_id,
                "data": {},
            }
        },
    )

    return variant_id


def _commit_workflow_revision(
    authed_api,
    *,
    workflow_id: str,
    workflow_variant_id: str,
    revision_slug: str,
    data: dict,
):
    body = _assert_status(
        authed_api(
            "POST",
            "/workflows/revisions/commit",
            json={
                "workflow_revision": {
                    "slug": revision_slug,
                    "workflow_id": workflow_id,
                    "workflow_variant_id": workflow_variant_id,
                    "data": data,
                }
            },
        ),
        200,
    )
    return body["workflow_revision"]["id"]


def _resolve_workflow_revision(authed_api, *, revision_id: str):
    return authed_api(
        "POST",
        "/workflows/revisions/resolve",
        json={
            "workflow_revision_ref": {"id": revision_id, "slug": None, "version": None},
            "max_depth": 10,
            "max_embeds": 100,
            "error_policy": "exception",
        },
    )


def _retrieve_workflow_revision(authed_api, *, revision_id: str, resolve: bool = False):
    payload = {"workflow_revision_ref": {"id": revision_id}}
    if resolve:
        payload["resolve"] = True
    return authed_api("POST", "/workflows/revisions/retrieve", json=payload)


def _resolve_application_revision(authed_api, *, revision_id: str):
    return authed_api(
        "POST",
        "/applications/revisions/resolve",
        json={
            "application_revision_ref": {
                "id": revision_id,
                "slug": None,
                "version": None,
            },
            "max_depth": 10,
            "max_embeds": 100,
            "error_policy": "exception",
        },
    )


@pytest.mark.e2e
class TestSDKEmbedsIntegration:
    def test_sdk_resolves_simple_embed(self, authed_api):
        base_slug = _random_slug("sdk-e2e-base")
        base_id = _create_workflow(authed_api, slug=base_slug, name="SDK E2E Base")
        base_variant_id = _create_workflow_variant(authed_api, workflow_id=base_id)
        _commit_workflow_revision(
            authed_api,
            workflow_id=base_id,
            workflow_variant_id=base_variant_id,
            revision_slug=f"{base_slug}-v1",
            data={"parameters": {"greeting": "Hello from SDK E2E"}},
        )

        ref_slug = _random_slug("sdk-e2e-ref")
        ref_id = _create_workflow(authed_api, slug=ref_slug, name="SDK E2E Ref")
        ref_variant_id = _create_workflow_variant(authed_api, workflow_id=ref_id)
        ref_revision_id = _commit_workflow_revision(
            authed_api,
            workflow_id=ref_id,
            workflow_variant_id=ref_variant_id,
            revision_slug=f"{ref_slug}-v1",
            data={
                "parameters": {
                    "message": {
                        "@ag.embed": {
                            "@ag.references": {
                                "workflow_revision": {
                                    "slug": base_slug,
                                    "version": "v1",
                                    "id": None,
                                }
                            },
                            "@ag.selector": {"path": "parameters.greeting"},
                        }
                    }
                }
            },
        )

        body = _assert_status(
            _resolve_workflow_revision(authed_api, revision_id=ref_revision_id), 200
        )

        resolved = body["workflow_revision"]["data"]
        assert resolved["parameters"]["message"] == "Hello from SDK E2E"
        assert body["resolution_info"]["embeds_resolved"] == 1
        assert body["resolution_info"]["depth_reached"] == 1

    def test_sdk_resolves_string_embed(self, authed_api):
        base_slug = _random_slug("sdk-str-base")
        base_id = _create_workflow(authed_api, slug=base_slug, name="SDK String Base")
        base_variant_id = _create_workflow_variant(authed_api, workflow_id=base_id)
        _commit_workflow_revision(
            authed_api,
            workflow_id=base_id,
            workflow_variant_id=base_variant_id,
            revision_slug=f"{base_slug}-v1",
            data={"parameters": {"value": "string-embedded-value"}},
        )

        ref_slug = _random_slug("sdk-str-ref")
        ref_id = _create_workflow(authed_api, slug=ref_slug, name="SDK String Ref")
        ref_variant_id = _create_workflow_variant(authed_api, workflow_id=ref_id)
        ref_revision_id = _commit_workflow_revision(
            authed_api,
            workflow_id=ref_id,
            workflow_variant_id=ref_variant_id,
            revision_slug=f"{ref_slug}-v1",
            data={
                "parameters": {
                    "text": f"Value: @ag.embed[@ag.references[workflow_revision.slug={base_slug}-v1], @ag.selector[path=parameters.value]]"
                }
            },
        )

        body = _assert_status(
            _resolve_workflow_revision(authed_api, revision_id=ref_revision_id), 200
        )

        resolved = body["workflow_revision"]["data"]
        assert resolved["parameters"]["text"] == "Value: string-embedded-value"
        assert body["resolution_info"]["embeds_resolved"] == 1

    def test_sdk_resolves_nested_embeds(self, authed_api):
        level3_slug = _random_slug("sdk-nest-l3")
        l3_id = _create_workflow(authed_api, slug=level3_slug, name="SDK Nest L3")
        l3_variant_id = _create_workflow_variant(authed_api, workflow_id=l3_id)
        _commit_workflow_revision(
            authed_api,
            workflow_id=l3_id,
            workflow_variant_id=l3_variant_id,
            revision_slug=f"{level3_slug}-v1",
            data={"parameters": {"final": "deepest-value"}},
        )

        level2_slug = _random_slug("sdk-nest-l2")
        l2_id = _create_workflow(authed_api, slug=level2_slug, name="SDK Nest L2")
        l2_variant_id = _create_workflow_variant(authed_api, workflow_id=l2_id)
        _commit_workflow_revision(
            authed_api,
            workflow_id=l2_id,
            workflow_variant_id=l2_variant_id,
            revision_slug=f"{level2_slug}-v1",
            data={
                "parameters": {
                    "middle": {
                        "@ag.embed": {
                            "@ag.references": {
                                "workflow_revision": {
                                    "slug": level3_slug,
                                    "version": "v1",
                                    "id": None,
                                }
                            }
                        }
                    }
                }
            },
        )

        level1_slug = _random_slug("sdk-nest-l1")
        l1_id = _create_workflow(authed_api, slug=level1_slug, name="SDK Nest L1")
        l1_variant_id = _create_workflow_variant(authed_api, workflow_id=l1_id)
        l1_revision_id = _commit_workflow_revision(
            authed_api,
            workflow_id=l1_id,
            workflow_variant_id=l1_variant_id,
            revision_slug=f"{level1_slug}-v1",
            data={
                "parameters": {
                    "top": {
                        "@ag.embed": {
                            "@ag.references": {
                                "workflow_revision": {
                                    "slug": level2_slug,
                                    "version": "v1",
                                    "id": None,
                                }
                            }
                        }
                    }
                }
            },
        )

        body = _assert_status(
            _resolve_workflow_revision(authed_api, revision_id=l1_revision_id), 200
        )

        resolved = body["workflow_revision"]["data"]
        assert (
            resolved["parameters"]["top"]["parameters"]["middle"]["parameters"]["final"]
            == "deepest-value"
        )
        assert body["resolution_info"]["embeds_resolved"] == 2
        assert body["resolution_info"]["depth_reached"] == 2

    def test_sdk_handles_circular_reference_error(self, authed_api):
        a_slug = _random_slug("sdk-circ-a")
        a_id = _create_workflow(authed_api, slug=a_slug, name="SDK Circ A")
        a_variant_id = _create_workflow_variant(authed_api, workflow_id=a_id)

        b_slug = _random_slug("sdk-circ-b")
        b_id = _create_workflow(authed_api, slug=b_slug, name="SDK Circ B")
        b_variant_id = _create_workflow_variant(authed_api, workflow_id=b_id)

        _commit_workflow_revision(
            authed_api,
            workflow_id=b_id,
            workflow_variant_id=b_variant_id,
            revision_slug=f"{b_slug}-v1",
            data={
                "parameters": {
                    "ref_to_a": {
                        "@ag.embed": {
                            "@ag.references": {
                                "workflow_revision": {
                                    "slug": a_slug,
                                    "version": "v1",
                                    "id": None,
                                }
                            }
                        }
                    }
                }
            },
        )

        a_revision_id = _commit_workflow_revision(
            authed_api,
            workflow_id=a_id,
            workflow_variant_id=a_variant_id,
            revision_slug=f"{a_slug}-v1",
            data={
                "parameters": {
                    "ref_to_b": {
                        "@ag.embed": {
                            "@ag.references": {
                                "workflow_revision": {
                                    "slug": b_slug,
                                    "version": "v1",
                                    "id": None,
                                }
                            }
                        }
                    }
                }
            },
        )

        response = _resolve_workflow_revision(authed_api, revision_id=a_revision_id)
        assert response.status_code in [400, 500]

    def test_sdk_resolves_application_embed(self, authed_api):
        base_slug = _random_slug("sdk-app-base")
        base_id = _create_workflow(authed_api, slug=base_slug, name="SDK App Base")
        base_variant_id = _create_workflow_variant(authed_api, workflow_id=base_id)
        _commit_workflow_revision(
            authed_api,
            workflow_id=base_id,
            workflow_variant_id=base_variant_id,
            revision_slug=f"{base_slug}-v1",
            data={"parameters": {"prompt": "app-prompt-value"}},
        )

        app_slug = _random_slug("sdk-app")
        app_id = _create_workflow(
            authed_api,
            slug=app_slug,
            name="SDK App",
            is_evaluator=False,
        )
        app_variant_id = _create_workflow_variant(authed_api, workflow_id=app_id)
        app_revision_id = _commit_workflow_revision(
            authed_api,
            workflow_id=app_id,
            workflow_variant_id=app_variant_id,
            revision_slug=f"{app_slug}-v1",
            data={
                "parameters": {
                    "config": {
                        "@ag.embed": {
                            "@ag.references": {
                                "workflow_revision": {
                                    "slug": base_slug,
                                    "version": "v1",
                                    "id": None,
                                }
                            },
                            "@ag.selector": {"path": "parameters.prompt"},
                        }
                    }
                }
            },
        )

        body = _assert_status(
            _resolve_application_revision(authed_api, revision_id=app_revision_id), 200
        )

        resolved = body["application_revision"]["data"]
        assert resolved["parameters"]["config"] == "app-prompt-value"
        assert body["resolution_info"]["embeds_resolved"] == 1

    def test_retrieve_with_resolve_true_single_round_trip(self, authed_api):
        base_slug = _random_slug("sdk-rr-base")
        base_id = _create_workflow(authed_api, slug=base_slug, name="SDK RR Base")
        base_variant_id = _create_workflow_variant(authed_api, workflow_id=base_id)
        _commit_workflow_revision(
            authed_api,
            workflow_id=base_id,
            workflow_variant_id=base_variant_id,
            revision_slug=f"{base_slug}-v1",
            data={"parameters": {"value": "retrieved-and-resolved"}},
        )

        ref_slug = _random_slug("sdk-rr-ref")
        ref_id = _create_workflow(authed_api, slug=ref_slug, name="SDK RR Ref")
        ref_variant_id = _create_workflow_variant(authed_api, workflow_id=ref_id)
        ref_revision_id = _commit_workflow_revision(
            authed_api,
            workflow_id=ref_id,
            workflow_variant_id=ref_variant_id,
            revision_slug=f"{ref_slug}-v1",
            data={
                "parameters": {
                    "embedded": {
                        "@ag.embed": {
                            "@ag.references": {
                                "workflow_revision": {
                                    "slug": base_slug,
                                    "version": "v1",
                                    "id": None,
                                }
                            },
                            "@ag.selector": {"path": "parameters.value"},
                        }
                    }
                }
            },
        )

        body = _assert_status(
            _retrieve_workflow_revision(
                authed_api,
                revision_id=ref_revision_id,
                resolve=True,
            ),
            200,
        )

        resolved = body["workflow_revision"]["data"]
        assert resolved["parameters"]["embedded"] == "retrieved-and-resolved"
        assert body["resolution_info"]["embeds_resolved"] == 1

    def test_retrieve_without_resolve_preserves_embed_markers(self, authed_api):
        base_slug = _random_slug("sdk-raw-base")
        base_id = _create_workflow(authed_api, slug=base_slug, name="SDK Raw Base")
        base_variant_id = _create_workflow_variant(authed_api, workflow_id=base_id)
        _commit_workflow_revision(
            authed_api,
            workflow_id=base_id,
            workflow_variant_id=base_variant_id,
            revision_slug=f"{base_slug}-v1",
            data={"parameters": {"value": "raw-value"}},
        )

        ref_slug = _random_slug("sdk-raw-ref")
        ref_id = _create_workflow(authed_api, slug=ref_slug, name="SDK Raw Ref")
        ref_variant_id = _create_workflow_variant(authed_api, workflow_id=ref_id)
        ref_revision_id = _commit_workflow_revision(
            authed_api,
            workflow_id=ref_id,
            workflow_variant_id=ref_variant_id,
            revision_slug=f"{ref_slug}-v1",
            data={
                "parameters": {
                    "embedded": {
                        "@ag.embed": {
                            "@ag.references": {
                                "workflow_revision": {
                                    "slug": base_slug,
                                    "version": "v1",
                                    "id": None,
                                }
                            }
                        }
                    }
                }
            },
        )

        body = _assert_status(
            _retrieve_workflow_revision(authed_api, revision_id=ref_revision_id),
            200,
        )

        raw = body["workflow_revision"]["data"]
        assert "@ag.embed" in raw["parameters"]["embedded"]
        assert body.get("resolution_info") is None
