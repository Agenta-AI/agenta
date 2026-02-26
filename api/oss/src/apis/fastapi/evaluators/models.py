from typing import Optional, List, Dict, Any

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Windowing,
    Reference,
)
from oss.src.core.evaluators.dtos import (
    Evaluator,
    EvaluatorCreate,
    EvaluatorEdit,
    EvaluatorQuery,
    EvaluatorFork,
    EvaluatorRevisionsLog,
    #
    EvaluatorVariant,
    EvaluatorVariantCreate,
    EvaluatorVariantEdit,
    EvaluatorVariantQuery,
    #
    EvaluatorRevision,
    EvaluatorRevisionCreate,
    EvaluatorRevisionEdit,
    EvaluatorRevisionQuery,
    EvaluatorRevisionCommit,
    #
    SimpleEvaluator,
    SimpleEvaluatorCreate,
    SimpleEvaluatorEdit,
    SimpleEvaluatorQuery,
)


# EVALUATORS -------------------------------------------------------------------


class EvaluatorCreateRequest(BaseModel):
    evaluator: EvaluatorCreate


class EvaluatorEditRequest(BaseModel):
    evaluator: EvaluatorEdit


class EvaluatorQueryRequest(BaseModel):
    evaluator: Optional[EvaluatorQuery] = None
    #
    evaluator_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class EvaluatorForkRequest(BaseModel):
    evaluator: EvaluatorFork


class EvaluatorResponse(BaseModel):
    count: int = 0
    evaluator: Optional[Evaluator] = None


class EvaluatorsResponse(BaseModel):
    count: int = 0
    evaluators: List[Evaluator] = []


# EVALUATOR VARIANTS -----------------------------------------------------------


class EvaluatorVariantCreateRequest(BaseModel):
    evaluator_variant: EvaluatorVariantCreate


class EvaluatorVariantEditRequest(BaseModel):
    evaluator_variant: EvaluatorVariantEdit


class EvaluatorVariantQueryRequest(BaseModel):
    evaluator_variant: Optional[EvaluatorVariantQuery] = None
    #
    evaluator_refs: Optional[List[Reference]] = None
    evaluator_variant_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class EvaluatorVariantForkRequest(BaseModel):  # TODO: FIX ME
    source_evaluator_variant_ref: Reference
    target_evaluator_ref: Reference
    slug: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None


class EvaluatorRevisionsLogRequest(BaseModel):
    evaluator: EvaluatorRevisionsLog


class EvaluatorVariantResponse(BaseModel):
    count: int = 0
    evaluator_variant: Optional[EvaluatorVariant] = None


class EvaluatorVariantsResponse(BaseModel):
    count: int = 0
    evaluator_variants: List[EvaluatorVariant] = []


# EVALUATOR REVISIONS ----------------------------------------------------------


class EvaluatorRevisionCreateRequest(BaseModel):
    evaluator_revision: EvaluatorRevisionCreate


class EvaluatorRevisionEditRequest(BaseModel):
    evaluator_revision: EvaluatorRevisionEdit


class EvaluatorRevisionQueryRequest(BaseModel):
    evaluator_revision: Optional[EvaluatorRevisionQuery] = None
    #
    evaluator_refs: Optional[List[Reference]] = None
    evaluator_variant_refs: Optional[List[Reference]] = None
    evaluator_revision_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class EvaluatorRevisionCommitRequest(BaseModel):
    evaluator_revision_commit: EvaluatorRevisionCommit


class EvaluatorRevisionRetrieveRequest(BaseModel):
    evaluator_ref: Optional[Reference] = None
    evaluator_variant_ref: Optional[Reference] = None
    evaluator_revision_ref: Optional[Reference] = None


class EvaluatorRevisionResponse(BaseModel):
    count: int = 0
    evaluator_revision: Optional[EvaluatorRevision] = None


class EvaluatorRevisionsResponse(BaseModel):
    count: int = 0
    evaluator_revisions: List[EvaluatorRevision] = []


# SIMPLE EVALUATORS ------------------------------------------------------------


class SimpleEvaluatorCreateRequest(BaseModel):
    evaluator: SimpleEvaluatorCreate


class SimpleEvaluatorEditRequest(BaseModel):
    evaluator: SimpleEvaluatorEdit


class SimpleEvaluatorQueryRequest(BaseModel):
    evaluator: Optional[SimpleEvaluatorQuery] = None
    #
    evaluator_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = False
    #
    windowing: Optional[Windowing] = None


class SimpleEvaluatorResponse(BaseModel):
    count: int = 0
    evaluator: Optional[SimpleEvaluator] = None


class SimpleEvaluatorsResponse(BaseModel):
    count: int = 0
    evaluators: List[SimpleEvaluator] = []


# EVALUATOR TEMPLATES ----------------------------------------------------------


class EvaluatorTemplate(BaseModel):
    """Static evaluator template definition (built-in evaluator types)."""

    name: str
    key: str
    direct_use: bool
    settings_presets: Optional[List[Dict[str, Any]]] = None
    settings_template: Dict[str, Any]
    outputs_schema: Optional[Dict[str, Any]] = None
    description: Optional[str] = None
    oss: Optional[bool] = False
    requires_llm_api_keys: Optional[bool] = False
    tags: List[str] = []
    archived: Optional[bool] = False


class EvaluatorTemplatesResponse(BaseModel):
    count: int = 0
    templates: List[EvaluatorTemplate] = []
