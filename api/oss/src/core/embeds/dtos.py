from typing import Any, Optional, List, Dict
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
    token: Dict[str, Any]  # Original {"@ag.embed": {...}} value stored at location
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
    The original token text is stored so it can be found verbatim in the string
    during resolution without relying on reconstruction.
    """

    key: str  # JSON key where the string embed is defined
    location: str  # JSON path where string occurs
    token: str  # Original token text as it appears in the string
    references: Dict[str, Reference]  # Reference extracted from token
    selector: Optional[Selector] = None  # Path selector extracted from token


class SnippetEmbed(BaseModel):
    """
    Snippet embed for compact @{{...}} syntax.

    Example:
        {
            "greeting": "Say: @{{environment.slug=production, key=my_snippet}}"
        }

    Syntax rules:
    - Token: @{{<params>}}
    - Params are flat key=value pairs separated by , or & ; spaces are trimmed
    - Entity reference: <entity_type>.<field>=<value>
      - entity_type: bare category (environment, workflow, …) or with level suffix
        (environment_revision, workflow_variant, …); same as full @ag.embed syntax
      - field: id, slug, or version
      - multiple reference params merge into the same references dict
    - key=<name>: selector key for two-hop resolution via data.references.<name>
    - path=<dotpath>: dot-notation path into resolved data
      - defaults to 'prompt.messages.0.content' when omitted
    - missing key= auto-selects if entity has exactly one reference key
    """

    key: str  # JSON key where the embed is defined
    location: str  # JSON path where string occurs
    token: str  # Original @{{...}} token text
    references: Dict[str, Reference]
    selector: Optional[Selector] = None
    # selector.key == ""  → auto-select (key= was absent; pick the single reference)
    # selector.key == None → no key hop; apply path directly to entity data
    # selector.key == "x"  → follow data.references["x"]


class ResolutionInfo(BaseModel):
    references_used: List[Dict[str, Reference]]  # List of references dicts used
    depth_reached: int
    embeds_resolved: int
    errors: List[str] = []
