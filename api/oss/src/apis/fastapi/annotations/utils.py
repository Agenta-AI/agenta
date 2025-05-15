from typing import Optional, Tuple


from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import References, Flags, Data, Metadata
from oss.src.core.tracing.dtos import Attributes
from oss.src.core.workflows.dtos import WorkflowFlags


log = get_module_logger(__name__)


def parse_into_attributes(
    data: Optional[Data] = None,
    metadata: Optional[Metadata] = None,
    references: Optional[References] = None,
    flags: Optional[Flags] = None,
) -> Attributes:
    # TODO - add error handling

    attributes: Attributes = dict(
        agenta=(
            dict(
                data=data,
                metadata=metadata,
                references=references,
                flags=flags,
            )
            if (data or metadata or references or flags)
            else None
        )
    )

    return attributes


def parse_from_attributes(
    attributes: Attributes,
) -> Tuple[
    Optional[Data],  # data
    Optional[Metadata],  # metadata
    Optional[References],  # references
    Optional[Flags],  # flags
]:
    # TODO - add error handling
    agenta: dict = attributes.get("agenta", {})
    data: dict = agenta.get("data")
    metadata: dict = agenta.get("metadata")
    references = agenta.get("references")
    flags: dict = agenta.get("flags")

    return (
        data,
        metadata,
        references,
        flags,
    )


class AnnotationFlags(WorkflowFlags):
    is_sdk: Optional[bool] = False
    is_web: Optional[bool] = False
