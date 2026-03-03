"""
Unit tests for embeds resolution utilities.

Tests cover:
- Object embed resolution
- String embed resolution
- Path extraction with selectors
- Cycle detection
- Depth and count limits
- Error policies (EXCEPTION, PLACEHOLDER, KEEP)
"""

import pytest
from uuid import uuid4

from oss.src.core.embeds.utils import (
    resolve_embeds,
    find_object_embeds,
    find_string_embeds,
    extract_path,
    set_path,
    canonicalize_reference,
    AG_EMBED_KEY,
    AG_REFERENCES_KEY,
    AG_SELECTOR_KEY,
)
from oss.src.core.embeds.dtos import (
    ErrorPolicy,
)
from oss.src.core.embeds.exceptions import (
    CircularEmbedError,
    MaxDepthExceededError,
    MaxEmbedsExceededError,
    PathExtractionError,
)
from oss.src.core.shared.dtos import Reference


class TestFindObjectEmbeds:
    """Tests for finding object embeds in configuration."""

    def test_find_simple_object_embed(self):
        """Test finding a simple object embed without selector."""
        config = {
            "model_config": {
                AG_EMBED_KEY: {
                    AG_REFERENCES_KEY: {
                        "workflow_revision": {
                            "id": str(uuid4()),
                            "version": "v1",
                        }
                    }
                }
            }
        }

        embeds = find_object_embeds(config)

        assert len(embeds) == 1
        assert embeds[0].key == "model_config"
        assert embeds[0].location == "model_config"
        assert "workflow_revision" in embeds[0].references
        assert embeds[0].selector is None

    def test_find_object_embed_with_selector(self):
        """Test finding object embed with path selector."""
        config = {
            "system_prompt": {
                AG_EMBED_KEY: {
                    AG_REFERENCES_KEY: {
                        "workflow_revision": {
                            "id": str(uuid4()),
                        }
                    },
                    AG_SELECTOR_KEY: {"path": "params.system_prompt"},
                }
            }
        }

        embeds = find_object_embeds(config)

        assert len(embeds) == 1
        assert embeds[0].selector is not None
        assert embeds[0].selector.path == "params.system_prompt"

    def test_find_nested_object_embeds(self):
        """Test finding embeds in nested structures."""
        config = {
            "level1": {
                "level2": {
                    "config": {
                        AG_EMBED_KEY: {
                            AG_REFERENCES_KEY: {
                                "workflow_revision": {
                                    "slug": "my-workflow",
                                    "version": "v2",
                                }
                            }
                        }
                    }
                }
            }
        }

        embeds = find_object_embeds(config)

        assert len(embeds) == 1
        assert embeds[0].location == "level1.level2.config"

    def test_find_multiple_object_embeds(self):
        """Test finding multiple embeds in same config."""
        config = {
            "embed1": {
                AG_EMBED_KEY: {
                    AG_REFERENCES_KEY: {"workflow_revision": {"id": str(uuid4())}}
                }
            },
            "embed2": {
                AG_EMBED_KEY: {
                    AG_REFERENCES_KEY: {"environment_revision": {"id": str(uuid4())}}
                }
            },
        }

        embeds = find_object_embeds(config)

        assert len(embeds) == 2
        assert embeds[0].key == "embed1"
        assert embeds[1].key == "embed2"

    def test_find_object_embeds_in_list(self):
        """Test finding embeds in list structures."""
        config = {
            "items": [
                {
                    AG_EMBED_KEY: {
                        AG_REFERENCES_KEY: {"workflow_revision": {"id": str(uuid4())}}
                    }
                },
                {
                    AG_EMBED_KEY: {
                        AG_REFERENCES_KEY: {"workflow_revision": {"id": str(uuid4())}}
                    }
                },
            ]
        }

        embeds = find_object_embeds(config)

        assert len(embeds) == 2
        assert embeds[0].location == "items.0"
        assert embeds[1].location == "items.1"


class TestFindStringEmbeds:
    """Tests for finding string embeds in configuration."""

    def test_find_simple_string_embed(self):
        """Test finding a simple string embed with inline token."""
        config = {
            "prompt": "Use this prompt: @ag.embed[@ag.references[workflow_revision.version=v1]]"
        }

        embeds = find_string_embeds(config)

        assert len(embeds) == 1
        assert embeds[0].key == "prompt"
        assert embeds[0].location == "prompt"
        assert "workflow_revision" in embeds[0].references
        assert embeds[0].references["workflow_revision"].version == "v1"
        assert embeds[0].selector is None

    def test_find_string_embed_with_selector(self):
        """Test finding string embed with path selector in token."""
        workflow_variant_id = str(uuid4())
        config = {
            "message": f"Content: @ag.embed[@ag.references[workflow_variant.id={workflow_variant_id}], @ag.selector[path:params.message.content]]"
        }

        embeds = find_string_embeds(config)

        assert len(embeds) == 1
        assert embeds[0].selector is not None
        assert embeds[0].selector.path == "params.message.content"
        # Reference model stores id as UUID, so convert to string for comparison
        assert str(embeds[0].references["workflow_variant"].id) == workflow_variant_id

    def test_find_environment_revision_key_selector(self):
        """environment_revision.key should target data.references.<key>."""
        environment_revision_id = str(uuid4())
        config = {
            "auth": f"@ag.embed[@ag.references[environment_revision.id={environment_revision_id}, environment_revision.key=api_config]]"
        }

        embeds = find_string_embeds(config)

        assert len(embeds) == 1
        assert (
            str(embeds[0].references["environment_revision"].id)
            == environment_revision_id
        )
        assert embeds[0].selector is not None
        assert embeds[0].selector.path == "references.api_config"

    def test_no_string_embed_without_token(self):
        """Test that strings without @ag.embed token are not detected."""
        config = {"prompt": "This is just a regular string"}

        embeds = find_string_embeds(config)

        assert len(embeds) == 0


class TestPathExtraction:
    """Tests for path extraction utility."""

    def test_extract_simple_path(self):
        """Test extracting value from simple path."""
        config = {"params": {"temperature": 0.7}}

        value = extract_path(config, "params.temperature")
        assert value == 0.7

    def test_extract_nested_path(self):
        """Test extracting value from nested path."""
        config = {
            "params": {
                "prompt": {
                    "messages": [
                        {"role": "system", "content": "You are helpful"},
                        {"role": "user", "content": "Hello"},
                    ]
                }
            }
        }

        value = extract_path(config, "params.prompt.messages.0.content")
        assert value == "You are helpful"

    def test_extract_from_list(self):
        """Test extracting value from list index."""
        config = {"items": ["first", "second", "third"]}

        value = extract_path(config, "items.1")
        assert value == "second"

    def test_extract_nonexistent_path_raises(self):
        """Test that extracting nonexistent path raises error."""
        config = {"params": {"temperature": 0.7}}

        with pytest.raises(PathExtractionError):
            extract_path(config, "params.missing.path")

    def test_extract_invalid_list_index_raises(self):
        """Test that invalid list index raises error."""
        config = {"items": ["a", "b"]}

        with pytest.raises(PathExtractionError):
            extract_path(config, "items.10")


class TestSetPath:
    """Tests for path setting utility."""

    def test_set_simple_path(self):
        """Test setting value at simple path."""
        config = {"params": {"temperature": 0.7}}

        set_path(config, "params.temperature", 0.9)

        assert config["params"]["temperature"] == 0.9

    def test_set_nested_path(self):
        """Test setting value at nested path."""
        config = {"params": {"prompt": {"system": "old"}}}

        set_path(config, "params.prompt.system", "new")

        assert config["params"]["prompt"]["system"] == "new"

    def test_set_list_index(self):
        """Test setting value at list index."""
        config = {"items": ["a", "b", "c"]}

        set_path(config, "items.1", "updated")

        assert config["items"][1] == "updated"

    def test_set_creates_intermediate_dicts(self):
        """Test that set_path creates intermediate dicts if needed."""
        config = {}

        set_path(config, "new.nested.value", 42)

        assert config["new"]["nested"]["value"] == 42

    def test_set_empty_path_raises(self):
        """Test that setting empty path raises error."""
        config = {}

        with pytest.raises(ValueError, match="Cannot replace root"):
            set_path(config, "", {"new": "value"})


class TestCanonicalizeReference:
    """Tests for reference canonicalization."""

    def test_canonicalize_with_id(self):
        """Test canonicalizing reference with ID."""
        ref = Reference(id=uuid4(), version="v1")

        canonical = canonicalize_reference(ref)

        assert str(ref.id) in canonical
        assert "v1" in canonical

    def test_canonicalize_with_slug(self):
        """Test canonicalizing reference with slug."""
        ref = Reference(slug="my-workflow", version="v2")

        canonical = canonicalize_reference(ref)

        assert "my-workflow" in canonical
        assert "v2" in canonical

    def test_canonicalize_prefers_id_over_slug(self):
        """Test that ID is preferred over slug."""
        ref_id = uuid4()
        ref = Reference(id=ref_id, slug="my-slug", version="v1")

        canonical = canonicalize_reference(ref)

        assert str(ref_id) in canonical
        assert "my-slug" not in canonical

    def test_canonicalize_without_version(self):
        """Test canonicalizing reference without version."""
        ref = Reference(id=uuid4())

        canonical = canonicalize_reference(ref)

        assert ":" in canonical or str(ref.id) in canonical


@pytest.mark.asyncio
class TestResolveEmbeds:
    """Tests for full embed resolution."""

    async def test_resolve_simple_object_embed(self):
        """Test resolving a simple object embed."""
        workflow_id = uuid4()
        resolved_config = {"model": "gpt-4", "temperature": 0.7}

        config = {
            "llm_config": {
                AG_EMBED_KEY: {
                    AG_REFERENCES_KEY: {
                        "workflow_revision": {
                            "id": str(workflow_id),
                            "version": "v1",
                        }
                    }
                }
            }
        }

        async def resolver(entity_type: str, ref: Reference):
            assert entity_type == "workflow_revision"
            assert ref.id == workflow_id
            return resolved_config

        result_config, resolution_info = await resolve_embeds(
            configuration=config,
            resolver_callback=resolver,
        )

        assert result_config["llm_config"] == resolved_config
        assert resolution_info.embeds_resolved == 1
        assert resolution_info.depth_reached == 1
        assert len(resolution_info.references_used) == 1

    async def test_resolve_object_embed_with_selector(self):
        """Test resolving object embed with path selector."""
        workflow_id = uuid4()
        full_config = {
            "params": {"system_prompt": "You are helpful", "temperature": 0.9}
        }

        config = {
            "prompt": {
                AG_EMBED_KEY: {
                    AG_REFERENCES_KEY: {
                        "workflow_revision": {
                            "id": str(workflow_id),
                        }
                    },
                    AG_SELECTOR_KEY: {"path": "params.system_prompt"},
                }
            }
        }

        async def resolver(entity_type: str, ref: Reference):
            return full_config

        result_config, resolution_info = await resolve_embeds(
            configuration=config,
            resolver_callback=resolver,
        )

        # Should extract only the selected path
        assert result_config["prompt"] == "You are helpful"
        assert resolution_info.embeds_resolved == 1

    async def test_resolve_string_embed(self):
        """Test resolving a string embed with inline token."""
        resolved_value = {"message": "Hello world"}

        config = {
            "greeting": "Say: @ag.embed[@ag.references[workflow_revision.version=v1]]"
        }

        async def resolver(entity_type: str, ref: Reference):
            assert ref.version == "v1"
            return resolved_value

        result_config, resolution_info = await resolve_embeds(
            configuration=config,
            resolver_callback=resolver,
        )

        # Should be stringified and inlined
        assert isinstance(result_config["greeting"], str)
        assert "Hello world" in result_config["greeting"]
        assert "@ag.embed" not in result_config["greeting"]

    async def test_resolve_nested_embeds(self):
        """Test resolving nested embeds (embed within embed)."""
        id1 = uuid4()
        id2 = uuid4()

        # First resolution returns config with another embed
        intermediate_config = {
            "inner": {
                AG_EMBED_KEY: {
                    AG_REFERENCES_KEY: {"workflow_revision": {"id": str(id2)}}
                }
            }
        }

        final_config = {"value": "final"}

        config = {
            "outer": {
                AG_EMBED_KEY: {
                    AG_REFERENCES_KEY: {"workflow_revision": {"id": str(id1)}}
                }
            }
        }

        call_count = 0

        async def resolver(entity_type: str, ref: Reference):
            nonlocal call_count
            call_count += 1

            if ref.id == id1:
                return intermediate_config
            elif ref.id == id2:
                return final_config

        result_config, resolution_info = await resolve_embeds(
            configuration=config,
            resolver_callback=resolver,
        )

        assert result_config["outer"]["inner"]["value"] == "final"
        assert resolution_info.embeds_resolved == 2
        assert resolution_info.depth_reached == 2
        assert call_count == 2

    async def test_circular_embed_detection(self):
        """Test that circular embeds raise error."""
        id1 = uuid4()

        config = {
            "circular": {
                AG_EMBED_KEY: {
                    AG_REFERENCES_KEY: {"workflow_revision": {"id": str(id1)}}
                }
            }
        }

        async def resolver(entity_type: str, ref: Reference):
            # Return config with reference to itself
            return {
                "self_ref": {
                    AG_EMBED_KEY: {
                        AG_REFERENCES_KEY: {"workflow_revision": {"id": str(id1)}}
                    }
                }
            }

        with pytest.raises(CircularEmbedError):
            await resolve_embeds(
                configuration=config,
                resolver_callback=resolver,
            )

    async def test_max_depth_limit(self):
        """Test that max depth limit is enforced."""
        config = {
            "embed": {
                AG_EMBED_KEY: {
                    AG_REFERENCES_KEY: {"workflow_revision": {"id": str(uuid4())}}
                }
            }
        }

        async def resolver(entity_type: str, ref: Reference):
            # Always return another embed
            return {
                "nested": {
                    AG_EMBED_KEY: {
                        AG_REFERENCES_KEY: {"workflow_revision": {"id": str(uuid4())}}
                    }
                }
            }

        with pytest.raises(MaxDepthExceededError):
            await resolve_embeds(
                configuration=config,
                resolver_callback=resolver,
                max_depth=3,  # Will exceed this
            )

    async def test_max_embeds_limit(self):
        """Test that max embeds limit is enforced."""
        config = {
            "embed1": {
                AG_EMBED_KEY: {
                    AG_REFERENCES_KEY: {"workflow_revision": {"id": str(uuid4())}}
                }
            },
            "embed2": {
                AG_EMBED_KEY: {
                    AG_REFERENCES_KEY: {"workflow_revision": {"id": str(uuid4())}}
                }
            },
            "embed3": {
                AG_EMBED_KEY: {
                    AG_REFERENCES_KEY: {"workflow_revision": {"id": str(uuid4())}}
                }
            },
        }

        async def resolver(entity_type: str, ref: Reference):
            return {"value": "resolved"}

        with pytest.raises(MaxEmbedsExceededError):
            await resolve_embeds(
                configuration=config,
                resolver_callback=resolver,
                max_embeds=2,  # Will exceed this
            )

    async def test_error_policy_exception(self):
        """Test EXCEPTION error policy raises errors."""
        config = {
            "embed": {
                AG_EMBED_KEY: {
                    AG_REFERENCES_KEY: {"workflow_revision": {"id": str(uuid4())}}
                }
            }
        }

        async def resolver(entity_type: str, ref: Reference):
            raise ValueError("Resolver failed")

        with pytest.raises(ValueError, match="Resolver failed"):
            await resolve_embeds(
                configuration=config,
                resolver_callback=resolver,
                error_policy=ErrorPolicy.EXCEPTION,
            )

    async def test_error_policy_placeholder(self):
        """Test PLACEHOLDER error policy inserts error markers."""
        config = {
            "embed": {
                AG_EMBED_KEY: {
                    AG_REFERENCES_KEY: {"workflow_revision": {"id": str(uuid4())}}
                }
            }
        }

        async def resolver(entity_type: str, ref: Reference):
            raise ValueError("Resolver failed")

        result_config, resolution_info = await resolve_embeds(
            configuration=config,
            resolver_callback=resolver,
            error_policy=ErrorPolicy.PLACEHOLDER,
        )

        # Should have placeholder instead of resolved value
        assert "<error:" in str(result_config["embed"])
        assert len(resolution_info.errors) == 1

    async def test_error_policy_keep(self):
        """Test KEEP error policy leaves embeds unresolved."""
        workflow_id = uuid4()
        config = {
            "embed": {
                AG_EMBED_KEY: {
                    AG_REFERENCES_KEY: {"workflow_revision": {"id": str(workflow_id)}}
                }
            }
        }

        async def resolver(entity_type: str, ref: Reference):
            raise ValueError("Resolver failed")

        result_config, resolution_info = await resolve_embeds(
            configuration=config,
            resolver_callback=resolver,
            error_policy=ErrorPolicy.KEEP,
        )

        # Should keep original structure
        assert AG_EMBED_KEY in result_config["embed"]
        assert len(resolution_info.errors) == 1

    async def test_multiple_references_in_same_embed(self):
        """Test embed with multiple references in dict."""
        workflow_id = uuid4()
        env_id = uuid4()

        config = {
            "combined": {
                AG_EMBED_KEY: {
                    AG_REFERENCES_KEY: {
                        "workflow_revision": {"id": str(workflow_id)},
                        "environment_revision": {"id": str(env_id)},
                    }
                }
            }
        }

        async def resolver(entity_type: str, ref: Reference):
            return {"resolved": str(ref.id)}

        result_config, resolution_info = await resolve_embeds(
            configuration=config,
            resolver_callback=resolver,
        )

        # Should resolve all references into a mapping keyed by entity_type
        assert "workflow_revision" in result_config["combined"]
        assert "environment_revision" in result_config["combined"]
        assert result_config["combined"]["workflow_revision"]["resolved"] == str(
            workflow_id
        )
        assert result_config["combined"]["environment_revision"]["resolved"] == str(
            env_id
        )
        assert resolution_info.embeds_resolved == 1
