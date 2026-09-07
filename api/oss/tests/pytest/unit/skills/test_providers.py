"""The catalog-provider registry and the GitHub adapter's URL contract."""

import pytest

from oss.src.core.skills.exceptions import (
    SkillSourceFetchError,
    SkillSourceInvalidURLError,
)
from oss.src.core.skills.providers import GitHubProvider, ProviderRegistry


def test_github_claims_its_url_shapes():
    provider = GitHubProvider()
    for url in (
        "github.com/obra/superpowers",
        "https://github.com/obra/superpowers",
        "https://github.com/obra/superpowers.git",
        "github.com/obra/superpowers/",
    ):
        locator = provider.claims(url)
        assert locator is not None and locator.repository == "obra/superpowers"
    assert provider.claims("gitlab.com/obra/superpowers") is None
    assert provider.claims("not a url") is None


def test_registry_resolves_by_claim_and_threads_the_ref():
    registry = ProviderRegistry([GitHubProvider()])
    adapter, locator = registry.resolve("github.com/acme/skills", ref="release-2")
    assert adapter.provider == "github"
    assert locator.repository == "acme/skills"
    assert locator.ref == "release-2"


def test_registry_rejects_an_unrecognized_source():
    registry = ProviderRegistry([GitHubProvider()])
    with pytest.raises(SkillSourceInvalidURLError):
        registry.resolve("sourcehut.org/acme/skills")


def test_registry_rejects_an_unregistered_provider_name():
    registry = ProviderRegistry([GitHubProvider()])
    with pytest.raises(SkillSourceFetchError):
        registry.get("gitlab")


def test_github_item_url_shape():
    provider = GitHubProvider()
    locator = provider.claims("github.com/obra/superpowers")
    assert (
        provider.item_url(
            locator, path="skills/brainstorming", resolved_version="abc123"
        )
        == "https://github.com/obra/superpowers/tree/abc123/skills/brainstorming"
    )
    assert provider.item_url(locator, path="x", resolved_version=None) is None
