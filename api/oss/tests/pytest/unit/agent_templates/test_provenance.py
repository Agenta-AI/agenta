import pytest

from oss.src.core.agent_templates.dtos import (
    InternalTemplateSource,
    ResolvedTemplateSource,
)
from oss.src.core.agent_templates.exceptions import TemplateProvenanceInvalid
from oss.src.core.agent_templates.provenance import (
    create_request_meta,
    merge_platform_meta,
    read_create_request,
    read_template_origin,
    template_origin_meta,
)


def _resolved() -> ResolvedTemplateSource:
    return ResolvedTemplateSource(
        source=InternalTemplateSource(key="outbound-prospecting"),
        root="/tmp/outbound-prospecting",
        version="1.0.0",
        digest="sha256:" + "1" * 64,
    )


def test_template_origin_uses_its_own_discriminator():
    meta = template_origin_meta(_resolved())

    assert meta == {
        "_ag": {
            "template_origin": {
                "kind": "internal",
                "key": "outbound-prospecting",
                "version": "1.0.0",
                "digest": "sha256:" + "1" * 64,
            }
        }
    }
    assert "origin" not in meta["_ag"]
    assert "skill_origin" not in meta["_ag"]


def test_platform_meta_merge_preserves_foreign_and_agenta_keys():
    merged = merge_platform_meta(
        {"owner": "user", "_ag": {"existing": {"value": 1}}},
        template_origin_meta(_resolved()),
        create_request_meta(
            key_hash="sha256:" + "2" * 64,
            request_fingerprint="sha256:" + "3" * 64,
        ),
    )

    assert merged["owner"] == "user"
    assert merged["_ag"]["existing"] == {"value": 1}
    assert merged["_ag"]["template_origin"]["key"] == "outbound-prospecting"
    assert merged["_ag"]["create_request"]["key_hash"] == "sha256:" + "2" * 64


def test_read_create_request_accepts_only_the_loader_namespace():
    meta = create_request_meta(
        key_hash="sha256:" + "2" * 64,
        request_fingerprint="sha256:" + "3" * 64,
    )

    assert read_create_request(meta) == meta["_ag"]["create_request"]

    meta["_ag"]["create_request"]["namespace"] = "other"
    with pytest.raises(TemplateProvenanceInvalid):
        read_create_request(meta)


def test_read_template_origin_rejects_an_unexpected_stored_shape():
    with pytest.raises(TemplateProvenanceInvalid):
        read_template_origin({"_ag": {"template_origin": "forged"}})
