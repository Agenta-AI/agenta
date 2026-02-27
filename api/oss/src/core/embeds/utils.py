"""
Pure utility functions for resolving embedded references.

These functions are called by services (WorkflowsService, EnvironmentsService)
to resolve embedded references in their configurations.
"""

from typing import Dict, Any, List, Set, Callable, Awaitable, Optional, Tuple
from copy import deepcopy
from json import dumps
import re

from oss.src.utils.logging import get_module_logger
from oss.src.core.embeds.dtos import (
    ObjectEmbed,
    StringEmbed,
    ResolutionInfo,
    ErrorPolicy,
)
from oss.src.core.embeds.exceptions import (
    CircularEmbedError,
    MaxDepthExceededError,
    MaxEmbedsExceededError,
    PathExtractionError,
)
from oss.src.core.shared.dtos import Reference, Selector


log = get_module_logger(__name__)


# Constants
MAX_DEPTH = 10
MAX_EMBEDS = 100
AG_EMBED_KEY = "@ag.embed"
AG_REFERENCES_KEY = "@ag.references"
AG_SELECTOR_KEY = "@ag.selector"


def create_universal_resolver(
    *,
    project_id: Any,  # UUID
    include_archived: bool,
    #
    workflows_service: Optional[Any] = None,
    environments_service: Optional[Any] = None,
    applications_service: Optional[Any] = None,
    evaluators_service: Optional[Any] = None,
) -> Callable[[str, Reference], Awaitable[Dict[str, Any]]]:
    """
    Create a universal resolver that can handle ANY entity type.

    This resolver automatically routes to the appropriate service based on
    entity_type, so any entity can reference any other entity.

    Args:
        project_id: Project context
        include_archived: Whether to include archived entities
        workflows_service: Optional workflows service
        environments_service: Optional environments service
        applications_service: Optional applications service
        evaluators_service: Optional evaluators service

    Returns:
        Universal resolver callback
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

    async def resolver_callback(entity_type: str, ref: Reference) -> Dict[str, Any]:
        # Parse entity_type:
        # - "workflow_revision" -> ("workflow", "revision")
        # - "workflow" -> ("workflow", "artifact")
        # Bare category form is shorthand for artifact references.
        if "_" in entity_type:
            category, level = entity_type.split("_", 1)
        else:
            category, level = entity_type, "artifact"

        # Route to appropriate service
        if category == "workflow":
            if not workflows_service:
                raise UnsupportedReferenceTypeError(
                    f"{category} (service not available)"
                )

            if level == "artifact":
                entity = await workflows_service.fetch_workflow(
                    project_id=project_id,
                    workflow_ref=ref,
                    include_archived=include_archived,
                )
                if not entity:
                    raise EmbedNotFoundError(f"Workflow not found: {ref}")
                return entity.model_dump(mode="json")

            elif level == "variant":
                entity = await workflows_service.fetch_workflow_variant(
                    project_id=project_id,
                    workflow_variant_ref=ref,
                    include_archived=include_archived,
                )
                if not entity:
                    raise EmbedNotFoundError(f"Workflow variant not found: {ref}")
                return entity.model_dump(mode="json")

            elif level == "revision":
                entity = await _resolve_revision_with_normalization(
                    ref=ref,
                    fetch_revision_by_refs=lambda variant_ref,
                    revision_ref: workflows_service.fetch_workflow_revision(
                        project_id=project_id,
                        workflow_variant_ref=variant_ref,
                        workflow_revision_ref=revision_ref,
                        include_archived=include_archived,
                    ),
                )
                if not entity or not entity.data:
                    raise EmbedNotFoundError(f"Workflow revision not found: {ref}")
                return entity.data.model_dump(mode="json")

            else:
                raise UnsupportedReferenceTypeError(f"Unsupported level: {level}")

        elif category == "environment":
            if not environments_service:
                raise UnsupportedReferenceTypeError(
                    f"{category} (service not available)"
                )

            if level == "artifact":
                entity = await environments_service.fetch_environment(
                    project_id=project_id,
                    environment_ref=ref,
                    include_archived=include_archived,
                )
                if not entity:
                    raise EmbedNotFoundError(f"Environment not found: {ref}")
                return entity.model_dump(mode="json")

            elif level == "variant":
                entity = await environments_service.fetch_environment_variant(
                    project_id=project_id,
                    environment_variant_ref=ref,
                    include_archived=include_archived,
                )
                if not entity:
                    raise EmbedNotFoundError(f"Environment variant not found: {ref}")
                return entity.model_dump(mode="json")

            elif level == "revision":
                entity = await _resolve_revision_with_normalization(
                    ref=ref,
                    fetch_revision_by_refs=lambda variant_ref,
                    revision_ref: environments_service.fetch_environment_revision(
                        project_id=project_id,
                        environment_variant_ref=variant_ref,
                        environment_revision_ref=revision_ref,
                        include_archived=include_archived,
                    ),
                )
                if not entity or not entity.data:
                    raise EmbedNotFoundError(f"Environment revision not found: {ref}")
                return entity.data.model_dump(mode="json")

            else:
                raise UnsupportedReferenceTypeError(f"Unsupported level: {level}")

        elif category == "application":
            if not applications_service:
                raise UnsupportedReferenceTypeError(
                    f"{category} (service not available)"
                )

            if level == "artifact":
                entity = await applications_service.fetch_application(
                    project_id=project_id,
                    application_ref=ref,
                    include_archived=include_archived,
                )
                if not entity:
                    raise EmbedNotFoundError(f"Application not found: {ref}")
                return entity.model_dump(mode="json")

            elif level == "variant":
                entity = await applications_service.fetch_application_variant(
                    project_id=project_id,
                    application_variant_ref=ref,
                    include_archived=include_archived,
                )
                if not entity:
                    raise EmbedNotFoundError(f"Application variant not found: {ref}")
                return entity.model_dump(mode="json")

            elif level == "revision":
                entity = await _resolve_revision_with_normalization(
                    ref=ref,
                    fetch_revision_by_refs=lambda variant_ref,
                    revision_ref: applications_service.fetch_application_revision(
                        project_id=project_id,
                        application_variant_ref=variant_ref,
                        application_revision_ref=revision_ref,
                        include_archived=include_archived,
                    ),
                )
                if not entity or not entity.data:
                    raise EmbedNotFoundError(f"Application revision not found: {ref}")
                return entity.data.model_dump(mode="json")

            else:
                raise UnsupportedReferenceTypeError(f"Unsupported level: {level}")

        elif category == "evaluator":
            if not evaluators_service:
                raise UnsupportedReferenceTypeError(
                    f"{category} (service not available)"
                )

            if level == "artifact":
                entity = await evaluators_service.fetch_evaluator(
                    project_id=project_id,
                    evaluator_ref=ref,
                    include_archived=include_archived,
                )
                if not entity:
                    raise EmbedNotFoundError(f"Evaluator not found: {ref}")
                return entity.model_dump(mode="json")

            elif level == "variant":
                entity = await evaluators_service.fetch_evaluator_variant(
                    project_id=project_id,
                    evaluator_variant_ref=ref,
                    include_archived=include_archived,
                )
                if not entity:
                    raise EmbedNotFoundError(f"Evaluator variant not found: {ref}")
                return entity.model_dump(mode="json")

            elif level == "revision":
                entity = await _resolve_revision_with_normalization(
                    ref=ref,
                    fetch_revision_by_refs=lambda variant_ref,
                    revision_ref: evaluators_service.fetch_evaluator_revision(
                        project_id=project_id,
                        evaluator_variant_ref=variant_ref,
                        evaluator_revision_ref=revision_ref,
                        include_archived=include_archived,
                    ),
                )
                if not entity or not entity.data:
                    raise EmbedNotFoundError(f"Evaluator revision not found: {ref}")
                return entity.data.model_dump(mode="json")

            else:
                raise UnsupportedReferenceTypeError(f"Unsupported level: {level}")

        else:
            raise UnsupportedReferenceTypeError(
                f"Unsupported entity category: {category}"
            )

    return resolver_callback


async def resolve_embeds(
    *,
    configuration: Dict[str, Any],
    resolver_callback: Callable[[str, Reference], Awaitable[Dict[str, Any]]],
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
        resolver_callback: Async function that fetches entity by (entity_type, reference)
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

        if not object_embeds and not string_embeds:
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
    resolver_callback: Callable[[str, Reference], Awaitable[Dict[str, Any]]],
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

    # Extract path if selector specified
    selector = embed.selector
    if selector and selector.path:
        resolved_value = extract_path(resolved_value, selector.path)

    # Replace in config
    set_path(config, embed.location, resolved_value)
    return (0, 0)


async def _resolve_nested_embeds_in_value(
    *,
    value: Any,
    resolver_callback: Callable[[str, Reference], Awaitable[Dict[str, Any]]],
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
    resolver_callback: Callable[[str, Reference], Awaitable[Dict[str, Any]]],
    seen_by_iteration: Dict[str, int],
    current_iteration: int,
) -> Any:
    """
    Resolve one or more references and return resolved value.

    - If one entity_type is referenced, returns that entity value directly.
    - If multiple entity_types are referenced, returns a dict keyed by entity_type.
    """
    resolved_by_entity: Dict[str, Any] = {}

    for entity_type, reference in references.items():
        canonical = f"{entity_type}:{canonicalize_reference(reference)}"

        if canonical in seen_by_iteration:
            first_seen_iteration = seen_by_iteration[canonical]
            if first_seen_iteration < current_iteration:
                raise CircularEmbedError([canonical])

        if canonical not in seen_by_iteration:
            seen_by_iteration[canonical] = current_iteration

        resolved_by_entity[entity_type] = await resolver_callback(
            entity_type, reference
        )

    if len(resolved_by_entity) == 1:
        return next(iter(resolved_by_entity.values()))

    return resolved_by_entity


async def _resolve_and_inline_string_embed(
    *,
    config: Dict[str, Any],
    embed: StringEmbed,
    resolver_callback: Callable[[str, Reference], Awaitable[Dict[str, Any]]],
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

    # If the resolved value is a nested object/list, resolve embeds inside it
    # before selector extraction and stringification.
    resolved_value, nested_embeds, nested_depth = await _resolve_nested_embeds_in_value(
        value=resolved_value,
        resolver_callback=resolver_callback,
        max_depth=max_depth,
        max_embeds=max_embeds,
        error_policy=error_policy,
    )

    # Extract path if selector specified
    selector = embed.selector
    if selector and selector.path:
        resolved_value = extract_path(resolved_value, selector.path)

    # Convert to string if needed
    if not isinstance(resolved_value, str):
        resolved_value = dumps(resolved_value)

    # Use the original token stored at parse time (reconstruction could differ
    # from the original text, e.g. for environment_revision.key= tokens)
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
                embeds.extend(find_object_embeds(value, child_path, key))

    elif isinstance(config, list):
        for idx, item in enumerate(config):
            child_path = f"{parent_path}.{idx}"
            embeds.extend(find_object_embeds(item, child_path, str(idx)))

    return embeds


def find_string_embeds(
    config: Dict[str, Any],
    parent_path: str = "",
    parent_key: str = "",
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
                embeds.extend(find_string_embeds(value, child_path, key))

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
                embeds.extend(find_string_embeds(item, child_path, str(idx)))

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
    - @ag.embed[@ag.references[workflow_revision.version=v1, environment_revision.slug=prod-v1], @ag.selector[path:workflow_revision.parameters.prompt]]
    - @ag.embed[@ag.references[environment_revision.id=abc-123, environment_revision.key=api_config]]

    Reference format: entity_type.field=value
    - Supported fields: id, slug, version
    - Special field: environment_revision.key (maps selector to references.<key>)
    - Examples: workflow_revision.version=v1, workflow_variant.id=abc-123

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
    references: Dict[str, Reference] = {}
    reference_keys: Dict[str, str] = {}
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
            if field not in {"id", "slug", "version", "key"}:
                continue

            if field == "key":
                if entity_type == "environment_revision":
                    reference_keys[entity_type] = value
                continue

            if entity_type in references:
                existing = references[entity_type]
                merged = existing.model_dump(mode="json")
                merged[field] = value
                references[entity_type] = Reference.model_validate(merged)
            else:
                references[entity_type] = Reference.model_validate({field: value})

    # Extract @ag.selector[...] (optional)
    selector = None
    sel_match = re.search(r"@ag\.selector\[([^\]]+)\]", content)
    if sel_match:
        sel_content = sel_match.group(1).strip()
        # Parse selector: "path:params.system_prompt"
        if sel_content.startswith("path:"):
            path = sel_content.split(":", 1)[1].strip()
            selector = Selector(path=path)
        elif sel_content.startswith("path="):
            path = sel_content.split("=", 1)[1].strip()
            selector = Selector(path=path)

    if reference_keys:
        # key currently maps to a specific entry under environment_revision.data.references
        if len(reference_keys) > 1:
            return None

        entity_type, key = next(iter(reference_keys.items()))
        if entity_type not in references:
            return None

        key_selector_prefix = f"references.{key}"
        if selector is None:
            selector = Selector(path=key_selector_prefix)
        elif not selector.path.startswith("references."):
            selector = Selector(path=f"{key_selector_prefix}.{selector.path}")

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
                raise PathExtractionError(path, config)
            current = current[part]
        elif isinstance(current, list):
            try:
                idx = int(part)
                current = current[idx]
            except (ValueError, IndexError):
                raise PathExtractionError(path, config)
        else:
            raise PathExtractionError(path, config)

        # Only raise on None at intermediate segments; None at the final
        # position is a legitimate value and should be returned as-is.
        if current is None and i < len(parts) - 1:
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
