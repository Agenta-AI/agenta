from typing import Optional, List, Dict
from enum import Enum

from pydantic import BaseModel

from oss.src.core.shared.dtos import Selector, Reference


class ErrorPolicy(str, Enum):
    EXCEPTION = "exception"  # Raise error on missing/cycle
    PLACEHOLDER = "placeholder"  # Replace with <missing:...>
    KEEP = "keep"  # Leave unresolved tokens as-is


class ObjectEmbed(BaseModel):
    """
    Object embed for structural replacement.

    Example:
        {
            "my_config": {
                "@ag.embed": {
                    "@ag.references": {
                        "workflow_revision": Reference(id="...", slug="..."),
                    },
                    "@ag.selector": {
                        "path": "params.prompt"
                    }
                }
            }
        }

    Keys in references dict indicate type and level:
    - workflow_artifact, workflow_variant, workflow_revision
    - environment_artifact, environment_variant, environment_revision
    """

    key: str  # JSON key where the embed is defined
    location: str  # JSON path where embed occurs
    references: Dict[str, Reference]  # e.g., {"workflow_revision": Reference(...)}
    selector: Optional[Selector] = None  # Path selector for extraction


class StringEmbed(BaseModel):
    """
    String embed for inline text interpolation.

    Example:
        {
            "prompt": "Use this: @ag.embed[@ag.references[workflow_revision.version=v1], @ag.selector[path:params.system_prompt]]"
        }

    After resolution:
        {
            "prompt": "Use this: You are a helpful assistant"
        }

    Reference format: entity_type.field=value
    - Any Reference field can be used: id, slug, version
    - Examples:
        - workflow_revision.version=v1
        - workflow_variant.id=abc-123
        - environment_revision.slug=my-env

    The token @ag.embed[...] gets replaced with the stringified resolved value.
    During resolution, the token is reconstructed from references and selector,
    found in the string at location, and replaced.
    """

    key: str  # JSON key where the string embed is defined
    location: str  # JSON path where string occurs
    references: Dict[str, Reference]  # Reference extracted from token
    selector: Optional[Selector] = None  # Path selector extracted from token


class ResolutionInfo(BaseModel):
    references_used: List[Dict[str, Reference]]  # List of references dicts used
    depth_reached: int
    embeds_resolved: int
    errors: List[str] = []
