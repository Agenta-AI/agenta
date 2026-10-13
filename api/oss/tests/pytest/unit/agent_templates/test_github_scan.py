import json

import httpx
import pytest

from oss.src.core.agent_templates.exceptions import TemplateSourceUnavailable
from oss.src.core.agent_templates.github import GitHubPackageFetcher
from oss.tests.pytest.unit.agent_templates.fake_github import COMMIT, FakeGitHub

REPO_URL = "https://github.com/agenta-ai/templates"


def _plugin(name: str, **extra) -> bytes:
    return json.dumps(
        {
            "name": name,
            "version": "1.0.0",
            "extensions": {"ai.agenta": {"manifest": "./ai.agenta/agents.json"}},
            **extra,
        }
    ).encode()


@pytest.fixture
def fake() -> FakeGitHub:
    fake = FakeGitHub()
    fake.add_commit(
        "agenta-ai/templates",
        COMMIT,
        {
            "plugin.json": _plugin("root"),
            "README.md": b"# Templates\n",
            "packages": {
                "pr-reviewer": {
                    "plugin.json": _plugin("pr-reviewer", description="Reviews PRs."),
                    "ai.agenta": {"agents.json": b"{}"},
                },
                "claude-plugin": {"plugin.json": b'{"name": "not-agenta"}'},
                "broken": {"plugin.json": b"{not json"},
            },
            "nested": {"deep": {"triage": {"plugin.json": _plugin("triage")}}},
        },
    )
    fake.heads["agenta-ai/templates"] = COMMIT
    return fake


def _fetcher(fake: FakeGitHub) -> GitHubPackageFetcher:
    return GitHubPackageFetcher(transport=httpx.MockTransport(fake.handler))


async def test_scan_lists_agenta_packages_at_the_resolved_commit(fake):
    scan = await _fetcher(fake).scan(repo_url=REPO_URL)

    assert scan.commit == COMMIT
    assert scan.repo_url == REPO_URL
    assert [(t.path, t.name, t.description) for t in scan.templates] == [
        ("nested/deep/triage", "triage", None),
        ("packages/pr-reviewer", "pr-reviewer", "Reviews PRs."),
    ]
    raw = [r for r in fake.requests if r.url.host == "raw.githubusercontent.com"]
    assert raw and all(f"/{COMMIT}/" in r.url.path for r in raw)
    assert all(r.url.path.endswith("/plugin.json") for r in raw)


async def test_scan_of_a_missing_repository_is_actionable(fake):
    with pytest.raises(TemplateSourceUnavailable) as exc_info:
        await _fetcher(fake).scan(repo_url="https://github.com/agenta-ai/private")

    assert exc_info.value.code == "template_source_github_unavailable"
    assert "private" in exc_info.value.message
    assert exc_info.value.retryable is False


async def test_scan_rate_limit_is_retryable(fake):
    fake.fail_with = httpx.Response(429, json={"message": "slow down"})

    with pytest.raises(TemplateSourceUnavailable) as exc_info:
        await _fetcher(fake).scan(repo_url=REPO_URL)

    assert exc_info.value.retryable is True
