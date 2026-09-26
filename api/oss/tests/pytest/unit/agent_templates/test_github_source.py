import pytest
from pydantic import ValidationError

from oss.src.core.agent_templates.dtos import GitHubTemplateSource


COMMIT = "0123456789abcdef0123456789abcdef01234567"


def _source(**overrides):
    return {
        "kind": "github",
        "repo_url": "https://github.com/agenta-ai/agenta",
        "commit": COMMIT,
        "path": "api/oss/src/resources/agent_templates/packages/code-qa/1.0.0",
        **overrides,
    }


def _error(**overrides) -> str:
    with pytest.raises(ValidationError) as exc_info:
        GitHubTemplateSource.model_validate(_source(**overrides))
    return str(exc_info.value)


def test_public_repo_full_commit_and_directory_are_accepted():
    source = GitHubTemplateSource.model_validate(_source())

    assert source.kind == "github"
    assert source.repo_url == "https://github.com/agenta-ai/agenta"
    assert source.owner == "agenta-ai"
    assert source.repo == "agenta"
    assert source.commit == COMMIT
    assert source.path == "api/oss/src/resources/agent_templates/packages/code-qa/1.0.0"


def test_equivalent_spellings_normalize_to_one_identity():
    source = GitHubTemplateSource.model_validate(
        _source(
            repo_url="https://github.com/Agenta-AI/Agenta.git/",
            commit=COMMIT.upper(),
            path="packages/code-qa/1.0.0/",
        )
    )

    assert source.repo_url == "https://github.com/agenta-ai/agenta"
    assert source.commit == COMMIT
    assert source.path == "packages/code-qa/1.0.0"


@pytest.mark.parametrize("ref", ["main", "v1.0.0", "refs/heads/main", "HEAD"])
def test_branch_or_tag_is_rejected_with_resolution_instructions(ref):
    message = _error(commit=ref)

    assert "full 40-character commit SHA" in message
    assert "branch" in message


@pytest.mark.parametrize("short", ["0123456", COMMIT[:12], COMMIT[:39]])
def test_abbreviated_commit_is_rejected(short):
    message = _error(commit=short)

    assert "abbreviated" in message
    assert "full 40-character commit SHA" in message


@pytest.mark.parametrize("field", ["ref", "branch", "tag"])
def test_ref_fields_are_rejected_rather_than_resolved(field):
    message = _error(**{field: "main"})

    assert f"'{field}'" in message
    assert "full 40-character commit SHA" in message


def test_unknown_fields_are_rejected():
    assert "Extra inputs are not permitted" in _error(token="secret")


@pytest.mark.parametrize(
    "repo_url",
    [
        "github.com/agenta-ai/agenta",
        "http://github.com/agenta-ai/agenta",
        "https://gitlab.com/agenta-ai/agenta",
        "https://github.com/agenta-ai",
        "https://github.com/agenta-ai/agenta/tree/main/api",
        "https://user:token@github.com/agenta-ai/agenta",
        "https://github.com/agenta-ai/..",
        "https://github.com:8443/agenta-ai/agenta",
    ],
)
def test_only_canonical_public_github_repository_urls_are_accepted(repo_url):
    assert "https://github.com/<owner>/<repo>" in _error(repo_url=repo_url)


@pytest.mark.parametrize(
    "path",
    [
        "",
        "/",
        "/packages/code-qa",
        "packages/../secrets",
        "packages/./code-qa",
        "packages//code-qa",
        "packages\\code-qa",
        "packages/code-qa\x00",
        "/".join(["a"] * 33),
    ],
)
def test_package_directory_must_be_an_explicit_relative_path(path):
    message = _error(path=path)

    assert "package directory" in message


def test_missing_path_is_rejected_instead_of_loading_the_repository_root():
    payload = _source()
    del payload["path"]

    with pytest.raises(ValidationError):
        GitHubTemplateSource.model_validate(payload)
