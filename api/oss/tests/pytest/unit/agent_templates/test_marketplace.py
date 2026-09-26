import json
import shutil
import subprocess
from pathlib import Path

import pytest

from oss.src.apis.fastapi.agent_templates.models import TemplateResponse
from oss.src.core.agent_templates.catalog import AgentTemplateCatalog
from oss.src.core.agent_templates.marketplace import (
    MarketplaceIssue,
    build_website_catalog,
    main,
    published_version_issues,
    render_website_catalog,
    validate_marketplace,
)


RESOURCES = Path(__file__).parents[5] / "oss" / "src" / "resources" / "agent_templates"
REPO_ROOT = RESOURCES.parents[4]
WEBSITE_JSON = REPO_ROOT / "web" / "website" / "src" / "data" / "templates.json"
PACKAGES_DIR = "api/oss/src/resources/agent_templates/packages"


def _copy_catalog(tmp_path: Path) -> Path:
    root = tmp_path / "agent_templates"
    shutil.copytree(RESOURCES, root, ignore=shutil.ignore_patterns("schemas"))
    return root / "catalog.json"


def _rewrite(catalog: Path, change) -> None:
    value = json.loads(catalog.read_text(encoding="utf-8"))
    change(value)
    catalog.write_text(json.dumps(value), encoding="utf-8")


def _codes(issues: list[MarketplaceIssue]) -> list[str]:
    return [issue.code for issue in issues]


# --- full validation -------------------------------------------------------


def test_bundled_catalog_and_every_package_validate():
    assert validate_marketplace(catalog_path=RESOURCES / "catalog.json") == []


def test_missing_author_names_the_entry_and_the_author(tmp_path: Path):
    catalog_path = _copy_catalog(tmp_path)

    def change(value):
        value["templates"]["pr-reviewer"]["metadata"]["author_id"] = "ghost-author"

    _rewrite(catalog_path, change)

    issues = validate_marketplace(catalog_path=catalog_path)

    assert _codes(issues) == ["template_author_missing"]
    rendered = issues[0].render()
    assert "pr-reviewer" in rendered
    assert "ghost-author" in rendered


def test_catalog_version_pointing_nowhere_is_rejected(tmp_path: Path):
    catalog_path = _copy_catalog(tmp_path)

    def change(value):
        value["templates"]["pr-reviewer"]["versions"]["1.0.0"] = "packages/nope/1.0.0"

    _rewrite(catalog_path, change)

    issues = validate_marketplace(catalog_path=catalog_path)

    # The orphaned 1.0.0 folder is reported too.
    assert _codes(issues) == [
        "template_source_path_invalid",
        "template_package_unmapped",
    ]
    assert "pr-reviewer" in issues[0].render()


def test_package_folder_missing_from_the_catalog_is_rejected(tmp_path: Path):
    catalog_path = _copy_catalog(tmp_path)
    packages = catalog_path.parent / "packages"
    shutil.copytree(
        packages / "pr-reviewer" / "1.0.0", packages / "pr-reviewer" / "1.1.0"
    )

    issues = validate_marketplace(catalog_path=catalog_path)

    assert _codes(issues) == ["template_package_unmapped"]
    assert "packages/pr-reviewer/1.1.0" in issues[0].render()


def test_unsupported_package_format_is_rejected(tmp_path: Path):
    catalog_path = _copy_catalog(tmp_path)
    package = catalog_path.parent / "packages" / "pr-reviewer" / "1.0.0"
    plugin = json.loads((package / "plugin.json").read_text(encoding="utf-8"))
    manifest = package / plugin["extensions"]["ai.agenta"]["manifest"]
    extension = json.loads(manifest.read_text(encoding="utf-8"))
    extension["schema_version"] = 2
    manifest.write_text(json.dumps(extension), encoding="utf-8")

    issues = validate_marketplace(catalog_path=catalog_path)

    assert len(issues) == 1
    assert issues[0].code.startswith("extension_")
    assert "pr-reviewer" in issues[0].render()


# --- published-version immutability ---------------------------------------


def _blobs(files: dict[str, str]) -> dict[str, str]:
    return {path: f"sha-{content}" for path, content in files.items()}


BASE = _blobs(
    {
        "pr-reviewer/1.0.0/plugin.json": "a",
        "pr-reviewer/1.0.0/ai.agenta/agents.json": "b",
        "code-qa/1.0.0/plugin.json": "c",
    }
)


def test_unchanged_published_versions_and_new_versions_pass():
    head = dict(BASE)
    head.update(_blobs({"pr-reviewer/1.1.0/plugin.json": "d"}))

    assert published_version_issues(base=BASE, head=head) == []


@pytest.mark.parametrize(
    "mutate, path",
    [
        (
            lambda head: head.update({"pr-reviewer/1.0.0/plugin.json": "sha-z"}),
            "pr-reviewer/1.0.0/plugin.json",
        ),
        (
            lambda head: head.pop("pr-reviewer/1.0.0/ai.agenta/agents.json"),
            "pr-reviewer/1.0.0/ai.agenta/agents.json",
        ),
        (
            lambda head: head.update({"pr-reviewer/1.0.0/extra.md": "sha-e"}),
            "pr-reviewer/1.0.0/extra.md",
        ),
    ],
    ids=["modified", "removed", "added"],
)
def test_changing_a_published_version_is_rejected(mutate, path):
    head = dict(BASE)
    mutate(head)

    issues = published_version_issues(base=BASE, head=head)

    assert _codes(issues) == ["template_published_version_changed"]
    assert "pr-reviewer@1.0.0" in issues[0].render()
    assert path in issues[0].render()


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=repo, check=True, capture_output=True, text=True
    ).stdout


def _repo_with_catalog(tmp_path: Path) -> tuple[Path, Path]:
    repo = tmp_path / "repo"
    resources = repo / "api/oss/src/resources/agent_templates"
    resources.parent.mkdir(parents=True)
    shutil.copytree(RESOURCES, resources, ignore=shutil.ignore_patterns("schemas"))
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "add", ".")
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base")
    return repo, resources / "catalog.json"


def test_overwriting_a_published_version_fails_against_the_base_ref(tmp_path: Path):
    repo, catalog_path = _repo_with_catalog(tmp_path)
    plugin = catalog_path.parent / "packages" / "pr-reviewer" / "1.0.0" / "plugin.json"
    plugin.write_text(plugin.read_text(encoding="utf-8") + "\n", encoding="utf-8")

    issues = validate_marketplace(
        catalog_path=catalog_path, base_ref="main", repo_root=repo
    )

    assert "template_published_version_changed" in _codes(issues)


def test_unchanged_tree_passes_against_the_base_ref(tmp_path: Path):
    repo, catalog_path = _repo_with_catalog(tmp_path)

    assert (
        validate_marketplace(catalog_path=catalog_path, base_ref="main", repo_root=repo)
        == []
    )


def test_unknown_base_ref_is_an_error_not_a_pass(tmp_path: Path):
    repo, catalog_path = _repo_with_catalog(tmp_path)

    issues = validate_marketplace(
        catalog_path=catalog_path, base_ref="no-such-ref", repo_root=repo
    )

    assert _codes(issues) == ["template_base_ref_unavailable"]


# --- website data ------------------------------------------------------------


def test_website_templates_match_the_api_detail_response():
    catalog = AgentTemplateCatalog(catalog_path=RESOURCES / "catalog.json")
    data = build_website_catalog(catalog)

    assert [template["key"] for template in data["templates"]] == [
        entry.key for entry in catalog.entries()
    ]
    for template in data["templates"]:
        api = TemplateResponse(template=catalog.fetch(key=template["key"])).model_dump(
            mode="json", exclude_none=True
        )["template"]
        assert template == api


def test_author_pages_list_every_template_that_references_them(tmp_path: Path):
    catalog_path = _copy_catalog(tmp_path)
    authors = catalog_path.parent / "authors"
    (authors / "jane-doe.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "id": "jane-doe",
                "name": "Jane Doe",
                "bio": "Builds agents.",
                "links": [],
            }
        ),
        encoding="utf-8",
    )

    def change(value):
        for key in ("pr-reviewer", "code-qa"):
            value["templates"][key]["metadata"]["author_id"] = "jane-doe"

    _rewrite(catalog_path, change)

    data = build_website_catalog(AgentTemplateCatalog(catalog_path=catalog_path))
    by_id = {author["id"]: author for author in data["authors"]}

    assert by_id["jane-doe"]["template_keys"] == ["pr-reviewer", "code-qa"]
    assert "pr-reviewer" not in by_id["agenta"]["template_keys"]


def test_unlisted_templates_are_not_published(tmp_path: Path):
    catalog_path = _copy_catalog(tmp_path)
    _rewrite(
        catalog_path,
        lambda value: value["templates"]["pr-reviewer"].update({"listed": False}),
    )

    data = build_website_catalog(AgentTemplateCatalog(catalog_path=catalog_path))

    assert "pr-reviewer" not in [template["key"] for template in data["templates"]]


def test_rendering_is_deterministic():
    catalog = AgentTemplateCatalog(catalog_path=RESOURCES / "catalog.json")
    first = render_website_catalog(catalog)
    second = render_website_catalog(
        AgentTemplateCatalog(catalog_path=RESOURCES / "catalog.json")
    )

    assert first == second
    assert first.endswith("\n")


def test_committed_website_json_is_current():
    catalog = AgentTemplateCatalog(catalog_path=RESOURCES / "catalog.json")

    assert WEBSITE_JSON.read_text(encoding="utf-8") == render_website_catalog(catalog)


def test_cli_check_reports_a_stale_website_file(tmp_path: Path, capsys):
    stale = tmp_path / "templates.json"
    stale.write_text("{}\n", encoding="utf-8")

    code = main(
        [
            "website",
            "--catalog",
            str(RESOURCES / "catalog.json"),
            "--output",
            str(stale),
            "--check",
        ]
    )

    assert code == 1
    assert "website" in capsys.readouterr().err
