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
    - Part separators: , or & ; spaces trimmed
    - Name-value separator: = or : (both supported; spaces trimmed on both sides)
    - Entity reference: <entity_type>.<field>=<value>  (or using :)
      - entity_type: bare category (environment, workflow, …) or with level suffix
        (environment_revision, workflow_variant, …); same as full @ag.embed syntax
      - field: id, slug, or version
      - multiple reference params merge into the same references dict
    - key=<name>: selector key for two-hop resolution via data.references.<name>
    - path=<dotpath>: path relative to parameters. in resolved data
      - auto-prefixed with 'parameters.' — write path=system_prompt not path=parameters.system_prompt
      - defaults to 'prompt.messages.0.content' (resolved as parameters.prompt.messages.0.content)
    - missing key= auto-selects (environments only) if entity has exactly one reference entry
    """

    key: str  # JSON key where the embed is defined
    location: str  # JSON path where string occurs
    token: str  # Original @{{...}} token text
    references: Dict[str, Reference]
    selector: Optional[Selector] = None
    # selector.key == ""  → auto-select (environment only: pick single data.references entry)
    # selector.key == None → no key-hop; apply path= to entity's parameters directly
    # selector.key == "x"  → follow data.references["x"], then apply path= to secondary entity
    # selector.path stores user-written path; "parameters." prefix applied at resolution time


class ResolutionInfo(BaseModel):
    references_used: List[Dict[str, Reference]]  # List of references dicts used
    depth_reached: int
    embeds_resolved: int
    errors: List[str] = []
