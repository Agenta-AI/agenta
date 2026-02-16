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

    async def resolver_callback(entity_type: str, ref: Reference) -> Dict[str, Any]:
        # Parse entity_type: "workflow_revision" -> ("workflow", "revision")
        parts = entity_type.split("_", 1)
        if len(parts) != 2:
            raise UnsupportedReferenceTypeError(
                f"Invalid entity_type format: {entity_type}"
            )

        category, level = parts

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
                entity = await workflows_service.fetch_workflow_revision(
                    project_id=project_id,
                    workflow_revision_ref=ref,
                    include_archived=include_archived,
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
                entity = await environments_service.fetch_environment_revision(
                    project_id=project_id,
                    environment_revision_ref=ref,
                    include_archived=include_archived,
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
                entity = await applications_service.fetch_application_revision(
                    project_id=project_id,
                    application_revision_ref=ref,
                    include_archived=include_archived,
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
                entity = await evaluators_service.fetch_evaluator_revision(
                    project_id=project_id,
                    evaluator_revision_ref=ref,
                    include_archived=include_archived,
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
                await _resolve_and_inline_object_embed(
                    config=config_copy,
                    embed=embed,
                    resolver_callback=resolver_callback,
                    seen_by_iteration=seen_by_iteration,
                    current_iteration=depth,
                )
                references_used.append(embed.references)
                total_embeds += 1
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
                await _resolve_and_inline_string_embed(
                    config=config_copy,
                    embed=embed,
                    resolver_callback=resolver_callback,
                    seen_by_iteration=seen_by_iteration,
                    current_iteration=depth,
                )
                references_used.append(embed.references)
                total_embeds += 1
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
        depth_reached=depth,
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
) -> None:
    """
    Resolve an object embed and inline it into config.

    Modifies config in-place.

    Args:
        seen_by_iteration: Maps canonical references to the iteration they were first seen
        current_iteration: Current iteration number (depth)
    """
    # For now, we expect exactly one reference in the dict
    # The key indicates the type/level (e.g., "workflow_revision")
    if not embed.references:
        raise ValueError(f"No references found in embed at {embed.location}")

    # Get the first (and expected only) reference
    entity_type, reference = next(iter(embed.references.items()))

    canonical = canonicalize_reference(reference)

    # Circular detection: if we've seen this canonical in a PREVIOUS iteration,
    # it means the entity is referencing itself (circular)
    if canonical in seen_by_iteration:
        first_seen_iteration = seen_by_iteration[canonical]
        if first_seen_iteration < current_iteration:
            # Seen in a previous iteration - circular reference!
            raise CircularEmbedError([canonical])
        # Seen in current iteration - this is fine (multiple refs to same entity)

    # Mark this canonical as seen in this iteration
    if canonical not in seen_by_iteration:
        seen_by_iteration[canonical] = current_iteration

    # Fetch the referenced entity via callback (passing entity_type and reference)
    resolved_value = await resolver_callback(entity_type, reference)

    # Extract path if selector specified
    selector = embed.selector
    if selector and selector.path:
        resolved_value = extract_path(resolved_value, selector.path)

    # Replace in config
    set_path(config, embed.location, resolved_value)


async def _resolve_and_inline_string_embed(
    *,
    config: Dict[str, Any],
    embed: StringEmbed,
    resolver_callback: Callable[[str, Reference], Awaitable[Dict[str, Any]]],
    seen_by_iteration: Dict[str, int],
    current_iteration: int,
) -> None:
    """
    Resolve a string embed and inline it into config.

    Replaces @ag.embed[...] token in the string with the resolved value.
    Modifies config in-place.

    Args:
        seen_by_iteration: Maps canonical references to the iteration they were first seen
        current_iteration: Current iteration number (depth)
    """
    # For now, we expect exactly one reference in the dict
    if not embed.references:
        raise ValueError(f"No references found in embed at {embed.location}")

    # Get the first (and expected only) reference
    entity_type, reference = next(iter(embed.references.items()))

    canonical = canonicalize_reference(reference)

    # Circular detection: if we've seen this canonical in a PREVIOUS iteration,
    # it means the entity is referencing itself (circular)
    if canonical in seen_by_iteration:
        first_seen_iteration = seen_by_iteration[canonical]
        if first_seen_iteration < current_iteration:
            # Seen in a previous iteration - circular reference!
            raise CircularEmbedError([canonical])
        # Seen in current iteration - this is fine (multiple refs to same entity)

    # Mark this canonical as seen in this iteration
    if canonical not in seen_by_iteration:
        seen_by_iteration[canonical] = current_iteration

    # Fetch the referenced entity via callback (passing entity_type and reference)
    resolved_value = await resolver_callback(entity_type, reference)

    # Extract path if selector specified
    selector = embed.selector
    if selector and selector.path:
        resolved_value = extract_path(resolved_value, selector.path)

    # Convert to string if needed
    if not isinstance(resolved_value, str):
        resolved_value = dumps(resolved_value)

    # Reconstruct the token from references and selector
    token = _reconstruct_token(embed.references, embed.selector)

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
    - @ag.embed[@ag.references[workflow_variant.slug=my-variant], @ag.selector[path:params.system_prompt]]

    Reference format: entity_type.field=value
    - Any Reference field can be used (id, slug, version, etc.)
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

    # Parse reference: supports two formats:
    # 1. "workflow_revision.version=v1" (explicit field)
    # 2. "workflow_revision:v1" (inferred field: UUID->id, otherwise->version)
    references: Dict[str, Reference] = {}

    if "=" in ref_content:
        # Format: entity_type.field=value
        key_path, value = ref_content.split("=", 1)
        key_path = key_path.strip()
        value = value.strip()

        # Parse key_path: "workflow_revision.version" -> entity_type="workflow_revision", field="version"
        if "." in key_path:
            entity_type, field = key_path.rsplit(".", 1)
            # Create Reference with the specified field
            references[entity_type] = Reference(**{field: value})
    elif ":" in ref_content:
        # Format: entity_type:value (infer field from value)
        entity_type, value = ref_content.split(":", 1)
        entity_type = entity_type.strip()
        value = value.strip()

        # Infer field: if value looks like UUID, use 'id', otherwise use 'version'
        # Note: Keep value as string, Reference model will handle type conversion
        try:
            # Try to parse as UUID to check format
            from uuid import UUID
            UUID(value)
            field = "id"
        except (ValueError, AttributeError):
            # Not a UUID, assume it's a version
            field = "version"

        # Create reference with raw string value
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

    return (references, selector)


def _reconstruct_token(
    references: Dict[str, Reference],
    selector: Optional[Selector] = None,
) -> str:
    """
    Reconstruct an @ag.embed[...] token from References dict and optional Selector.

    Args:
        references: Dict of references (e.g., {"workflow_revision": Reference(version="v1")})
        selector: Optional selector for path extraction

    Returns:
        Token string in shorter format:
        - @ag.embed[@ag.references[workflow_revision:v1], @ag.selector[path:...]]
        - @ag.embed[@ag.references[workflow_variant:abc-123]]

    Uses the shorter "entity_type:value" format for compatibility with parsed tokens.
    """
    # Get the first reference
    if not references:
        raise ValueError("Cannot reconstruct token without references")

    entity_type, reference = next(iter(references.items()))

    # Find the first non-None field to use and get its value
    value = None

    if reference.id is not None:
        value = str(reference.id)
    elif reference.version is not None:
        value = reference.version
    elif reference.slug is not None:
        value = reference.slug

    if value is None:
        raise ValueError(f"Reference {entity_type} has no id, slug, or version")

    # Use shorter format: entity_type:value
    ref_part = f"@ag.references[{entity_type}:{value}]"

    # Build @ag.selector[...] part if present
    parts = [ref_part]
    if selector and selector.path:
        parts.append(f"@ag.selector[path:{selector.path}]")

    # Combine into full token
    return f"@ag.embed[{', '.join(parts)}]"


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

    for part in parts:
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

        if current is None:
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
