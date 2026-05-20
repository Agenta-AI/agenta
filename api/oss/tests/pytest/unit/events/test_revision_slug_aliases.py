"""DTO slug-alias cascade for git-backed revision/variant entities.

Revision events for git-backed entities historically carried only the parent
artifact/variant *ids* — never their slugs — because a revision row only stores
ids. The DAO now resolves the parent slugs (via eager-loaded relationships) onto
the generic `Revision`/`Variant` DTOs as `artifact_slug` / `variant_slug`, and
each domain layer aliases those up to domain-specific names so the event builder
can surface them.

Naming convention (mirrors the existing `*_id` aliases): the parent *artifact*
slug drops the word "artifact" and surfaces as `<domain>_slug`; the *variant*
slug keeps the word and surfaces as `<domain>_variant_slug`.

These tests pin the cascade because it is the fragile part of the fix: each
higher DTO is constructed from the *dump* of the layer below it (e.g.
`ApplicationRevision(**workflow_revision.model_dump())`), so the alias has to
survive every hop — exactly how the services build these objects.
"""

from uuid import uuid4

import pytest

from oss.src.core.git.dtos import Revision, Variant
from oss.src.core.workflows.dtos import WorkflowRevision, WorkflowVariant
from oss.src.core.applications.dtos import ApplicationRevision, ApplicationVariant
from oss.src.core.evaluators.dtos import EvaluatorRevision, EvaluatorVariant
from oss.src.core.queries.dtos import QueryRevision, QueryVariant

# Aliased so pytest does not try to collect these `Test*`-prefixed DTO classes
# as test cases.
from oss.src.core.testsets.dtos import (
    TestsetRevision as TestsetRevisionDTO,
    TestsetVariant as TestsetVariantDTO,
)
from oss.src.core.environments.dtos import EnvironmentRevision, EnvironmentVariant

# These DTOs are model classes, not test cases; tell pytest not to collect them
# (their `Testset*` names otherwise trip PytestCollectionWarning).
TestsetRevisionDTO.__test__ = False
TestsetVariantDTO.__test__ = False


ARTIFACT_SLUG = "my-artifact-slug"
VARIANT_SLUG = "my-variant-slug"


def _dao_revision_dump() -> dict:
    """What the git DAO now returns: a generic Revision with parent slugs filled."""
    return Revision(
        id=uuid4(),
        slug="rev-v1",
        version="1",
        artifact_id=uuid4(),
        variant_id=uuid4(),
        artifact_slug=ARTIFACT_SLUG,
        variant_slug=VARIANT_SLUG,
    ).model_dump(mode="json")


# --- generic git layer --------------------------------------------------------


def test_generic_revision_carries_parent_slugs():
    rev = Revision(**_dao_revision_dump())
    assert rev.artifact_slug == ARTIFACT_SLUG
    assert rev.variant_slug == VARIANT_SLUG
    # The revision's own slug is distinct from its parents' slugs.
    assert rev.slug == "rev-v1"


def test_generic_variant_carries_parent_artifact_slug():
    var = Variant(
        id=uuid4(),
        slug="variant-own-slug",
        artifact_id=uuid4(),
        artifact_slug=ARTIFACT_SLUG,
    )
    assert var.artifact_slug == ARTIFACT_SLUG
    assert var.slug == "variant-own-slug"


# --- workflow layer (one hop from generic) ------------------------------------


def test_workflow_revision_aliases_parent_slugs():
    rev = WorkflowRevision(**_dao_revision_dump())
    assert rev.workflow_slug == ARTIFACT_SLUG
    assert rev.workflow_variant_slug == VARIANT_SLUG
    # generic names stay in sync
    assert rev.artifact_slug == ARTIFACT_SLUG
    assert rev.variant_slug == VARIANT_SLUG
    # surviving a dump round-trip emits the domain-prefixed names
    dump = rev.model_dump(mode="json")
    assert dump["workflow_slug"] == ARTIFACT_SLUG
    assert dump["workflow_variant_slug"] == VARIANT_SLUG


def test_workflow_variant_aliases_parent_artifact_slug():
    var = WorkflowVariant(
        id=uuid4(),
        slug="variant-own-slug",
        artifact_id=uuid4(),
        artifact_slug=ARTIFACT_SLUG,
    )
    assert var.workflow_slug == ARTIFACT_SLUG
    assert var.artifact_slug == ARTIFACT_SLUG


# --- domains that extend WorkflowRevision (two hops) --------------------------
#
# Services build these from the dump of an intermediate WorkflowRevision, so the
# test mirrors that path rather than constructing directly from a raw Revision.


@pytest.mark.parametrize(
    "revision_cls,domain",
    [
        (ApplicationRevision, "application"),
        (EvaluatorRevision, "evaluator"),
    ],
)
def test_workflow_backed_domain_revision_cascades_slugs(revision_cls, domain):
    workflow_dump = WorkflowRevision(**_dao_revision_dump()).model_dump(mode="json")
    rev = revision_cls(**workflow_dump)
    assert getattr(rev, f"{domain}_slug") == ARTIFACT_SLUG
    assert getattr(rev, f"{domain}_variant_slug") == VARIANT_SLUG
    # all lower-layer names remain in sync
    assert rev.workflow_slug == ARTIFACT_SLUG
    assert rev.workflow_variant_slug == VARIANT_SLUG
    assert rev.artifact_slug == ARTIFACT_SLUG
    assert rev.variant_slug == VARIANT_SLUG
    # revision's own slug untouched by parent aliasing
    assert rev.slug == "rev-v1"


@pytest.mark.parametrize(
    "variant_cls,domain",
    [
        (ApplicationVariant, "application"),
        (EvaluatorVariant, "evaluator"),
    ],
)
def test_workflow_backed_domain_variant_cascades_artifact_slug(variant_cls, domain):
    workflow_dump = WorkflowVariant(
        id=uuid4(),
        slug="variant-own-slug",
        artifact_id=uuid4(),
        artifact_slug=ARTIFACT_SLUG,
    ).model_dump(mode="json")
    var = variant_cls(**workflow_dump)
    assert getattr(var, f"{domain}_slug") == ARTIFACT_SLUG
    assert var.artifact_slug == ARTIFACT_SLUG


# --- domains that extend Revision directly (one hop) --------------------------


@pytest.mark.parametrize(
    "revision_cls,domain",
    [
        (QueryRevision, "query"),
        (TestsetRevisionDTO, "testset"),
        (EnvironmentRevision, "environment"),
    ],
)
def test_revision_backed_domain_revision_aliases_slugs(revision_cls, domain):
    rev = revision_cls(**_dao_revision_dump())
    assert getattr(rev, f"{domain}_slug") == ARTIFACT_SLUG
    assert getattr(rev, f"{domain}_variant_slug") == VARIANT_SLUG
    assert rev.artifact_slug == ARTIFACT_SLUG
    assert rev.variant_slug == VARIANT_SLUG
    assert rev.slug == "rev-v1"


@pytest.mark.parametrize(
    "variant_cls,domain",
    [
        (QueryVariant, "query"),
        (TestsetVariantDTO, "testset"),
        (EnvironmentVariant, "environment"),
    ],
)
def test_revision_backed_domain_variant_aliases_artifact_slug(variant_cls, domain):
    var = variant_cls(
        id=uuid4(),
        slug="variant-own-slug",
        artifact_id=uuid4(),
        artifact_slug=ARTIFACT_SLUG,
    )
    assert getattr(var, f"{domain}_slug") == ARTIFACT_SLUG
    assert var.artifact_slug == ARTIFACT_SLUG


# --- absent slugs (DAO could not resolve) survive the cascade as None ---------


def test_unresolved_parent_slugs_stay_none_through_cascade():
    dump = Revision(
        id=uuid4(),
        slug="rev-v1",
        version="1",
        artifact_id=uuid4(),
        variant_id=uuid4(),
        # artifact_slug / variant_slug intentionally unset
    ).model_dump(mode="json")

    application = ApplicationRevision(
        **WorkflowRevision(**dump).model_dump(mode="json")
    )
    assert application.application_slug is None
    assert application.application_variant_slug is None

    query = QueryRevision(**dump)
    assert query.query_slug is None
    assert query.query_variant_slug is None
