"""
Pure utility functions for resolving embedded references.

These functions are called by services (WorkflowsService, EnvironmentsService)
to resolve embedded references in their configurations.
"""

from typing import Dict, Any, List, Set, Callable, Awaitable, Optional, Tuple
from copy import deepcopy
from json import dumps
import re

from agenta.sdk.utils.types import resolve_any
from oss.src.utils.logging import get_module_logger
from oss.src.core.embeds.dtos import (
    ObjectEmbed,
    StringEmbed,
    SnippetEmbed,
    ResolutionInfo,
    ErrorPolicy,
)
from oss.src.core.embeds.exceptions import (
    CircularEmbedError,
    MaxDepthExceededError,
    MaxEmbedsExceededError,
    MixedEntityTypesError,
    PathExtractionError,
    EmbedNotFoundError,
)
from oss.src.core.shared.dtos import Reference, Selector


log = get_module_logger(__name__)


# Constants
MAX_DEPTH = 10
MAX_EMBEDS = 100
AG_EMBED_KEY = "@ag.embed"
AG_REFERENCES_KEY = "@ag.references"
AG_SELECTOR_KEY = "@ag.selector"
SNIPPET_DEFAULT_PATH = "prompt.messages.0.content"

# Entity hierarchy: category → ordered levels (shallow to deep)
ENTITY_HIERARCHY: Dict[str, List[str]] = {
    "workflow": ["artifact", "variant", "revision"],
    "environment": ["artifact", "variant", "revision"],
    "application": ["artifact", "variant", "revision"],
    "evaluator": ["artifact", "variant", "revision"],
}

# Level → integer depth for comparison (higher = deeper = primary target)
LEVEL_ORDER: Dict[str, int] = {"artifact": 0, "variant": 1, "revision": 2}


def _debug_shape(value: Any) -> Dict[str, Any]:
    """Compact structural snapshot for resolver error logs."""
    if isinstance(value, dict):
        return {
            "type": "dict",
            "keys": sorted(list(value.keys()))[:25],
        }
    if isinstance(value, list):
        return {
            "type": "list",
            "len": len(value),
        }
    return {"type": type(value).__name__}


def _extract_with_sdk_resolver(
    *,
    data: Any,
    path: str,
    original_config: Dict[str, Any],
) -> Any:
    """Resolve nested paths via SDK helper and normalize path failures."""
    try:
        return resolve_any(path, data)
    except Exception as e:
        raise PathExtractionError(path, original_config) from e


def _revision_data_or_self(value: Any) -> Any:
    """
    Selector paths are evaluated against revision.data.

    Keep a compatibility fallback for tests/custom resolvers that still return
    the data payload directly.
    """
    if isinstance(value, dict) and "data" in value:
        return value["data"]
    return value


def _require_revision_data(
    *,
    resolved_value: Any,
    path: str,
) -> Dict[str, Any]:
    """Strictly require revision.data for path/key resolution."""
    if not isinstance(resolved_value, dict):
        raise PathExtractionError(path, {"value": resolved_value})
    data = resolved_value.get("data")
    if not isinstance(data, dict):
        raise PathExtractionError(path, resolved_value)
    return data


def _require_revision_data_parameters(
    *,
    resolved_value: Any,
) -> Dict[str, Any]:
    """Strictly require revision.data.parameters for snippet path resolution."""
    data = _require_revision_data(
        resolved_value=resolved_value,
        path="data",
    )
    parameters = data.get("parameters")
    if not isinstance(parameters, dict):
        raise PathExtractionError("data.parameters", resolved_value)
    return data


def _require_revision_data_references(
    *,
    resolved_value: Any,
) -> Dict[str, Any]:
    """Strictly require revision.data.references for key resolution."""
    data = _require_revision_data(
        resolved_value=resolved_value,
        path="data",
    )
    references = data.get("references")
    if not isinstance(references, dict):
        raise PathExtractionError("data.references", resolved_value)
    return references


def _lookup_reference_entry(
    *,
    references: Dict[str, Any],
    selector_key: str,
) -> Any:
    """
    Resolve selector key in references.

    Supports:
    - literal keys (including dots), e.g. "snippet.default"
    - nested dict traversal fallback, e.g. references["snippet"]["default"]
    """
    if selector_key in references:
        return references[selector_key]

    if "." in selector_key:
        current: Any = references
        traversed = True
        for part in selector_key.split("."):
            if not isinstance(current, dict) or part not in current:
                traversed = False
                break
            current = current[part]
        if traversed:
            return current

    # Compatibility fallback for environment deployment references:
    # key may be an application variant slug (e.g. "snippet.default")
    # while the map key is "<app>.revision" (e.g. "snippet.revision").
    for refs_value in references.values():
        if not isinstance(refs_value, dict):
            continue
        app_variant = refs_value.get("application_variant")
        if isinstance(app_variant, dict) and app_variant.get("slug") == selector_key:
            return refs_value

    return None


def create_universal_resolver(
    *,
    project_id: Any,  # UUID
    include_archived: bool,
    #
    workflows_service: Optional[Any] = None,
    environments_service: Optional[Any] = None,
    applications_service: Optional[Any] = None,
    evaluators_service: Optional[Any] = None,
) -> Callable[[Dict[str, Reference]], Awaitable[Dict[str, Any]]]:
    """
    Create a universal resolver that can handle ANY entity type.

    This resolver automatically routes to the appropriate service based on
    entity_type, so any entity can reference any other entity.

    The resolver accepts a dict of references (all same family). For multi-reference
    embeds (e.g., variant + revision), it uses the variant ref for scoped lookup.

    Args:
        project_id: Project context
        include_archived: Whether to include archived entities
        workflows_service: Optional workflows service
        environments_service: Optional environments service
        applications_service: Optional applications service
        evaluators_service: Optional evaluators service

    Returns:
        Universal resolver callback accepting Dict[str, Reference]
    """
    from oss.src.core.embeds.exceptions import (
        UnsupportedReferenceTypeError,
        EmbedNotFoundError,
    )

    async def _resolve_revision_with_normalization(
        *,
        ref: Reference,
        fetch_revision_by_refs: Callable[
            [Optional[Reference], Optional[Reference]],
            Awaitable[Optional[Any]],
        ],
    ) -> Optional[Any]:
        # First try exact revision lookup (id/slug/version as provided)
        entity = await fetch_revision_by_refs(None, ref)
        if entity:
            return entity

        # If id lookup failed there is nothing else to normalize
        if ref.id is not None:
            return None

        # Normalization only:
        # slug=<artifact-slug>, version=v1 while revision slug=<artifact-slug>-v1
        if ref.slug and ref.version and not ref.slug.endswith(f"-{ref.version}"):
            normalized_ref = Reference(
                slug=f"{ref.slug}-{ref.version}",
                version=ref.version,
            )
            return await fetch_revision_by_refs(None, normalized_ref)

        return None

    async def resolver_callback(references: Dict[str, Reference]) -> Dict[str, Any]:
        # Parse all entity types to extract category and levels.
        # All references are guaranteed same-family by _resolve_references.
        parsed: Dict[str, Reference] = {}  # level -> ref
        category: Optional[str] = None

        for entity_type, ref in references.items():
            if "_" in entity_type:
                cat, level = entity_type.split("_", 1)
            else:
                cat, level = entity_type, "artifact"
            category = cat
            parsed[level] = ref

        # Find the deepest level (primary target to fetch)
        deepest_level = max(parsed.keys(), key=lambda lvl: LEVEL_ORDER.get(lvl, -1))

        # Extract scoping refs by level
        variant_ref: Optional[Reference] = parsed.get("variant")
        revision_ref: Optional[Reference] = parsed.get("revision")
        artifact_ref: Optional[Reference] = parsed.get("artifact")

        # Prefer variant for scoping; fall back to artifact.
        # Both carry whatever identifying fields the caller provided (id, slug, version).
        scoping_ref: Optional[Reference] = variant_ref or artifact_ref

        # Route to appropriate service
        if category == "workflow":
            if not workflows_service:
                raise UnsupportedReferenceTypeError(
                    f"{category} (service not available)"
                )

            if deepest_level == "revision":
                entity = await _resolve_revision_with_normalization(
                    ref=revision_ref,
                    fetch_revision_by_refs=lambda vref, rref: (
                        workflows_service.fetch_workflow_revision(
                            project_id=project_id,
                            workflow_variant_ref=vref or scoping_ref,
                            workflow_revision_ref=rref,
                            include_archived=include_archived,
                        )
                    ),
                )
                if not entity or not entity.data:
                    raise EmbedNotFoundError(
                        f"Workflow revision not found: {revision_ref}"
                    )
                return entity.model_dump(mode="json")

            elif deepest_level == "variant":
                entity = await workflows_service.fetch_workflow_revision(
                    project_id=project_id,
                    workflow_variant_ref=variant_ref,
                    include_archived=include_archived,
                )
                if not entity or not entity.data:
                    raise EmbedNotFoundError(
                        f"Workflow revision not found for variant: {variant_ref}"
                    )
                return entity.model_dump(mode="json")

            elif deepest_level == "artifact":
                entity = await workflows_service.fetch_workflow_revision(
                    project_id=project_id,
                    workflow_ref=artifact_ref,
                    include_archived=include_archived,
                )
                if not entity or not entity.data:
                    raise EmbedNotFoundError(
                        f"Workflow revision not found for workflow: {artifact_ref}"
                    )
                return entity.model_dump(mode="json")

            else:
                raise UnsupportedReferenceTypeError(
                    f"Unsupported level: {deepest_level}"
                )

        elif category == "environment":
            if not environments_service:
                raise UnsupportedReferenceTypeError(
                    f"{category} (service not available)"
                )

            if deepest_level == "revision":
                entity = await _resolve_revision_with_normalization(
                    ref=revision_ref,
                    fetch_revision_by_refs=lambda vref, rref: (
                        environments_service.fetch_environment_revision(
                            project_id=project_id,
                            environment_variant_ref=vref or scoping_ref,
                            environment_revision_ref=rref,
                            include_archived=include_archived,
                        )
                    ),
                )
                if not entity or not entity.data:
                    raise EmbedNotFoundError(
                        f"Environment revision not found: {revision_ref}"
                    )
                return entity.model_dump(mode="json")

            elif deepest_level == "variant":
                entity = await environments_service.fetch_environment_revision(
                    project_id=project_id,
                    environment_variant_ref=variant_ref,
                    include_archived=include_archived,
                )
                if not entity or not entity.data:
                    raise EmbedNotFoundError(
                        f"Environment revision not found for variant: {variant_ref}"
                    )
                return entity.model_dump(mode="json")

            elif deepest_level == "artifact":
                entity = await environments_service.fetch_environment_revision(
                    project_id=project_id,
                    environment_ref=artifact_ref,
                    include_archived=include_archived,
                )
                if not entity or not entity.data:
                    raise EmbedNotFoundError(
                        f"Environment revision not found for environment: {artifact_ref}"
                    )
                return entity.model_dump(mode="json")

            else:
                raise UnsupportedReferenceTypeError(
                    f"Unsupported level: {deepest_level}"
                )

        elif category == "application":
            if not applications_service:
                raise UnsupportedReferenceTypeError(
                    f"{category} (service not available)"
                )

            if deepest_level == "revision":
                entity = await _resolve_revision_with_normalization(
                    ref=revision_ref,
                    fetch_revision_by_refs=lambda vref, rref: (
                        applications_service.fetch_application_revision(
                            project_id=project_id,
                            application_variant_ref=vref or scoping_ref,
                            application_revision_ref=rref,
                            include_archived=include_archived,
                        )
                    ),
                )
                if not entity or not entity.data:
                    raise EmbedNotFoundError(
                        f"Application revision not found: {revision_ref}"
                    )
                return entity.model_dump(mode="json")

            elif deepest_level == "variant":
                entity = await applications_service.fetch_application_revision(
                    project_id=project_id,
                    application_variant_ref=variant_ref,
                    include_archived=include_archived,
                )
                if not entity or not entity.data:
                    raise EmbedNotFoundError(
                        f"Application revision not found for variant: {variant_ref}"
                    )
                return entity.model_dump(mode="json")

            elif deepest_level == "artifact":
                entity = await applications_service.fetch_application_revision(
                    project_id=project_id,
                    application_ref=artifact_ref,
                    include_archived=include_archived,
                )
                if not entity or not entity.data:
                    raise EmbedNotFoundError(
                        f"Application revision not found for application: {artifact_ref}"
                    )
                return entity.model_dump(mode="json")

            else:
                raise UnsupportedReferenceTypeError(
                    f"Unsupported level: {deepest_level}"
                )

        elif category == "evaluator":
            if not evaluators_service:
                raise UnsupportedReferenceTypeError(
                    f"{category} (service not available)"
                )

            if deepest_level == "revision":
                entity = await _resolve_revision_with_normalization(
                    ref=revision_ref,
                    fetch_revision_by_refs=lambda vref, rref: (
                        evaluators_service.fetch_evaluator_revision(
                            project_id=project_id,
                            evaluator_variant_ref=vref or scoping_ref,
                            evaluator_revision_ref=rref,
                            include_archived=include_archived,
                        )
                    ),
                )
                if not entity or not entity.data:
                    raise EmbedNotFoundError(
                        f"Evaluator revision not found: {revision_ref}"
                    )
                return entity.model_dump(mode="json")

            elif deepest_level == "variant":
                entity = await evaluators_service.fetch_evaluator_revision(
                    project_id=project_id,
                    evaluator_variant_ref=variant_ref,
                    include_archived=include_archived,
                )
                if not entity or not entity.data:
                    raise EmbedNotFoundError(
                        f"Evaluator revision not found for variant: {variant_ref}"
                    )
                return entity.model_dump(mode="json")

            elif deepest_level == "artifact":
                entity = await evaluators_service.fetch_evaluator_revision(
                    project_id=project_id,
                    evaluator_ref=artifact_ref,
                    include_archived=include_archived,
                )
                if not entity or not entity.data:
                    raise EmbedNotFoundError(
                        f"Evaluator revision not found for evaluator: {artifact_ref}"
                    )
                return entity.model_dump(mode="json")

            else:
                raise UnsupportedReferenceTypeError(
                    f"Unsupported level: {deepest_level}"
                )

        else:
            raise UnsupportedReferenceTypeError(
                f"Unsupported entity category: {category}"
            )

    return resolver_callback


async def resolve_embeds(
    *,
    configuration: Dict[str, Any],
    resolver_callback: Callable[[Dict[str, Reference]], Awaitable[Dict[str, Any]]],
    #
    max_depth: int = MAX_DEPTH,
    max_embeds: int = MAX_EMBEDS,
    error_policy: ErrorPolicy = ErrorPolicy.EXCEPTION,
) -> tuple[Dict[str, Any], ResolutionInfo]:
    """
    Resolve embedded references in a configuration.

    This is a pure orchestration function that:
    1. Finds embeds in the config
    2. Calls resolver_callback to fetch each referenced entity
    3. Inlines the resolved values
    4. Handles cycles, depth limits, and errors

    Args:
        configuration: Config with potential embeds
        resolver_callback: Async function that fetches entity by Dict[entity_type, reference]
        max_depth: Maximum nesting depth
        max_embeds: Maximum total embeds allowed
        error_policy: How to handle errors

    Returns:
        Tuple of (resolved configuration dict, ResolutionInfo metadata)

    Raises:
        CircularEmbedError: If cycle detected
        MaxDepthExceededError: If depth limit exceeded
        MaxEmbedsExceededError: If embed count limit exceeded
    """
    # Work on a copy to avoid mutating input
    config_copy = deepcopy(configuration)

    depth = 0
    total_embeds = 0
    depth_reached = 0
    references_used: List[Dict[str, Reference]] = []
    errors: List[str] = []
    failed_locations: Set[str] = set()  # Track failed embeds to skip on KEEP policy
    # Track which iteration each canonical was resolved in for circular detection
    seen_by_iteration: Dict[str, int] = {}

    while depth < max_depth:
        # Find embeds in current config state
        object_embeds = find_object_embeds(config_copy)
        string_embeds = find_string_embeds(config_copy)
        shorthand_embeds = find_snippet_embeds(config_copy)

        if not object_embeds and not string_embeds and not shorthand_embeds:
            # No more embeds to resolve
            break

        # Track if we processed any embeds this iteration
        processed_any = False

        # Resolve object embeds first (structural replacement)
        for embed in object_embeds:
            # Skip embeds that failed previously (KEEP policy)
            if embed.location in failed_locations:
                continue

            try:
                # Pass iteration tracking for circular detection
                nested_embeds, nested_depth = await _resolve_and_inline_object_embed(
                    config=config_copy,
                    embed=embed,
                    resolver_callback=resolver_callback,
                    seen_by_iteration=seen_by_iteration,
                    current_iteration=depth,
                    max_depth=max_depth,
                    max_embeds=max_embeds,
                    error_policy=error_policy,
                )
                references_used.append(embed.references)
                total_embeds += 1 + nested_embeds
                depth_reached = max(depth_reached, depth + 1 + nested_depth)
                processed_any = True

                if total_embeds > max_embeds:
                    raise MaxEmbedsExceededError(total_embeds)

            except Exception as e:
                errors.append(str(e))
                if error_policy == ErrorPolicy.EXCEPTION:
                    raise
                elif error_policy == ErrorPolicy.PLACEHOLDER:
                    # Replace with error placeholder
                    placeholder = f"<error:{type(e).__name__}>"
                    set_path(config_copy, embed.location, placeholder)
                else:  # KEEP policy
                    # Mark location as failed to skip on subsequent iterations
                    failed_locations.add(embed.location)

        # Resolve string embeds (text interpolation)
        for embed in string_embeds:
            # Skip embeds that failed previously (KEEP policy)
            if embed.location in failed_locations:
                continue

            try:
                # Pass iteration tracking for circular detection
                nested_embeds, nested_depth = await _resolve_and_inline_string_embed(
                    config=config_copy,
                    embed=embed,
                    resolver_callback=resolver_callback,
                    seen_by_iteration=seen_by_iteration,
                    current_iteration=depth,
                    max_depth=max_depth,
                    max_embeds=max_embeds,
                    error_policy=error_policy,
                )
                references_used.append(embed.references)
                total_embeds += 1 + nested_embeds
                depth_reached = max(depth_reached, depth + 1 + nested_depth)
                processed_any = True

                if total_embeds > max_embeds:
                    raise MaxEmbedsExceededError(total_embeds)

            except Exception as e:
                errors.append(str(e))
                if error_policy == ErrorPolicy.EXCEPTION:
                    raise
                elif error_policy == ErrorPolicy.PLACEHOLDER:
                    placeholder = f"<error:{type(e).__name__}>"
                    # For string embeds, replace with placeholder
                    set_path(config_copy, embed.location, placeholder)
                else:  # KEEP policy
                    # Mark location as failed to skip on subsequent iterations
                    failed_locations.add(embed.location)

        # Resolve snippet embeds (@{{...}} shorthand syntax)
        for embed in shorthand_embeds:
            if embed.location in failed_locations:
                continue

            try:
                nested_embeds, nested_depth = await _resolve_and_inline_snippet_embed(
                    config=config_copy,
                    embed=embed,
                    resolver_callback=resolver_callback,
                    seen_by_iteration=seen_by_iteration,
                    current_iteration=depth,
                    max_depth=max_depth,
                    max_embeds=max_embeds,
                    error_policy=error_policy,
                )
                references_used.append(embed.references)
                total_embeds += 1 + nested_embeds
                depth_reached = max(depth_reached, depth + 1 + nested_depth)
                processed_any = True

                if total_embeds > max_embeds:
                    raise MaxEmbedsExceededError(total_embeds)

            except Exception as e:
                errors.append(str(e))
                if error_policy == ErrorPolicy.EXCEPTION:
                    raise
                elif error_policy == ErrorPolicy.PLACEHOLDER:
                    placeholder = f"<error:{type(e).__name__}>"
                    set_path(config_copy, embed.location, placeholder)
                else:  # KEEP policy
                    failed_locations.add(embed.location)

        # If no embeds were processed this iteration, we're done
        if not processed_any:
            break

        depth += 1

    if depth >= max_depth:
        raise MaxDepthExceededError(depth)

    resolution_info = ResolutionInfo(
        references_used=references_used,
        depth_reached=depth_reached,
        embeds_resolved=total_embeds,
        errors=errors,
    )

    return (config_copy, resolution_info)


async def _resolve_and_inline_object_embed(
    *,
    config: Dict[str, Any],
    embed: ObjectEmbed,
    resolver_callback: Callable[[Dict[str, Reference]], Awaitable[Dict[str, Any]]],
    seen_by_iteration: Dict[str, int],
    current_iteration: int,
    max_depth: int,
    max_embeds: int,
    error_policy: ErrorPolicy,
) -> tuple[int, int]:
    """
    Resolve an object embed and inline it into config.

    Modifies config in-place.

    Args:
        seen_by_iteration: Maps canonical references to the iteration they were first seen
        current_iteration: Current iteration number (depth)
    """
    if not embed.references:
        raise ValueError(f"No references found in embed at {embed.location}")

    resolved_value = await _resolve_references(
        references=embed.references,
        resolver_callback=resolver_callback,
        seen_by_iteration=seen_by_iteration,
        current_iteration=current_iteration,
    )

    selector = embed.selector
    try:
        if selector and selector.key:
            resolved_value = await _follow_key_reference(
                resolved_value=resolved_value,
                selector_key=selector.key,
                resolver_callback=resolver_callback,
                seen_by_iteration=seen_by_iteration,
                current_iteration=current_iteration,
            )
            if selector.path:
                selector_base = _revision_data_or_self(resolved_value)
                resolved_value = _extract_with_sdk_resolver(
                    data=selector_base,
                    path=selector.path,
                    original_config=selector_base
                    if isinstance(selector_base, dict)
                    else {"value": selector_base},
                )
        elif selector and selector.path:
            selector_base = _revision_data_or_self(resolved_value)
            resolved_value = _extract_with_sdk_resolver(
                data=selector_base,
                path=selector.path,
                original_config=selector_base
                if isinstance(selector_base, dict)
                else {"value": selector_base},
            )
    except Exception as e:
        log.error(
            "[embeds][object] selector/path failed location=%s selector_key=%s selector_path=%s refs=%s shape=%s error=%s",
            embed.location,
            selector.key if selector else None,
            selector.path if selector else None,
            embed.references,
            _debug_shape(resolved_value),
            e,
        )
        raise

    # Embed body defaults to revision.data payload.
    set_path(config, embed.location, _revision_data_or_self(resolved_value))
    return (0, 0)


async def _resolve_nested_embeds_in_value(
    *,
    value: Any,
    resolver_callback: Callable[[Dict[str, Reference]], Awaitable[Dict[str, Any]]],
    max_depth: int,
    max_embeds: int,
    error_policy: ErrorPolicy,
) -> tuple[Any, int, int]:
    """
    Resolve embeds in a nested value and return (resolved_value, embeds_resolved, depth_reached).

    This is used when a string embed references a full object and we need that
    object fully resolved before selector extraction or JSON stringification.
    """
    if not isinstance(value, (dict, list)):
        return (value, 0, 0)

    wrapped = {"__value": value}
    if not find_object_embeds(wrapped) and not find_string_embeds(wrapped):
        return (value, 0, 0)

    resolved_wrapped, nested_info = await resolve_embeds(
        configuration=wrapped,
        resolver_callback=resolver_callback,
        max_depth=max_depth,
        max_embeds=max_embeds,
        error_policy=error_policy,
    )

    return (
        resolved_wrapped["__value"],
        nested_info.embeds_resolved,
        nested_info.depth_reached,
    )


async def _resolve_references(
    *,
    references: Dict[str, Reference],
    resolver_callback: Callable[[Dict[str, Reference]], Awaitable[Dict[str, Any]]],
    seen_by_iteration: Dict[str, int],
    current_iteration: int,
) -> Any:
    """
    Resolve one or more references and return resolved value.

    All references must belong to the same entity family (e.g., all "workflow*").
    They are sent together to the resolver for scoped lookup — e.g.,
    workflow_variant + workflow_revision allows variant-scoped revision fetch.

    Raises:
        MixedEntityTypesError: If references span multiple entity families.
        CircularEmbedError: If a circular reference is detected.
    """
    # Validate all references are same entity family
    categories: Set[str] = set()
    for entity_type in references.keys():
        category = entity_type.split("_", 1)[0] if "_" in entity_type else entity_type
        categories.add(category)

    if len(categories) > 1:
        raise MixedEntityTypesError(sorted(categories))

    # Track for circular detection
    for entity_type, reference in references.items():
        canonical = f"{entity_type}:{canonicalize_reference(reference)}"

        if canonical in seen_by_iteration:
            if seen_by_iteration[canonical] < current_iteration:
                raise CircularEmbedError([canonical])

        if canonical not in seen_by_iteration:
            seen_by_iteration[canonical] = current_iteration

    # Call resolver once with the full references dict
    return await resolver_callback(references)


async def _follow_key_reference(
    *,
    resolved_value: Dict[str, Any],
    selector_key: str,
    resolver_callback: Callable[[Dict[str, Reference]], Awaitable[Dict[str, Any]]],
    seen_by_iteration: Dict[str, int],
    current_iteration: int,
) -> Any:
    """
    Follow a reference pointer stored at data.references.<key>.

    Expects resolved_value to contain a "references" dict with an entry at selector_key.
    That entry must be a dict with exactly one key (the entity type) mapping to a Reference.
    Fetches that secondary entity and returns its data.
    """
    try:
        references = _require_revision_data_references(resolved_value=resolved_value)
        ref_entry = _lookup_reference_entry(
            references=references,
            selector_key=selector_key,
        )
    except PathExtractionError as e:
        log.error(
            "[embeds][key-follow] missing key selector_key=%s shape=%s error=%s",
            selector_key,
            _debug_shape(resolved_value),
            e,
        )
        raise EmbedNotFoundError(
            f"Key resolution requires revision.data.references; key='{selector_key}'"
        )

    if ref_entry is None:
        available_keys = sorted([str(k) for k in references.keys()])
        log.error(
            "[embeds][key-follow] selector key not found selector_key=%s key_parts=%s available_reference_keys=%s",
            selector_key,
            selector_key.split("."),
            available_keys,
        )
        raise EmbedNotFoundError(f"Key '{selector_key}' not found in references")

    if not isinstance(ref_entry, dict) or not ref_entry:
        raise ValueError(
            f"Expected references object at references.{selector_key}, got: {ref_entry}"
        )

    resolved_refs: Dict[str, Reference] = {}
    for entity_type, raw_ref in ref_entry.items():
        resolved_refs[entity_type] = Reference.model_validate(raw_ref)

    # Supports both single-reference pointers and multi-reference bundles
    # like {application, application_variant, application_revision}.
    return await _resolve_references(
        references=resolved_refs,
        resolver_callback=resolver_callback,
        seen_by_iteration=seen_by_iteration,
        current_iteration=current_iteration,
    )


async def _resolve_and_inline_string_embed(
    *,
    config: Dict[str, Any],
    embed: StringEmbed,
    resolver_callback: Callable[[Dict[str, Reference]], Awaitable[Dict[str, Any]]],
    seen_by_iteration: Dict[str, int],
    current_iteration: int,
    max_depth: int,
    max_embeds: int,
    error_policy: ErrorPolicy,
) -> tuple[int, int]:
    """
    Resolve a string embed and inline it into config.

    Replaces @ag.embed[...] token in the string with the resolved value.
    Modifies config in-place.

    Args:
        seen_by_iteration: Maps canonical references to the iteration they were first seen
        current_iteration: Current iteration number (depth)
    """
    if not embed.references:
        raise ValueError(f"No references found in embed at {embed.location}")

    resolved_value = await _resolve_references(
        references=embed.references,
        resolver_callback=resolver_callback,
        seen_by_iteration=seen_by_iteration,
        current_iteration=current_iteration,
    )

    selector = embed.selector
    try:
        if selector and selector.key:
            resolved_value = await _follow_key_reference(
                resolved_value=resolved_value,
                selector_key=selector.key,
                resolver_callback=resolver_callback,
                seen_by_iteration=seen_by_iteration,
                current_iteration=current_iteration,
            )
            (
                resolved_value,
                nested_embeds,
                nested_depth,
            ) = await _resolve_nested_embeds_in_value(
                value=resolved_value,
                resolver_callback=resolver_callback,
                max_depth=max_depth,
                max_embeds=max_embeds,
                error_policy=error_policy,
            )
            if selector.path:
                selector_base = _revision_data_or_self(resolved_value)
                resolved_value = _extract_with_sdk_resolver(
                    data=selector_base,
                    path=selector.path,
                    original_config=selector_base
                    if isinstance(selector_base, dict)
                    else {"value": selector_base},
                )
        else:
            # If the resolved value is a nested object/list, resolve embeds inside it
            # before selector extraction and stringification.
            (
                resolved_value,
                nested_embeds,
                nested_depth,
            ) = await _resolve_nested_embeds_in_value(
                value=resolved_value,
                resolver_callback=resolver_callback,
                max_depth=max_depth,
                max_embeds=max_embeds,
                error_policy=error_policy,
            )
            if selector and selector.path:
                selector_base = _revision_data_or_self(resolved_value)
                resolved_value = _extract_with_sdk_resolver(
                    data=selector_base,
                    path=selector.path,
                    original_config=selector_base
                    if isinstance(selector_base, dict)
                    else {"value": selector_base},
                )
    except Exception as e:
        log.error(
            "[embeds][string] selector/path failed location=%s selector_key=%s selector_path=%s refs=%s shape=%s error=%s",
            embed.location,
            selector.key if selector else None,
            selector.path if selector else None,
            embed.references,
            _debug_shape(resolved_value),
            e,
        )
        raise

    resolved_value = _revision_data_or_self(resolved_value)

    # Convert to string if needed
    if not isinstance(resolved_value, str):
        resolved_value = dumps(resolved_value)

    token = embed.token

    # Get the original string from config
    original_string = extract_path(config, embed.location)
    if not isinstance(original_string, str):
        raise ValueError(
            f"Expected string at {embed.location}, got {type(original_string)}"
        )

    # Replace the token in the original string
    new_string = original_string.replace(token, resolved_value, 1)

    # Update config with the new string
    set_path(config, embed.location, new_string)
    return (nested_embeds, nested_depth)


def find_object_embeds(
    config: Dict[str, Any],
    parent_path: str = "",
    parent_key: str = "",
    visited: Optional[Set[int]] = None,
) -> List[ObjectEmbed]:
    """
    Recursively traverse config to find object embeds.

    Object embed pattern:
    {
        "my_config": {
            "@ag.embed": {
                "@ag.references": {
                    "workflow_revision": Reference(...)
                },
                "@ag.selector": {
                    "path": "params.prompt"
                }
            }
        }
    }

    Args:
        config: Configuration to search
        parent_path: Current JSON path (for recursion)
        parent_key: Current JSON key (for tracking embed key)

    Returns:
        List of found object embeds
    """
    embeds: List[ObjectEmbed] = []
    if visited is None:
        visited = set()

    if isinstance(config, (dict, list)):
        config_id = id(config)
        if config_id in visited:
            return embeds
        visited.add(config_id)

    if isinstance(config, dict):
        if AG_EMBED_KEY in config:
            # Found an object embed
            embed_data = config[AG_EMBED_KEY]

            if not isinstance(embed_data, dict):
                log.warning(f"Invalid @ag.embed at {parent_path}: must be a dict")
                return embeds

            try:
                # Parse references dict (required)
                references: Dict[str, Reference] = {}
                if AG_REFERENCES_KEY in embed_data:
                    ref_data = embed_data[AG_REFERENCES_KEY]
                    if isinstance(ref_data, dict):
                        for key, value in ref_data.items():
                            if isinstance(value, dict):
                                references[key] = Reference.model_validate(value)
                            elif isinstance(value, Reference):
                                references[key] = value
                elif not embed_data:
                    # Empty @ag.embed - skip it
                    log.warning(f"Empty @ag.embed at {parent_path}, skipping")
                    return embeds

                # Extract selector if present (optional)
                selector = None
                if AG_SELECTOR_KEY in embed_data and embed_data[AG_SELECTOR_KEY]:
                    selector_data = embed_data[AG_SELECTOR_KEY]
                    if isinstance(selector_data, dict):
                        selector = Selector(**selector_data)
                    elif isinstance(selector_data, Selector):
                        selector = selector_data

                embeds.append(
                    ObjectEmbed(
                        key=parent_key,
                        location=parent_path,
                        token=embed_data,
                        references=references,
                        selector=selector,
                    )
                )
            except Exception as e:
                log.warning(
                    f"Invalid embed reference at {parent_path}: {e}",
                )

        else:
            # Recurse into children
            for key, value in config.items():
                child_path = f"{parent_path}.{key}" if parent_path else key
                embeds.extend(find_object_embeds(value, child_path, key, visited))

    elif isinstance(config, list):
        for idx, item in enumerate(config):
            child_path = f"{parent_path}.{idx}"
            embeds.extend(find_object_embeds(item, child_path, str(idx), visited))

    return embeds


def find_string_embeds(
    config: Dict[str, Any],
    parent_path: str = "",
    parent_key: str = "",
    visited: Optional[Set[int]] = None,
) -> List[StringEmbed]:
    """
    Recursively traverse config to find string embeds with inline tokens.

    String embed pattern:
    {
        "prompt": "Use this: @ag.embed[@ag.references[workflow_revision.version=v1], @ag.selector[path:params.system_prompt]]"
    }

    The @ag.embed[...] token gets replaced with the stringified resolved value.

    Args:
        config: Configuration to search
        parent_path: Current JSON path (for recursion)
        parent_key: Current JSON key (for tracking embed key)

    Returns:
        List of found string embeds
    """
    embeds: List[StringEmbed] = []
    if visited is None:
        visited = set()

    if isinstance(config, (dict, list)):
        config_id = id(config)
        if config_id in visited:
            return embeds
        visited.add(config_id)

    if isinstance(config, dict):
        # Recurse into children
        for key, value in config.items():
            child_path = f"{parent_path}.{key}" if parent_path else key

            # Check if value is a string with embed tokens
            if isinstance(value, str):
                # Find all @ag.embed[...] tokens in the string
                tokens = _find_embed_tokens(value)
                for token in tokens:
                    try:
                        parsed = _parse_embed_token(token)
                        if parsed:
                            references, selector = parsed
                            embeds.append(
                                StringEmbed(
                                    key=key,
                                    location=child_path,
                                    token=token,
                                    references=references,
                                    selector=selector,
                                )
                            )
                    except Exception as e:
                        log.warning(
                            f"Invalid embed token at {child_path}: {token} - {e}",
                        )
            else:
                embeds.extend(find_string_embeds(value, child_path, key, visited))

    elif isinstance(config, list):
        for idx, item in enumerate(config):
            child_path = f"{parent_path}.{idx}"

            # Check if item is a string with embed tokens
            if isinstance(item, str):
                tokens = _find_embed_tokens(item)
                for token in tokens:
                    try:
                        parsed = _parse_embed_token(token)
                        if parsed:
                            references, selector = parsed
                            embeds.append(
                                StringEmbed(
                                    key=str(idx),
                                    location=child_path,
                                    token=token,
                                    references=references,
                                    selector=selector,
                                )
                            )
                    except Exception as e:
                        log.warning(
                            f"Invalid embed token at {child_path}: {token} - {e}",
                        )
            else:
                embeds.extend(find_string_embeds(item, child_path, str(idx), visited))

    return embeds


def _find_embed_tokens(text: str) -> List[str]:
    """
    Find all @ag.embed[...] tokens in a string with balanced brackets.

    Returns list of token strings including the @ag.embed[...] wrapper.
    """
    tokens = []
    i = 0
    while i < len(text):
        # Look for @ag.embed[ prefix
        if text[i:].startswith("@ag.embed["):
            start = i
            i += len("@ag.embed[")
            bracket_count = 1

            # Find matching closing bracket
            while i < len(text) and bracket_count > 0:
                if text[i] == "[":
                    bracket_count += 1
                elif text[i] == "]":
                    bracket_count -= 1
                i += 1

            if bracket_count == 0:
                # Found complete token
                tokens.append(text[start:i])
            # If bracket_count > 0, token is incomplete - skip it
        else:
            i += 1

    return tokens


def _parse_embed_token(
    token: str,
) -> Optional[Tuple[Dict[str, Reference], Optional[Selector]]]:
    """
    Parse an @ag.embed[...] token into References dict and optional Selector.

    Token format examples:
    - @ag.embed[@ag.references[workflow_revision.version=v1]]
    - @ag.embed[@ag.references[workflow_revision.id=abc-123]]
    - @ag.embed[@ag.references[workflow_revision.slug=my-revision-v1]]
    - @ag.embed[@ag.references[workflow_revision.version=v1], @ag.selector[path=parameters.prompt]]
    - @ag.embed[@ag.references[environment_revision.slug=prod], @ag.selector[key=auth, path=parameters.system_prompt]]

    Reference format: entity_type.field=value
    - Supported fields: id, slug, version
    - Examples: workflow_revision.version=v1, workflow_variant.id=abc-123

    Selector format: @ag.selector[key=<key>, path=<path>]
    - key: for environment revisions, navigate to references.<key> and follow the pointer
    - path: dot notation path into the resolved entity's data

    Returns:
        Tuple of (references dict, Optional[Selector]) or None if invalid
    """
    # Extract content between outer brackets
    match = re.match(r"@ag\.embed\[(.+)\]", token)
    if not match:
        return None

    content = match.group(1).strip()

    # Extract @ag.references[...] (required)
    ref_match = re.search(r"@ag\.references\[([^\]]+)\]", content)
    if not ref_match:
        return None

    ref_content = ref_match.group(1).strip()

    # Parse references format: entity_type.field=value[, entity_type.field=value...]
    # Supported fields: id, slug, version
    references: Dict[str, Reference] = {}
    if "=" in ref_content:
        ref_entries = [
            entry.strip() for entry in ref_content.split(",") if entry.strip()
        ]
        for ref_entry in ref_entries:
            if "=" not in ref_entry:
                continue

            key_path, value = ref_entry.split("=", 1)
            key_path = key_path.strip()
            value = value.strip()

            if "." not in key_path:
                continue

            entity_type, field = key_path.rsplit(".", 1)
            if field not in {"id", "slug", "version"}:
                continue

            if entity_type in references:
                existing = references[entity_type]
                merged = existing.model_dump(mode="json")
                merged[field] = value
                references[entity_type] = Reference.model_validate(merged)
            else:
                references[entity_type] = Reference.model_validate({field: value})

    # Extract @ag.selector[...] (optional)
    # Format: @ag.selector[key=auth, path=parameters.system_prompt]
    # Both key and path use = only.
    selector = None
    sel_match = re.search(r"@ag\.selector\[([^\]]+)\]", content)
    if sel_match:
        sel_content = sel_match.group(1).strip()
        sel_key = None
        sel_path = None
        for part in sel_content.split(","):
            part = part.strip()
            if "=" not in part:
                continue
            field, value = part.split("=", 1)
            field = field.strip()
            value = value.strip()
            if field == "key":
                sel_key = value
            elif field == "path":
                sel_path = value
        if sel_key or sel_path:
            selector = Selector(key=sel_key, path=sel_path)

    if not references:
        return None

    return (references, selector)


def extract_path(
    config: Dict[str, Any],
    path: str,
) -> Any:
    """
    Extract value at JSON path using dot notation.

    Example: "params.prompt.messages.0.content"

    Args:
        config: Configuration dictionary to extract from
        path: Dot-separated path to value

    Returns:
        Value at the specified path

    Raises:
        PathExtractionError: If path doesn't exist in config
    """
    parts = path.split(".")
    current = config

    for i, part in enumerate(parts):
        if isinstance(current, dict):
            if part not in current:
                log.error(
                    "[embeds][extract_path] missing dict key path=%s segment_index=%s segment=%s shape=%s",
                    path,
                    i,
                    part,
                    _debug_shape(current),
                )
                raise PathExtractionError(path, config)
            current = current[part]
        elif isinstance(current, list):
            try:
                idx = int(part)
                current = current[idx]
            except (ValueError, IndexError):
                log.error(
                    "[embeds][extract_path] invalid list index path=%s segment_index=%s segment=%s shape=%s",
                    path,
                    i,
                    part,
                    _debug_shape(current),
                )
                raise PathExtractionError(path, config)
        else:
            log.error(
                "[embeds][extract_path] invalid container path=%s segment_index=%s segment=%s shape=%s",
                path,
                i,
                part,
                _debug_shape(current),
            )
            raise PathExtractionError(path, config)

        # Only raise on None at intermediate segments; None at the final
        # position is a legitimate value and should be returned as-is.
        if current is None and i < len(parts) - 1:
            log.error(
                "[embeds][extract_path] intermediate none path=%s segment_index=%s segment=%s",
                path,
                i,
                part,
            )
            raise PathExtractionError(path, config)

    return current


def set_path(
    config: Dict[str, Any],
    path: str,
    value: Any,
) -> None:
    """
    Set value at JSON path using dot notation.

    Modifies config in-place.

    Example: set_path(config, "params.temperature", 0.7)

    Args:
        config: Configuration dictionary to modify
        path: Dot-separated path to target location
        value: Value to set at path
    """
    if not path:
        # Empty path means replace entire config
        # Can't do this with in-place modification
        raise ValueError("Cannot replace root config with set_path")

    parts = path.split(".")
    current = config

    for i, part in enumerate(parts[:-1]):
        if isinstance(current, dict):
            if part not in current:
                # Create intermediate objects/arrays as needed
                next_part = parts[i + 1]
                current[part] = [] if next_part.isdigit() else {}
            current = current[part]
        elif isinstance(current, list):
            idx = int(part)
            current = current[idx]

    # Set final value
    final_key = parts[-1]
    if isinstance(current, dict):
        current[final_key] = value
    elif isinstance(current, list):
        current[int(final_key)] = value


def _find_snippet_tokens(text: str) -> List[str]:
    """
    Find all @{{...}} snippet tokens in a string.

    Returns list of token strings including the @{{...}} wrapper.
    Stops at the first }} found after the opening @{{.
    """
    tokens = []
    i = 0
    while i < len(text):
        if text[i : i + 3] == "@{{":
            start = i
            i += 3  # skip @{{
            while i < len(text):
                if text[i : i + 2] == "}}":
                    i += 2  # skip }}
                    tokens.append(text[start:i])
                    break
                i += 1
            # If loop ended without break (no closing }}), no token added
        else:
            i += 1
    return tokens


def _parse_snippet_token(
    token: str,
) -> Optional[Tuple[Dict[str, Reference], Selector]]:
    """
    Parse an @{{...}} snippet token into references and selector.

    Format: @{{<entity_type>.<ref_field>=<value>[, key=<k>][, path=<p>]}}
    - entity_type: bare category (workflow, environment, …) or with level suffix
      (workflow_revision, environment_variant, …); same as full @ag.embed syntax
    - ref_field: id, slug, or version
    - part separators: , or & (spaces trimmed)
    - name-value separator: = or : (both supported; spaces trimmed on both sides)
    - multiple reference params are merged into the same references dict
    - path is relative to revision.data.parameters and is auto-prefixed; defaults to SNIPPET_DEFAULT_PATH
    - key="" (empty string) signals auto-select when key= is absent

    Returns:
        Tuple of (references, selector), or None if invalid.
    """
    match = re.match(r"@\{\{(.+)\}\}", token, re.DOTALL)
    if not match:
        return None

    content = match.group(1).strip()

    # Split on , or & and trim each part
    parts = [p.strip() for p in re.split(r"[,&]", content) if p.strip()]

    references: Dict[str, Reference] = {}
    sel_key: Optional[str] = None
    sel_path: Optional[str] = None
    has_path = False
    has_key = False

    for part in parts:
        # Support both = and : as name-value separator
        if "=" in part:
            field, _, value = part.partition("=")
        elif ":" in part:
            field, _, value = part.partition(":")
        else:
            continue

        field = field.strip()
        value = value.strip()

        # Entity reference: <entity_type>.<ref_field>=<value>
        # entity_type may be a bare category ("environment") or include a level suffix
        # ("environment_revision", "environment_variant", …).
        if "." in field:
            entity_type_str, ref_field = field.rsplit(".", 1)
            entity_type_str = entity_type_str.strip()
            ref_field = ref_field.strip()

            # Validate entity_type_str: bare category or <category>_<level>
            if "_" in entity_type_str:
                cat, level = entity_type_str.split("_", 1)
                valid = cat in ENTITY_HIERARCHY and level in LEVEL_ORDER
            else:
                valid = entity_type_str in ENTITY_HIERARCHY

            if valid and ref_field in {"id", "slug", "version"}:
                if entity_type_str in references:
                    existing = references[entity_type_str]
                    merged = existing.model_dump(mode="json")
                    merged[ref_field] = value
                    references[entity_type_str] = Reference.model_validate(merged)
                else:
                    references[entity_type_str] = Reference.model_validate(
                        {ref_field: value}
                    )
            continue

        # Selector fields
        if field == "key":
            sel_key = value if value else None
            has_key = True
        elif field == "path":
            sel_path = value if value else None
            has_path = True

    if not references:
        return None

    # Default path when not specified; path is stored as-is (parameters. prefix applied at resolution)
    if not has_path:
        sel_path = SNIPPET_DEFAULT_PATH

    # key="" signals auto-select for environments (key= absent AND entity is environment).
    # For non-environment entities, absent key= means direct path (key=None).
    is_environment = any(
        (k.split("_", 1)[0] if "_" in k else k) == "environment" for k in references
    )
    if not has_key:
        resolved_key = "" if is_environment else None
    else:
        resolved_key = sel_key
    selector = Selector(key=resolved_key, path=sel_path)

    return (references, selector)


def find_snippet_embeds(
    config: Dict[str, Any],
    parent_path: str = "",
    parent_key: str = "",
    visited: Optional[Set[int]] = None,
) -> List[SnippetEmbed]:
    """
    Recursively traverse config to find @{{...}} snippet embeds.

    Snippet embed pattern:
    {
        "greeting": "Say: @{{environment.slug=production, key=my_snippet}}"
    }

    Args:
        config: Configuration to search
        parent_path: Current JSON path (for recursion)
        parent_key: Current JSON key (for tracking embed key)

    Returns:
        List of found snippet embeds
    """
    embeds: List[SnippetEmbed] = []
    if visited is None:
        visited = set()

    if isinstance(config, (dict, list)):
        config_id = id(config)
        if config_id in visited:
            return embeds
        visited.add(config_id)

    if isinstance(config, dict):
        for key, value in config.items():
            child_path = f"{parent_path}.{key}" if parent_path else key

            if isinstance(value, str):
                tokens = _find_snippet_tokens(value)
                for token in tokens:
                    try:
                        parsed = _parse_snippet_token(token)
                        if parsed:
                            references, selector = parsed
                            embeds.append(
                                SnippetEmbed(
                                    key=key,
                                    location=child_path,
                                    token=token,
                                    references=references,
                                    selector=selector,
                                )
                            )
                    except Exception as e:
                        log.warning(
                            f"Invalid snippet embed token at {child_path}: {token} - {e}",
                        )
            else:
                embeds.extend(find_snippet_embeds(value, child_path, key, visited))

    elif isinstance(config, list):
        for idx, item in enumerate(config):
            child_path = f"{parent_path}.{idx}"

            if isinstance(item, str):
                tokens = _find_snippet_tokens(item)
                for token in tokens:
                    try:
                        parsed = _parse_snippet_token(token)
                        if parsed:
                            references, selector = parsed
                            embeds.append(
                                SnippetEmbed(
                                    key=str(idx),
                                    location=child_path,
                                    token=token,
                                    references=references,
                                    selector=selector,
                                )
                            )
                    except Exception as e:
                        log.warning(
                            f"Invalid snippet embed token at {child_path}: {token} - {e}",
                        )
            else:
                embeds.extend(find_snippet_embeds(item, child_path, str(idx), visited))

    return embeds


async def _resolve_and_inline_snippet_embed(
    *,
    config: Dict[str, Any],
    embed: SnippetEmbed,
    resolver_callback: Callable[[Dict[str, Reference]], Awaitable[Dict[str, Any]]],
    seen_by_iteration: Dict[str, int],
    current_iteration: int,
    max_depth: int,
    max_embeds: int,
    error_policy: ErrorPolicy,
) -> tuple[int, int]:
    """
    Resolve a @{{...}} snippet embed and inline it into config.

    Resolution rules:
    - key="" (auto-select, environment only): follow the single entry in data.references
    - key="x" (explicit): follow data.references["x"]
    - key=None (absent for non-environments, or explicitly empty): no key-hop
    - path is always applied as parameters.<path> to the final revision.data

    Modifies config in-place.
    """
    if not embed.references:
        raise ValueError(f"No references found in snippet embed at {embed.location}")

    resolved_value = await _resolve_references(
        references=embed.references,
        resolver_callback=resolver_callback,
        seen_by_iteration=seen_by_iteration,
        current_iteration=current_iteration,
    )

    selector = embed.selector

    # Determine effective key — "" means auto-select (environment only)
    effective_key: Optional[str] = None
    if selector is not None and selector.key == "":
        # Auto-select: environment has key= absent, pick single reference
        if not isinstance(resolved_value, dict):
            raise EmbedNotFoundError(
                f"Expected dict from environment entity at {embed.location}, "
                f"got {type(resolved_value).__name__}"
            )
        refs = _require_revision_data_references(resolved_value=resolved_value)
        if not isinstance(refs, dict) or not refs:
            raise EmbedNotFoundError(
                f"No references found in environment for auto-key selection at {embed.location}"
            )
        if len(refs) != 1:
            raise ValueError(
                f"Cannot auto-select key: {len(refs)} references found at "
                f"{embed.location}, expected exactly 1. "
                f"Available keys: {list(refs.keys())}"
            )
        effective_key = next(iter(refs))
    elif selector is not None and selector.key:
        effective_key = selector.key

    try:
        if effective_key:
            # Key-hop: follow data.references[effective_key], then apply path to secondary entity
            resolved_value = await _follow_key_reference(
                resolved_value=resolved_value,
                selector_key=effective_key,
                resolver_callback=resolver_callback,
                seen_by_iteration=seen_by_iteration,
                current_iteration=current_iteration,
            )
            (
                resolved_value,
                nested_embeds,
                nested_depth,
            ) = await _resolve_nested_embeds_in_value(
                value=resolved_value,
                resolver_callback=resolver_callback,
                max_depth=max_depth,
                max_embeds=max_embeds,
                error_policy=error_policy,
            )
            if selector and selector.path:
                selector_full_path = f"parameters.{selector.path}"
                selector_base = _require_revision_data_parameters(
                    resolved_value=resolved_value
                )
                resolved_value = _extract_with_sdk_resolver(
                    data=selector_base,
                    path=selector_full_path,
                    original_config=selector_base
                    if isinstance(selector_base, dict)
                    else {"value": selector_base},
                )

        else:
            # No key-hop: apply path directly to the resolved entity's parameters
            (
                resolved_value,
                nested_embeds,
                nested_depth,
            ) = await _resolve_nested_embeds_in_value(
                value=resolved_value,
                resolver_callback=resolver_callback,
                max_depth=max_depth,
                max_embeds=max_embeds,
                error_policy=error_policy,
            )
            if selector and selector.path:
                selector_full_path = f"parameters.{selector.path}"
                selector_base = _require_revision_data_parameters(
                    resolved_value=resolved_value
                )
                resolved_value = _extract_with_sdk_resolver(
                    data=selector_base,
                    path=selector_full_path,
                    original_config=selector_base
                    if isinstance(selector_base, dict)
                    else {"value": selector_base},
                )
    except Exception as e:
        log.error(
            "[embeds][snippet] selector/path failed location=%s token=%s selector_key=%s effective_key=%s selector_path=%s refs=%s shape=%s error=%s",
            embed.location,
            embed.token,
            selector.key if selector else None,
            effective_key,
            selector.path if selector else None,
            embed.references,
            _debug_shape(resolved_value),
            e,
        )
        raise

    # Convert to string if needed
    if not isinstance(resolved_value, str):
        resolved_value = dumps(resolved_value)

    original_string = extract_path(config, embed.location)
    if not isinstance(original_string, str):
        raise ValueError(
            f"Expected string at {embed.location}, got {type(original_string)}"
        )

    new_string = original_string.replace(embed.token, resolved_value, 1)
    set_path(config, embed.location, new_string)
    return (nested_embeds, nested_depth)


def find_shorthand_string_embeds(
    config: Dict[str, Any],
    parent_path: str = "",
    parent_key: str = "",
) -> List[SnippetEmbed]:
    """Alias for find_snippet_embeds for backward compatibility."""
    return find_snippet_embeds(config, parent_path, parent_key)


def canonicalize_reference(
    ref: Reference,
) -> str:
    """
    Create canonical string representation for cycle detection.

    Format: "id:version" or "slug:version"

    Args:
        ref: Reference to canonicalize

    Returns:
        Canonical string representation
    """
    # Build canonical string from Reference fields (id, slug, version)
    parts = []

    # Prefer id over slug
    if ref.id:
        parts.append(str(ref.id))
    elif ref.slug:
        parts.append(ref.slug)
    else:
        parts.append("unknown")

    # Add version if present
    if ref.version:
        parts.append(ref.version)

    return ":".join(parts)
