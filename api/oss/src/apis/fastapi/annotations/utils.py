from typing import Optional, Tuple


from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import References, Flags, Data, Meta
from oss.src.core.tracing.dtos import Attributes
from oss.src.core.workflows.dtos import WorkflowFlags


log = get_module_logger(__name__)


def parse_into_attributes(
    data: Optional[Data] = None,
    meta: Optional[Meta] = None,
    references: Optional[References] = None,
    flags: Optional[Flags] = None,
) -> Attributes:
    # TODO - add error handling

    attributes: Attributes = dict(
        agenta=(
            dict(
                data=data,
                meta=meta,
                references=references,
                flags=flags,
            )
            if (data or meta or references or flags)
            else None
        )
    )

    return attributes


def parse_from_attributes(
    attributes: Attributes,
) -> Tuple[
    Optional[Data],  # data
    Optional[Meta],  # meta
    Optional[References],  # references
    Optional[Flags],  # flags
]:
    # TODO - add error handling
    agenta: dict = attributes.get("agenta", {})
    data: dict = agenta.get("data")
    meta: dict = agenta.get("meta")
    references = agenta.get("references")
    flags: dict = agenta.get("flags")

    return (
        data,
        meta,
        references,
        flags,
    )


class AnnotationFlags(WorkflowFlags):
    is_sdk: Optional[bool] = False
    is_web: Optional[bool] = False
