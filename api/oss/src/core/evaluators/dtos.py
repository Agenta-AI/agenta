from typing import Optional
from uuid import UUID

from pydantic import Field

from oss.src.core.shared.dtos import sync_alias, AliasConfig
from oss.src.core.shared.dtos import (
    Identifier,
    Slug,
    Lifecycle,
    Header,
    Metadata,
)
from oss.src.core.workflows.dtos import (
    ArtifactFork,  # noqa: F401
    VariantFork,
    RevisionFork,
    #
    WorkflowFlags,
    WorkflowQueryFlags,
    #
    Workflow,
    WorkflowCreate,
    WorkflowEdit,
    WorkflowQuery,
    WorkflowFork,
    #
    WorkflowVariant,
    WorkflowVariantCreate,
    WorkflowVariantEdit,
    WorkflowVariantQuery,
    WorkflowVariantFork,
    #
    WorkflowRevisionData,
    #
    WorkflowRevision,
    WorkflowRevisionCreate,
    WorkflowRevisionEdit,
    WorkflowRevisionQuery,
    WorkflowRevisionFork,
    WorkflowRevisionCommit,
    WorkflowRevisionsLog,
)


# aliases ----------------------------------------------------------------------


class EvaluatorIdAlias(AliasConfig):
    evaluator_id: Optional[UUID] = None
    workflow_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="evaluator_id",
    )


class EvaluatorVariantIdAlias(AliasConfig):
    evaluator_variant_id: Optional[UUID] = None
    workflow_variant_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="evaluator_variant_id",
    )


class EvaluatorRevisionIdAlias(AliasConfig):
    evaluator_revision_id: Optional[UUID] = None
    workflow_revision_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="evaluator_revision_id",
    )


# globals ----------------------------------------------------------------------


class EvaluatorFlags(WorkflowFlags):
    def __init__(self, **data):
        data["is_evaluator"] = True

        super().__init__(**data)


class EvaluatorQueryFlags(WorkflowQueryFlags):
    def __init__(self, **data):
        data["is_evaluator"] = True

        super().__init__(**data)


# evaluators -------------------------------------------------------------------


class Evaluator(Workflow):
    flags: Optional[EvaluatorFlags] = None


class EvaluatorCreate(WorkflowCreate):
    flags: Optional[EvaluatorFlags] = None


class EvaluatorEdit(WorkflowEdit):
    flags: Optional[EvaluatorFlags] = None


class EvaluatorQuery(WorkflowQuery):
    flags: Optional[EvaluatorQueryFlags] = None


# evaluator variants -----------------------------------------------------------


class EvaluatorVariant(
    WorkflowVariant,
    EvaluatorIdAlias,
):
    flags: Optional[EvaluatorFlags] = None

    def model_post_init(self, __context) -> None:
        sync_alias("evaluator_id", "workflow_id", self)


class EvaluatorVariantCreate(
    WorkflowVariantCreate,
    EvaluatorIdAlias,
):
    flags: Optional[EvaluatorFlags] = None

    def model_post_init(self, __context) -> None:
        sync_alias("evaluator_id", "workflow_id", self)


class EvaluatorVariantEdit(WorkflowVariantEdit):
    flags: Optional[EvaluatorFlags] = None


class EvaluatorVariantQuery(WorkflowVariantQuery):
    flags: Optional[EvaluatorQueryFlags] = None


# evaluator revisions ----------------------------------------------------------


class EvaluatorRevisionData(WorkflowRevisionData):
    pass


class EvaluatorRevision(
    WorkflowRevision,
    EvaluatorIdAlias,
    EvaluatorVariantIdAlias,
):
    flags: Optional[EvaluatorFlags] = None

    data: Optional[EvaluatorRevisionData] = None

    def model_post_init(self, __context) -> None:
        sync_alias("evaluator_id", "workflow_id", self)
        sync_alias("evaluator_variant_id", "workflow_variant_id", self)


class EvaluatorRevisionCreate(
    WorkflowRevisionCreate,
    EvaluatorIdAlias,
    EvaluatorVariantIdAlias,
):
    flags: Optional[EvaluatorFlags] = None

    def model_post_init(self, __context) -> None:
        sync_alias("evaluator_id", "workflow_id", self)
        sync_alias("evaluator_variant_id", "workflow_variant_id", self)


class EvaluatorRevisionEdit(WorkflowRevisionEdit):
    flags: Optional[EvaluatorFlags] = None


class EvaluatorRevisionQuery(WorkflowRevisionQuery):
    flags: Optional[EvaluatorQueryFlags] = None


class EvaluatorRevisionCommit(
    WorkflowRevisionCommit,
    EvaluatorIdAlias,
    EvaluatorVariantIdAlias,
):
    flags: Optional[EvaluatorFlags] = None

    data: Optional[EvaluatorRevisionData] = None

    def model_post_init(self, __context) -> None:
        sync_alias("evaluator_id", "workflow_id", self)
        sync_alias("evaluator_variant_id", "workflow_variant_id", self)


class EvaluatorRevisionsLog(
    WorkflowRevisionsLog,
    EvaluatorIdAlias,
    EvaluatorVariantIdAlias,
    EvaluatorRevisionIdAlias,
):
    def model_post_init(self, __context) -> None:
        sync_alias("evaluator_id", "workflow_id", self)
        sync_alias("evaluator_variant_id", "workflow_variant_id", self)
        sync_alias("evaluator_revision_id", "workflow_revision_id", self)


# forks ------------------------------------------------------------------------


class EvaluatorRevisionFork(WorkflowRevisionFork):
    flags: Optional[EvaluatorFlags] = None

    data: Optional[EvaluatorRevisionData] = None


class EvaluatorVariantFork(WorkflowVariantFork):
    flags: Optional[EvaluatorFlags] = None


class EvaluatorRevisionForkAlias(AliasConfig):
    evaluator_revision: Optional[EvaluatorRevisionFork] = None

    revision: Optional[RevisionFork] = Field(
        default=None,
        exclude=True,
        alias="evaluator_revision",
    )


class EvaluatorVariantForkAlias(AliasConfig):
    evaluator_variant: Optional[EvaluatorVariantFork] = None

    variant: Optional[VariantFork] = Field(
        default=None,
        exclude=True,
        alias="evaluator_variant",
    )


class EvaluatorFork(
    WorkflowFork,
    EvaluatorIdAlias,
    EvaluatorVariantIdAlias,
    EvaluatorVariantForkAlias,
    EvaluatorRevisionIdAlias,
    EvaluatorRevisionForkAlias,
):
    def model_post_init(self, __context) -> None:
        sync_alias("evaluator_id", "artifact_id", self)
        sync_alias("evaluator_variant_id", "variant_id", self)
        sync_alias("evaluator_variant", "variant", self)
        sync_alias("evaluator_revision_id", "revision_id", self)
        sync_alias("evaluator_revision", "revision", self)


# evaluator services -----------------------------------------------------------

# TODO: Implement ?

# simple evaluators ------------------------------------------------------------


class SimpleEvaluatorFlags(EvaluatorFlags):
    pass


class SimpleEvaluatorQueryFlags(EvaluatorQueryFlags):
    pass


class SimpleEvaluatorData(EvaluatorRevisionData):
    pass


class SimpleEvaluator(Identifier, Slug, Lifecycle, Header, Metadata):
    flags: Optional[SimpleEvaluatorFlags] = None

    data: Optional[SimpleEvaluatorData] = None

    variant_id: Optional[UUID] = None
    revision_id: Optional[UUID] = None


class SimpleEvaluatorCreate(Slug, Header, Metadata):
    flags: Optional[SimpleEvaluatorFlags] = None

    data: Optional[SimpleEvaluatorData] = None


class SimpleEvaluatorEdit(Identifier, Header, Metadata):
    flags: Optional[SimpleEvaluatorFlags] = None

    data: Optional[SimpleEvaluatorData] = None


class SimpleEvaluatorQuery(Header, Metadata):
    flags: Optional[SimpleEvaluatorQueryFlags] = None


# ------------------------------------------------------------------------------
