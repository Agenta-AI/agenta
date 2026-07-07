"""Strict server-side validation of a committed ``parameters.agent`` value.

Nothing else guards the agent template on the write path: without this, a builder agent can commit
a ``harness.kind: "claude"`` paired with a non-Anthropic provider, or a malformed tools/skills
entry, and the commit succeeds silently — the agent then never runs or falls back. This module
validates the delta-resolved final ``parameters.agent`` object against the same strict
:class:`AgentTemplateSchema` the playground editor is generated from, adds one cross-field rule
(``claude`` requires an Anthropic-provider model), and raises :class:`AgentTemplateInvalid` naming
the offending field paths.

The commit path is also a DRAFT surface: the playground commits work-in-progress entries verbatim
(blank skill/MCP drafts, tools still in the OpenAI ``{type: "function"}`` shape it rewrites only at
run time, bare builtin tools like ``{type: "web_search"}``). So ``tools`` / ``mcps`` / ``skills``
are validated entry-wise with a shape-vs-completeness split: wrong SHAPE (unknown keys, wrong
types, an invalid typed tool config) rejects; INCOMPLETENESS (missing / blank / mid-edit values)
is tolerated for skills and mcps, mirroring the frontend's own run-time drop rules. Tools tolerate
incompleteness only through the loose/legacy passthrough shapes (function-shape, flat, bare
builtin) — a TYPED tool entry (``type`` in the config union) must be complete, since typed configs
come from discovery output or the agent's own commit, both of which emit complete entries.
``@ag.embed`` entries always pass through untouched, so the default agent-template overlay stays
committable.

The harness -> provider constraint is read from the single capability source of truth
(:func:`agenta.sdk.agents.capabilities.harness_allows_provider`); it is never re-encoded here.
"""

from typing import Any, Dict, FrozenSet, List, Optional

from pydantic import ValidationError

from agenta.sdk.utils.types import AgentTemplateSchema, SkillTemplateSchema
from agenta.sdk.agents.capabilities import harness_allows_provider
from agenta.sdk.agents.mcp.models import MCPServerConfig
from agenta.sdk.agents.tools.models import TOOL_CONFIG_ADAPTER

from oss.src.core.workflows.types import AgentTemplateInvalid

# The agent template sits at ``parameters.agent`` (like the prompt template at
# ``parameters.prompt``); the builtin interface binds ``agenta:builtin:agent:v0``. Presence of the
# ``agent`` key is the trigger — the uri is a secondary signal only.
AGENT_TEMPLATE_URI_PREFIX = "agenta:builtin:agent"
_AGENT_PARAMETER_KEY = "agent"
_EMBED_MARKER = "@ag.embed"

_ROOT = "parameters.agent"

# The ``type`` values of the canonical typed tool-config union. Anything else is the loose legacy
# surface (OpenAI function shape, flat ``{name, ...}``, bare builtin names) the runtime coerces.
_TYPED_TOOL_KINDS: FrozenSet[str] = frozenset(
    {"builtin", "gateway", "code", "client", "reference", "platform"}
)

# Error types that signal an incomplete (draft) entry rather than a wrong shape. Dropped for the
# entry-wise skill/MCP checks so a work-in-progress config stays committable.
_INCOMPLETENESS_ERROR_TYPES: FrozenSet[str] = frozenset(
    {"missing", "string_too_short", "string_pattern_mismatch"}
)


def _is_embed(entry: Any) -> bool:
    return isinstance(entry, dict) and _EMBED_MARKER in entry


def _extract_agent(data: Any) -> Any:
    """Return the raw value at ``data.parameters.agent`` (any type), or ``None`` when absent.

    ``None`` means "not an agent template" — the caller skips validation. A present-but-non-dict
    value is returned as-is so the schema pass flags it.
    """
    parameters = getattr(data, "parameters", None)
    if not isinstance(parameters, dict):
        return None
    if _AGENT_PARAMETER_KEY not in parameters:
        return None
    return parameters[_AGENT_PARAMETER_KEY]


def _convert_errors(
    exc: ValidationError,
    *,
    prefix: str,
    ignore_types: FrozenSet[str] = frozenset(),
) -> List[Dict[str, Any]]:
    converted: List[Dict[str, Any]] = []
    for error in exc.errors():
        error_type = error.get("type", "")
        if error_type in ignore_types:
            continue
        loc = ".".join(str(part) for part in error.get("loc", ()))
        full_loc = f"{prefix}.{loc}" if loc else prefix
        converted.append(
            {
                "loc": full_loc,
                "msg": error.get("msg", ""),
                "type": error_type,
            }
        )
    return converted


def _infer_provider(agent: Dict[str, Any]) -> Optional[str]:
    llm = agent.get("llm")
    if not isinstance(llm, dict):
        return None
    provider = llm.get("provider")
    if isinstance(provider, str) and provider.strip():
        return provider.strip()
    model = llm.get("model")
    if isinstance(model, str) and "/" in model:
        return model.split("/", 1)[0].strip() or None
    return None


def _harness_provider_errors(agent: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The one cross-field rule: a ``claude`` harness requires an Anthropic-provider model.

    Only enforced when the provider is determinable (an explicit ``llm.provider`` or a
    ``provider/model`` string). A bare Claude alias (``sonnet``) with no provider is left alone so
    the harness's implicit Anthropic default stays committable.
    """
    harness = agent.get("harness")
    kind = harness.get("kind") if isinstance(harness, dict) else None
    if kind != "claude":
        return []
    provider = _infer_provider(agent)
    if provider is None or harness_allows_provider("claude", provider):
        return []
    return [
        {
            "loc": f"{_ROOT}.llm.provider",
            "msg": (
                "Harness 'claude' requires an Anthropic-provider model; "
                f"got provider '{provider}'."
            ),
            "type": "value_error.harness_provider",
        }
    ]


def _tool_errors(tools: List[Any]) -> List[Dict[str, Any]]:
    errors: List[Dict[str, Any]] = []
    for index, entry in enumerate(tools):
        if _is_embed(entry):
            continue
        prefix = f"{_ROOT}.tools.{index}"
        if not isinstance(entry, dict):
            errors.append(
                {
                    "loc": prefix,
                    "msg": "Tool entry must be an object or an @ag.embed reference.",
                    "type": "type_error.tool",
                }
            )
            continue
        kind = entry.get("type")
        if isinstance(kind, str) and kind in _TYPED_TOOL_KINDS:
            try:
                TOOL_CONFIG_ADAPTER.validate_python(entry)
            except ValidationError as exc:
                errors.extend(_convert_errors(exc, prefix=prefix))
            continue
        # Loose legacy surfaces the runtime coerces (and the playground commits verbatim):
        # the OpenAI function shape, the flat named shape, and bare builtin type strings.
        if isinstance(kind, str) and kind:
            continue
        if kind is None and (
            isinstance(entry.get("name"), str)
            or isinstance(entry.get("function"), dict)
        ):
            continue
        errors.append(
            {
                "loc": prefix,
                "msg": (
                    "Unrecognized tool configuration shape; expected a typed tool config "
                    f"(type in {sorted(_TYPED_TOOL_KINDS)}), an OpenAI function tool, or an "
                    "@ag.embed reference."
                ),
                "type": "value_error.tool_shape",
            }
        )
    return errors


def _skill_errors(skills: List[Any]) -> List[Dict[str, Any]]:
    errors: List[Dict[str, Any]] = []
    for index, entry in enumerate(skills):
        if _is_embed(entry):
            continue
        try:
            SkillTemplateSchema.model_validate(entry)
        except ValidationError as exc:
            errors.extend(
                _convert_errors(
                    exc,
                    prefix=f"{_ROOT}.skills.{index}",
                    ignore_types=_INCOMPLETENESS_ERROR_TYPES,
                )
            )
    return errors


def _mcp_errors(mcps: List[Any]) -> List[Dict[str, Any]]:
    errors: List[Dict[str, Any]] = []
    for index, entry in enumerate(mcps):
        try:
            MCPServerConfig.model_validate(entry)
        except ValidationError as exc:
            errors.extend(
                _convert_errors(
                    exc,
                    prefix=f"{_ROOT}.mcps.{index}",
                    ignore_types=_INCOMPLETENESS_ERROR_TYPES,
                )
            )
    return errors


def _collect_errors(agent: Any) -> List[Dict[str, Any]]:
    errors: List[Dict[str, Any]] = []

    # The list sections are validated entry-wise below (with the draft/legacy tolerance the
    # playground's committed shapes need), so blank them for the strict top-level pass.
    top_level = agent
    if isinstance(agent, dict):
        top_level = {
            **agent,
            **{
                key: []
                for key in ("tools", "mcps", "skills")
                if isinstance(agent.get(key), list)
            },
        }

    try:
        AgentTemplateSchema.model_validate(top_level)
    except ValidationError as exc:
        errors.extend(_convert_errors(exc, prefix=_ROOT))

    if isinstance(agent, dict):
        if isinstance(agent.get("tools"), list):
            errors.extend(_tool_errors(agent["tools"]))
        if isinstance(agent.get("skills"), list):
            errors.extend(_skill_errors(agent["skills"]))
        if isinstance(agent.get("mcps"), list):
            errors.extend(_mcp_errors(agent["mcps"]))
        errors.extend(_harness_provider_errors(agent))

    return errors


def is_agent_template_data(data: Any) -> bool:
    """Whether ``data`` carries an agent template (a ``parameters.agent`` value)."""
    return _extract_agent(data) is not None


def validate_agent_template(data: Any) -> None:
    """Validate ``data``'s ``parameters.agent`` value; no-op when ``data`` is not an agent template.

    Raises :class:`AgentTemplateInvalid` (translated to a structured HTTP 400 at the boundary) when
    the value fails the strict schema, an entry-wise tools/skills/mcps shape check, or the
    claude/provider rule.
    """
    agent = _extract_agent(data)
    if agent is None:
        return
    errors = _collect_errors(agent)
    if errors:
        raise AgentTemplateInvalid(errors=errors)


def format_agent_template_errors(errors: List[Dict[str, Any]]) -> str:
    """Human-readable one-line rendering of the field-path errors (for string-detail callers)."""
    return "; ".join(
        f"{error.get('loc', '')}: {error.get('msg', '')}".strip(": ")
        for error in errors
    )
