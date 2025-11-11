from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID
from enum import Enum
import re

from orjson import dumps

# from json import dumps

from oss.src.utils.logging import get_module_logger
from oss.src.core.shared.dtos import Reference
from oss.src.models.api.api_models import ConfigDTO, ReferenceRequestModel
from oss.src.services.variants_manager import (
    fetch_config_by_variant_ref,
    fetch_config_by_environment_ref,
)

log = get_module_logger(__name__)

# ---------------------------------------------------------------------------- #
# POLICIES & CONSTANTS
# ---------------------------------------------------------------------------- #


class ResolutionErrorPolicy(Enum):
    """Controls how the resolver reacts to depth/cycle/missing."""

    PLACEHOLDER = "placeholder"  # replace with <kind:...> (safe, non-throwing)
    EXCEPTION = "exception"  # raise an exception (HTTP 422 at the edge)
    KEEP = "keep"  # leave token or node as-is


# Guard rails
MAX_EMBEDS: int = 100
MAX_DEPTH: int = 10

# Default policies
ON_DEPTH: ResolutionErrorPolicy = ResolutionErrorPolicy.PLACEHOLDER
ON_CYCLE: ResolutionErrorPolicy = ResolutionErrorPolicy.PLACEHOLDER
ON_MISSING: ResolutionErrorPolicy = ResolutionErrorPolicy.PLACEHOLDER

# Single selector key (+ derived helpers)
AG_REFS_KEY: str = "@ag.references"  # selector
AG_REFS_PREFIX: str = f"{AG_REFS_KEY}("  # string token prefix
AG_REFS_REGEX = re.compile(rf"{re.escape(AG_REFS_KEY)}\((.*)\)")
AG_REFS_PLACEHOLDER: str = AG_REFS_KEY.lstrip("@")

# Defaults for injection selection
STRING_DEFAULT_PATH: str = "params.prompt.messages.0.content"
OBJECT_DEFAULT_PATH: str = "params"

# ---------------------------------------------------------------------------- #
# EXCEPTIONS
# ---------------------------------------------------------------------------- #


class ResolutionError(Exception):
    """Base for resolution errors; carries optional context."""

    def __init__(
        self,
        message: str,
        *,
        token: Optional[str] = None,
        canonical: Optional[str] = None,
        path: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.token = token
        self.canonical = canonical
        self.path = path


class ResolutionEmbedsError(ResolutionError):
    """Exceeded MAX_EMBEDS while resolving (guard rail)."""

    def __init__(self, message: str, *, limit: int, count: int):
        super().__init__(message)
        self.limit = limit
        self.count = count


class ResolutionDepthError(ResolutionError):
    """Exceeded MAX_DEPTH while resolving (guard rail)."""

    pass


class ResolutionCycleError(ResolutionError):
    """Cycle could not be resolved (guard rail)."""

    pass


class ResolutionMissingError(ResolutionError):
    """References could not be resolved."""

    pass


# ---------------------------------------------------------------------------- #
# ORCHESTRATION
# ---------------------------------------------------------------------------- #


async def retrieve_and_maybe_resolve(
    project_id: str,
    user_id: str,
    #
    revision_ref: Optional[ReferenceRequestModel] = None,  # UNUSED FOR NOW
    variant_ref: Optional[ReferenceRequestModel] = None,
    artifact_ref: Optional[ReferenceRequestModel] = None,
    environment_ref: Optional[ReferenceRequestModel] = None,
    #
    resolve: bool = False,
) -> Optional["ConfigDTO"]:
    """
    Retrieve a configuration by references; optionally resolve embeds inside
    its `params` dict. Uses iterative (breadth-first) passes up to MAX_DEPTH.
    """
    config = await _retrieve_by_ref(
        project_id=project_id,
        user_id=user_id,
        #
        revision_ref=revision_ref,
        variant_ref=variant_ref,
        artifact_ref=artifact_ref,
        environment_ref=environment_ref,
    )

    if not config or not resolve:
        return config

    config.params = await resolve_by_value(
        project_id=project_id,
        user_id=user_id,
        params=config.params or {},
    )

    return config


# ---------------------------------------------------------------------------- #
# LOWEST-LEVEL FETCHER (NO RESOLUTION)
# ---------------------------------------------------------------------------- #


async def _retrieve_by_ref(
    project_id: str,
    user_id: str,
    #
    revision_ref: Optional[ReferenceRequestModel] = None,  # UNUSED FOR NOW
    variant_ref: Optional[ReferenceRequestModel] = None,
    artifact_ref: Optional[ReferenceRequestModel] = None,
    environment_ref: Optional[ReferenceRequestModel] = None,
) -> Optional["ConfigDTO"]:
    """
    Fetch a single configuration by refs, talking to the actual store.
    No resolution, no recursion. `artifact_ref` is passed as `application_ref`
    to the underlying store fetchers.
    """

    if variant_ref:
        return await fetch_config_by_variant_ref(
            project_id=project_id,
            user_id=user_id,
            variant_ref=variant_ref,
            application_ref=artifact_ref,  # boundary uses application_ref
        )

    if environment_ref:
        return await fetch_config_by_environment_ref(
            project_id=project_id,
            user_id=user_id,
            environment_ref=environment_ref,
            application_ref=artifact_ref,  # boundary uses application_ref
        )

    environment_ref = environment_ref or ReferenceRequestModel(slug="production")

    return await fetch_config_by_environment_ref(
        project_id=project_id,
        user_id=user_id,
        environment_ref=environment_ref,
        application_ref=artifact_ref,  # boundary uses application_ref
    )


# ---------------------------------------------------------------------------- #
# RESOLUTION (ITERATIVE, ASYNC, SUPPORTS STRING & OBJECT EMBEDS)
# ---------------------------------------------------------------------------- #


async def resolve_by_value(
    project_id: str,
    user_id: str,
    #
    params: dict[str, Any],
) -> dict[str, Any]:
    """
    Iteratively resolve both:
      1) String embeds: "... @ag.references(...) ..."
      2) Object embeds: {"@ag.references": "<token>", "path": "params.subpath"?}

    For string embeds, the replacement is a JSON string of the selected sub-object
    (default path = STRING_DEFAULT_PATH).

    For object embeds, the node itself is replaced with the resolved JSON object:
      - If token contains path=..., that takes precedence.
      - Else if object has "path", use it.
      - Else default to OBJECT_DEFAULT_PATH.
    """
    current: Any = params
    seen_canonical: set[str] = set()

    for pass_ix in range(MAX_DEPTH):
        # ---- 1) Gather embeds (object-nodes) and embeds (strings) ----
        # List[(path_list, token, path_hint)]
        obj_embeds = await _find_object_embeds(current)
        # List[str]
        str_embeds = await _find_string_embeds(current)

        # Combine canonicals to enforce MAX_EMBEDS across entire run
        obj_canon = {_canonicalize_token(tok) for _, tok, _ in obj_embeds}
        str_canon = {_canonicalize_token(tok) for tok in str_embeds}
        prospective = (obj_canon | str_canon) - seen_canonical
        total = len(seen_canonical) + len(prospective)
        if total > MAX_EMBEDS:
            raise ResolutionEmbedsError(
                f"Too many embeds ({total}) exceeds limit ({MAX_EMBEDS})",
                limit=MAX_EMBEDS,
                count=total,
            )

        if not prospective:
            return current

        # ---- 2) Resolve object embeds first (structural replacements) ----
        obj_replacements: Dict[Tuple[Any, ...], Any] = {}

        for path_list, token, path_hint in obj_embeds:
            canon = _canonicalize_token(token)

            if canon in seen_canonical:
                continue

            try:
                # Extract refs & possible token-level path
                _, token_path = _decode_refs_and_path(token)
                ref_kwargs = _map_token_to_refs(token)

            except Exception as e:
                if ON_MISSING == ResolutionErrorPolicy.EXCEPTION:
                    raise ResolutionMissingError(
                        f"Could not find references (object embed) at pass {pass_ix+1}/{MAX_DEPTH}",
                        token=token,
                        canonical=canon,
                        path=_path_to_str(path_list),
                    )
                if ON_MISSING == ResolutionErrorPolicy.PLACEHOLDER:
                    replacement = {AG_REFS_PLACEHOLDER: _placeholder("missing", token)}
                    obj_replacements[tuple(path_list)] = replacement
                continue

            cfg = await _retrieve_by_ref(
                project_id=project_id, user_id=user_id, **ref_kwargs
            )

            if not cfg:
                if ON_MISSING == ResolutionErrorPolicy.EXCEPTION:
                    raise ResolutionMissingError(
                        f"Could not retrieve references (object embed) at pass {pass_ix+1}/{MAX_DEPTH}",
                        token=token,
                        canonical=canon,
                        path=_path_to_str(path_list),
                    )
                if ON_MISSING == ResolutionErrorPolicy.PLACEHOLDER:
                    obj_replacements[tuple(path_list)] = {
                        AG_REFS_PLACEHOLDER: _placeholder("missing", token)
                    }
                continue

            # Determine injection subpath: token path > object path > default
            subpath = token_path or path_hint or OBJECT_DEFAULT_PATH

            try:
                inject_obj = _extract_json_path(cfg.model_dump(mode="json"), subpath)
            except Exception as e:
                if ON_MISSING == ResolutionErrorPolicy.EXCEPTION:
                    raise ResolutionMissingError(
                        f"Invalid embed path '{subpath}' (object embed) at pass {pass_ix+1}/{MAX_DEPTH}",
                        token=token,
                        canonical=canon,
                        path=_path_to_str(path_list),
                    )
                if ON_MISSING == ResolutionErrorPolicy.PLACEHOLDER:
                    obj_replacements[tuple(path_list)] = {
                        AG_REFS_PLACEHOLDER: _placeholder("missing", token)
                    }
                continue

            obj_replacements[tuple(path_list)] = inject_obj

        if obj_replacements:
            current = _apply_object_replacements(current, obj_replacements)

        seen_canonical |= obj_canon

        # ---- 3) Resolve string embeds (values-only replacement) ----
        str_mapping: Dict[str, str] = {}

        for token in sorted(str_embeds, key=len, reverse=True):
            canon = _canonicalize_token(token)

            if canon in seen_canonical:
                continue

            try:
                _, token_path = _decode_refs_and_path(token)
                ref_kwargs = _map_token_to_refs(token)
            except Exception as e:
                str_mapping[token] = _policy_render("missing", token, ON_MISSING)
                continue

            cfg = await _retrieve_by_ref(
                project_id=project_id, user_id=user_id, **ref_kwargs
            )

            if not cfg:
                str_mapping[token] = _policy_render("missing", token, ON_MISSING)
                continue

            try:
                # Determine injection subpath: token path > default
                subpath = token_path or STRING_DEFAULT_PATH
                selected = _extract_json_path(cfg.model_dump(mode="json"), subpath)

                # Avoid JSON quotes for plain strings; JSON-encode everything else
                if isinstance(selected, str):
                    resolved_text = selected
                else:
                    resolved_text = dumps(selected).decode()  # orjson

                # resolved_text = dumps(selected, ensure_ascii=False)  # json
            except Exception as e:
                resolved_text = _policy_render("missing", token, ON_MISSING)

            str_mapping[token] = resolved_text

        if str_mapping:
            current = _replace_string_embeds(current, str_mapping)

        seen_canonical |= str_canon

        # ---- 4) Cycle detection: if no progress in canonical token set, bail per policy ----
        obj_embeds_after = await _find_object_embeds(current)
        str_embeds_after = await _find_string_embeds(current)

        after_canon = {_canonicalize_token(tok) for _, tok, _ in obj_embeds_after} | {
            _canonicalize_token(tok) for tok in str_embeds_after
        }

        before_canon = obj_canon | str_canon

        if after_canon == before_canon:
            if ON_CYCLE == ResolutionErrorPolicy.EXCEPTION:
                raise ResolutionCycleError(
                    f"Cycle detected during resolution at pass {pass_ix+1}/{MAX_DEPTH}",
                    token=None,
                    canonical=None,
                    path=None,
                )

            if ON_CYCLE == ResolutionErrorPolicy.PLACEHOLDER:
                # object embeds first
                remaining_obj = {
                    tuple(p): {AG_REFS_PLACEHOLDER: _placeholder("cycle", tok)}
                    for p, tok, _ in obj_embeds_after
                }
                if remaining_obj:
                    current = _apply_object_replacements(current, remaining_obj)

                # string embeds next
                remaining_str = {
                    tok: _placeholder("cycle", tok) for tok in str_embeds_after
                }
                if remaining_str:
                    current = _replace_string_embeds(current, remaining_str)

            return current

    # Depth exceeded
    if ON_DEPTH == ResolutionErrorPolicy.EXCEPTION:
        raise ResolutionDepthError(
            f"Max resolution depth exceeded at pass {MAX_DEPTH}/{MAX_DEPTH}",
            token=None,
            canonical=None,
            path=None,
        )

    if ON_DEPTH == ResolutionErrorPolicy.PLACEHOLDER:
        leftovers_obj = await _find_object_embeds(current)
        if leftovers_obj:
            rep = {
                tuple(p): {AG_REFS_PLACEHOLDER: _placeholder("depth", tok)}
                for p, tok, _ in leftovers_obj
            }
            current = _apply_object_replacements(current, rep)

        leftovers_str = await _find_string_embeds(current)
        if leftovers_str:
            rep2 = {tok: _placeholder("depth", tok) for tok in leftovers_str}
            current = _replace_string_embeds(current, rep2)

        return current

    return current


# ---------------------------------------------------------------------------- #
# EMBED & OBJECT-EMBED FINDERS (ASYNC, OPTION B: VALUES-ONLY)
# ---------------------------------------------------------------------------- #


def _scan_embeds_in_string(text: str) -> List[str]:
    """Scan a single string for @ag.references(...) using balanced parentheses."""
    out: List[str] = []
    i = 0
    while True:
        start = text.find(AG_REFS_PREFIX, i)
        if start == -1:
            break
        depth = 1
        end: Optional[int] = None
        j = start + len(AG_REFS_PREFIX)
        while j < len(text):
            ch = text[j]
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    end = j
                    break
            j += 1
        if end is None:
            break  # unterminated; ignore
        out.append(text[start : end + 1])
        i = end + 1
    return out


async def _find_string_embeds(obj: Any) -> List[str]:
    """
    Traverse dict/list values and return all string embeds found.
    No JSON dumps; keys are not scanned.
    """
    matches: List[str] = []
    stack: List[Any] = [obj]
    while stack:
        cur = stack.pop()
        if isinstance(cur, dict):
            stack.extend(cur.values())
        elif isinstance(cur, list):
            stack.extend(cur)
        elif isinstance(cur, str):
            matches.extend(_scan_embeds_in_string(cur))
    return matches


async def _find_object_embeds(obj: Any) -> List[Tuple[List[Any], str, Optional[str]]]:
    """
    Find in-object embeds: any dict that has a string value under key '@ag.references'.
    Optional key 'path' may specify which sub-object to inject (json-path, default OBJECT_DEFAULT_PATH).

    Returns: list of (path_list, token, path_hint_or_None)
    """
    results: List[Tuple[List[Any], str, Optional[str]]] = []
    stack: List[Tuple[List[Any], Any]] = [([], obj)]
    while stack:
        path, cur = stack.pop()
        if isinstance(cur, dict):
            if AG_REFS_KEY in cur:
                raw = cur[AG_REFS_KEY]
                path_hint = cur.get("path")
                if path_hint is not None and not isinstance(path_hint, str):
                    path_hint = None

                try:
                    if isinstance(raw, str):
                        # Either a canonical token or some string; pass through (decode will validate later).
                        token = raw
                    elif isinstance(raw, dict):
                        # Normalize dict payload → canonical token string
                        token = _object_embed_dict_to_token(raw)
                    else:
                        # Unsupported type → produce a token that will fail decode and fall into policy
                        token = str(raw)
                except Exception:
                    # If normalization fails, still register an embed so policy can act.
                    # Use a token that will not decode; ON_MISSING policy will handle it downstream.
                    token = f"{AG_REFS_PREFIX}invalid)"
                results.append((path, token, path_hint))
                continue
            for k, v in cur.items():
                stack.append((path + [k], v))
        elif isinstance(cur, list):
            for i, v in enumerate(cur):
                stack.append((path + [i], v))
    return results


def _object_embed_dict_to_token(payload: dict) -> str:
    """
    Convert a dict payload under '@ag.references' into a canonical string token
    like '@ag.references(application_revision=Reference(id=...))'.

    Accepted shapes per role:
      - str (UUID-like): treated as Reference(id=<uuid>)
      - dict: may contain id/slug/version (id is parsed to UUID if present)
    """
    refs: Dict[str, Reference] = {}
    for role, value in payload.items():
        if isinstance(value, str):
            # Treat as UUID; raise if not a valid UUID so policy can handle it.
            ref = Reference(id=UUID(value))
        elif isinstance(value, dict):
            rid = value.get("id")
            slug = value.get("slug")
            version = value.get("version")
            ref = Reference(id=UUID(rid) if rid else None, slug=slug, version=version)
        else:
            raise ValueError(
                f"Unsupported reference payload type for role '{role}': {type(value)!r}"
            )
        refs[role] = ref
    return _encode_ag_references(refs)


# ---------------------------------------------------------------------------- #
# REPLACEMENT HELPERS
# ---------------------------------------------------------------------------- #


def _compile_token_union(embeds: List[str]) -> re.Pattern:
    """Regex union for exact-match substitutions."""
    if not embeds:
        return re.compile(r"^(?!)")
    parts = [re.escape(t) for t in sorted(embeds, key=len, reverse=True)]
    return re.compile("|".join(parts))


def _walk_replace_strings(
    obj: Any, token_re: re.Pattern, mapping: Dict[str, str]
) -> Any:
    """Replace only in string values; leave keys untouched."""
    if isinstance(obj, dict):
        return {k: _walk_replace_strings(v, token_re, mapping) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_walk_replace_strings(v, token_re, mapping) for v in obj]
    if isinstance(obj, str):
        return token_re.sub(lambda m: mapping[m.group(0)], obj)
    return obj


def _replace_string_embeds(obj: Any, mapping: Dict[str, str]) -> Any:
    """Apply string-token replacements across values only."""
    if not mapping:
        return obj
    token_re = _compile_token_union(list(mapping.keys()))
    return _walk_replace_strings(obj, token_re, mapping)


def _apply_object_replacements(
    obj: Any, replacements: Dict[Tuple[Any, ...], Any]
) -> Any:
    """
    Replace specific nodes (dicts) identified by exact JSON path tuples with replacement objects.
    """

    def rec(path: Tuple[Any, ...], node: Any) -> Any:
        if path in replacements:
            return replacements[path]
        if isinstance(node, dict):
            return {k: rec(path + (k,), v) for k, v in node.items()}
        if isinstance(node, list):
            return [rec(path + (i,), v) for i, v in enumerate(node)]
        return node

    return rec((), obj)


# ---------------------------------------------------------------------------- #
# EMBED PARSING / ENCODING HELPERS
# ---------------------------------------------------------------------------- #


def _policy_render(kind: str, token: str, policy: ResolutionErrorPolicy) -> str:
    """Render per policy; strip '@' from canonical in placeholders to avoid rescans."""
    canonical: Optional[str] = None

    if policy == ResolutionErrorPolicy.KEEP:
        return token

    if policy == ResolutionErrorPolicy.PLACEHOLDER:
        canonical = _canonicalize_token(token).replace("@", "")
        return f"<{kind}:{canonical}>"

    # EXCEPTION:
    try:
        canonical = _canonicalize_token(token)
    except Exception:
        pass

    if kind == "missing":
        raise ResolutionMissingError(
            "Could not find references", token=token, canonical=canonical
        )
    if kind == "cycle":
        raise ResolutionCycleError(
            "Cycle detected during resolution", token=token, canonical=canonical
        )
    if kind == "depth":
        raise ResolutionDepthError(
            "Maximum resolution depth exceeded", token=token, canonical=canonical
        )
    raise ResolutionError(f"Resolution error: {kind}", token=token, canonical=canonical)


def _placeholder(kind: str, token: str) -> str:
    """Always produce a non-rescannable placeholder string."""
    canon = _canonicalize_token(token).replace("@", "")
    return f"<{kind}:{canon}>"


def _canonicalize_token(token: str) -> str:
    """Decode then re-encode to a stable canonical string (ignores token-level path)."""
    try:
        return _encode_ag_references(_decode_ag_references(token))
    except Exception:
        return token


def _split_top_level(s: str, seps=(",", " ")) -> List[str]:
    """Split by top-level separators, ignoring inner parentheses."""
    parts: List[str] = []
    buffer: List[str] = []
    depth = 0
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if depth == 0 and ch in seps:
            frag = "".join(buffer).strip()
            if frag:
                parts.append(frag)
            buffer = []
        else:
            buffer.append(ch)
    tail = "".join(buffer).strip()
    if tail:
        parts.append(tail)
    return parts


def _parse_reference(expr: str) -> "Reference":
    """Parse Reference(id=...,slug=...,version=...) into your Pydantic Reference."""
    m = re.fullmatch(r"Reference\((.*)\)", expr.strip())
    if not m:
        raise ValueError(f"Invalid Reference expression: {expr}")
    inner = m.group(1)
    allowed = set(Reference.model_fields.keys())  # type: ignore[name-defined]
    data: Dict[str, Any] = {}
    for item in _split_top_level(inner):
        k, eq, v = item.partition("=")
        if eq != "=":
            raise ValueError(f"Corrupt field: {item!r}")
        key, val = k.strip(), v.strip()
        if key not in allowed:
            raise ValueError(f"Unknown field: {key!r}")
        if key == "id" and val:
            val = UUID(val)  # type: ignore
        data[key] = val
    return Reference(**data)  # type: ignore[name-defined]


def _decode_ag_references(s: str) -> Dict[str, "Reference"]:
    """
    Decode @ag.references(...) into a dict[str, Reference].
    Ignores non-Reference(...) items (e.g., token-level path=...).
    """
    m = AG_REFS_REGEX.fullmatch(s.strip())
    if not m:
        raise ValueError(f"Not an @{AG_REFS_KEY}(...) string")
    inner = m.group(1)
    out: Dict[str, "Reference"] = {}
    for item in _split_top_level(inner):
        k, eq, v = item.partition("=")
        if eq != "=":
            raise ValueError(f"Bad key-value: {item!r}")
        val = v.strip()
        # Only capture items that are actual Reference(...) blocks
        if re.fullmatch(r"Reference\((.*)\)", val):
            out[k.strip()] = _parse_reference(val)
        else:
            # e.g., path=... → ignored for canonicalization
            pass
    return out


def _decode_refs_and_path(s: str) -> Tuple[Dict[str, "Reference"], Optional[str]]:
    """
    Decode @ag.references(...) into (refs, token_path).
    - refs: dict[str, Reference]
    - token_path: optional str if 'path=...' is present in the token.
    """
    m = AG_REFS_REGEX.fullmatch(s.strip())
    if not m:
        raise ValueError(f"Not an @{AG_REFS_KEY}(...) string")
    inner = m.group(1)
    refs: Dict[str, "Reference"] = {}
    token_path: Optional[str] = None

    for item in _split_top_level(inner):
        k, eq, v = item.partition("=")
        if eq != "=":
            raise ValueError(f"Bad key-value: {item!r}")
        key = k.strip()
        val = v.strip()
        if key == "path":
            token_path = val  # unquoted path expression
        elif re.fullmatch(r"Reference\((.*)\)", val):
            refs[key] = _parse_reference(val)
        else:
            # Unknown non-reference key → ignore
            pass

    return refs, token_path


def _encode_ag_references(refs: Dict[str, "Reference"]) -> str:
    """Encode dict[str, Reference] into canonical @ag.references(...)."""
    parts: List[str] = []
    for key, ref in sorted(refs.items()):
        fields = ref.model_dump(exclude_none=True)  # type: ignore[attr-defined]
        inner = ",".join(f"{k}={fields[k]}" for k in sorted(fields))
        parts.append(f"{key}=Reference({inner})")
    return AG_REFS_PREFIX + " ".join(parts) + ")"


# ---------------------------------------------------------------------------- #
# PATH HELPERS (OBJECT EMBEDS, LOCATION CONTEXT)
# ---------------------------------------------------------------------------- #


def _path_to_str(path: List[Any]) -> str:
    """Render a JSON path like: meta.items[2].name"""
    out: List[str] = []
    for p in path:
        if isinstance(p, int):
            out.append(f"[{p}]")
        else:
            if not out:
                out.append(str(p))
            else:
                out.append(f".{p}")
    return "".join(out) or "$"


def _extract_json_path(config: list | dict, path: str) -> Any:
    """
    Dot-only navigation:
      - Dict/attr:  params.prompt.messages
      - List index: params.prompt.messages.0.content
    No bracket syntax is supported.
    """
    if not path:
        return config

    node: dict | list = config
    for seg in (p for p in path.split(".") if p != ""):
        is_index = seg.isdigit() or (seg.startswith("-") and seg[1:].isdigit())

        if is_index:
            if not isinstance(node, list):
                raise TypeError(f"Cannot index non-list with '{seg}' in path '{path}'")
            idx = int(seg)
            try:
                node = node[idx]
            except IndexError:
                raise IndexError(
                    f"List index {idx} out of range at '{seg}' in '{path}'"
                )
        else:
            if isinstance(node, dict):
                if seg not in node:
                    raise KeyError(f"Key '{seg}' not found in path '{path}'")
                node = node[seg]
            else:
                try:
                    node = getattr(node, seg)
                except AttributeError:
                    raise AttributeError(
                        f"Attribute '{seg}' not found in path '{path}'"
                    )

    return node


# ---------------------------------------------------------------------------- #
# EMBED → INTERNAL REFS MAPPING
# ---------------------------------------------------------------------------- #


def _map_token_to_refs(token: str) -> dict[str, Any]:
    """
    Map external keys to internal _retrieve_by_ref kwargs:
      - snippet OR application                    -> artifact_ref
      - snippet_variant OR application_variant    -> variant_ref
      - snippet_revision OR application_revision  -> revision_ref
    Returns ReferenceRequestModel instances.
    """
    refs = _decode_ag_references(token)
    artifact_ref: Optional[ReferenceRequestModel] = None
    variant_ref: Optional[ReferenceRequestModel] = None
    revision_ref: Optional[ReferenceRequestModel] = None

    # artifact_ref
    for key in ("snippet", "application"):
        if key in refs:
            artifact_ref = ReferenceRequestModel(
                id=refs[key].id,
                slug=refs[key].slug,
                version=refs[key].version,  # type: ignore
            )
            break

    # variant_ref
    for key in ("snippet_variant", "application_variant"):
        if key in refs:
            variant_ref = ReferenceRequestModel(
                id=refs[key].id,
                slug=refs[key].slug,
                version=refs[key].version,  # type: ignore
            )
            break

    # revision_ref (accepted but not used in store calls yet)
    for key in ("snippet_revision", "application_revision"):
        if key in refs:
            revision_ref = ReferenceRequestModel(
                id=refs[key].id,
                slug=refs[key].slug,
                version=refs[key].version,  # type: ignore
            )
            # LEGACY --------------------------------------------------------- #
            variant_ref = variant_ref or ReferenceRequestModel()
            variant_ref.id = variant_ref.id or refs[key].id
            variant_ref.version = variant_ref.version or refs[key].version  # type: ignore
            # ---------------------------------------------------------------- #
            break

    return dict(
        revision_ref=revision_ref,
        variant_ref=variant_ref,
        artifact_ref=artifact_ref,
    )
