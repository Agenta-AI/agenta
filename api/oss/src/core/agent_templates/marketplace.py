"""Marketplace checks and website data for the bundled template catalog.

Both commands go through the one catalog reader and package parser; nothing
here parses packages another way. Run from ``api/``:

    uv run python -m oss.src.core.agent_templates.marketplace validate --base-ref origin/main
    uv run python -m oss.src.core.agent_templates.marketplace website [--check]
"""

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

from oss.src.core.agent_templates.catalog import AgentTemplateCatalog
from oss.src.core.agent_templates.dtos import (
    InternalTemplateSource,
    ResolvedTemplateSource,
)
from oss.src.core.agent_templates.exceptions import AgentTemplateError
from oss.src.core.agent_templates.parser import TemplatePackageParser
from oss.src.core.agent_templates.sources import (
    confined_child,
    package_digest,
    read_catalog_document,
)

_SOURCE_FILE = Path(__file__).resolve()
REPO_ROOT = _SOURCE_FILE.parents[5]
CATALOG_PATH = (
    _SOURCE_FILE.parents[2] / "resources" / "agent_templates" / "catalog.json"
)
WEBSITE_OUTPUT = REPO_ROOT / "web" / "website" / "src" / "data" / "templates.json"
WEBSITE_COMMAND = (
    "cd api && uv run python -m oss.src.core.agent_templates.marketplace website"
)


@dataclass(frozen=True)
class MarketplaceIssue:
    code: str
    message: str
    details: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_error(
        cls, error: AgentTemplateError, **context: Any
    ) -> "MarketplaceIssue":
        return cls(error.code, error.message, {**context, **error.details})

    def render(self) -> str:
        if not self.details:
            return f"{self.code}: {self.message}"
        details = ", ".join(
            f"{key}={json.dumps(value, ensure_ascii=False)}"
            for key, value in self.details.items()
        )
        return f"{self.code}: {self.message} ({details})"


# --- full validation -------------------------------------------------------


def _package_issues(catalog_path: Path) -> tuple[list[MarketplaceIssue], set[str]]:
    """Parse every mapped package version, collecting one issue per failure."""
    document = read_catalog_document(catalog_path)
    parser = TemplatePackageParser()
    issues: list[MarketplaceIssue] = []
    mapped: set[str] = set()
    for key, record in document.templates.items():
        for version, relative in record.versions.items():
            mapped.add(PurePosixPath(relative).as_posix())
            expected = f"packages/{key}/{version}"
            if PurePosixPath(relative).as_posix() != expected:
                issues.append(
                    MarketplaceIssue(
                        "template_package_path_nonstandard",
                        "A catalog version must point at packages/<key>/<version>.",
                        {"template": key, "version": version, "path": relative},
                    )
                )
                continue
            try:
                root = confined_child(catalog_path.parent, relative)
                parser.parse(
                    ResolvedTemplateSource(
                        source=InternalTemplateSource(key=key),
                        root=root,
                        version=version,
                        digest=package_digest(root),
                    )
                )
            except AgentTemplateError as error:
                issues.append(
                    MarketplaceIssue.from_error(
                        error, template=key, version=version, path=relative
                    )
                )
    return issues, mapped


def _unmapped_package_issues(
    catalog_path: Path, mapped: set[str]
) -> list[MarketplaceIssue]:
    packages = catalog_path.parent / "packages"
    if not packages.is_dir():
        return []
    issues = []
    for key_dir in sorted(path for path in packages.iterdir() if path.is_dir()):
        for version_dir in sorted(path for path in key_dir.iterdir() if path.is_dir()):
            relative = version_dir.relative_to(catalog_path.parent).as_posix()
            if relative not in mapped:
                issues.append(
                    MarketplaceIssue(
                        "template_package_unmapped",
                        "A package folder is not referenced by any catalog version.",
                        {"path": relative},
                    )
                )
    return issues


def published_version_issues(
    *, published: set[str], changed: list[str]
) -> list[MarketplaceIssue]:
    """Report changed ``<key>/<version>/...`` paths inside versions the base already publishes."""
    by_version: dict[str, list[str]] = {}
    for path in changed:
        parts = PurePosixPath(path).parts
        prefix = "/".join(parts[:2]) if len(parts) >= 3 else None
        if prefix in published:
            by_version.setdefault(prefix, []).append(path)
    return [
        MarketplaceIssue(
            "template_published_version_changed",
            "A published package version cannot change. "
            "Add a new version folder and point the catalog's latest at it.",
            {"template": "@".join(prefix.split("/")), "paths": sorted(paths)},
        )
        for prefix, paths in sorted(by_version.items())
    ]


def _git_paths(repo_root: Path, directory: str, *args: str) -> list[str]:
    output = subprocess.run(
        ["git", *args, "-z", "--", f"{directory}/"],
        cwd=repo_root,
        check=True,
        capture_output=True,
    ).stdout.decode("utf-8", errors="surrogateescape")
    return [
        PurePosixPath(path).relative_to(directory).as_posix()
        for path in filter(None, output.split("\0"))
    ]


def _immutability_issues(
    catalog_path: Path, base_ref: str, repo_root: Path
) -> list[MarketplaceIssue]:
    # Git computes the change set so line-ending filters, modes and ignore rules apply.
    try:
        packages = catalog_path.parent / "packages"
        directory = packages.resolve().relative_to(repo_root.resolve()).as_posix()
        subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", f"{base_ref}^{{commit}}"],
            cwd=repo_root,
            check=True,
            capture_output=True,
        )
        base_files = _git_paths(
            repo_root, directory, "ls-tree", "-r", "--name-only", base_ref
        )
        changed = _git_paths(
            repo_root, directory, "diff", "--no-renames", "--name-only", base_ref
        )
        changed += _git_paths(
            repo_root, directory, "ls-files", "--others", "--exclude-standard"
        )
    except (OSError, ValueError, subprocess.CalledProcessError):
        return [
            MarketplaceIssue(
                "template_base_ref_unavailable",
                "The base ref for the published-version check is not available. "
                "Fetch it first, for example: git fetch origin main.",
                {"base_ref": base_ref, "repo_root": str(repo_root)},
            )
        ]
    published = {
        "/".join(PurePosixPath(path).parts[:2])
        for path in base_files
        if len(PurePosixPath(path).parts) >= 3
    }
    return published_version_issues(published=published, changed=changed)


def validate_marketplace(
    *,
    catalog_path: Path = CATALOG_PATH,
    base_ref: str | None = None,
    repo_root: Path = REPO_ROOT,
) -> list[MarketplaceIssue]:
    """Validate every package, the catalog/author graph and, with a base ref, immutability."""
    try:
        issues, mapped = _package_issues(catalog_path)
    except AgentTemplateError as error:
        return [MarketplaceIssue.from_error(error)]

    issues += _unmapped_package_issues(catalog_path, mapped)
    try:
        AgentTemplateCatalog(catalog_path=catalog_path).validate()
    except AgentTemplateError as error:
        # The reader stops at its first problem, which may repeat a package issue above.
        if error.code not in {issue.code for issue in issues}:
            issues.append(MarketplaceIssue.from_error(error))
    if base_ref:
        issues += _immutability_issues(catalog_path, base_ref, repo_root)
    return issues


# --- website data ------------------------------------------------------------


def build_website_catalog(catalog: AgentTemplateCatalog) -> dict[str, Any]:
    """Website data: listed templates in gallery order, and authors with their templates."""
    entries = catalog.entries()
    authors = []
    for author in catalog.authors():
        keys = [entry.key for entry in entries if entry.author.id == author.id]
        if keys:
            authors.append(
                {
                    **author.model_dump(mode="json", exclude_none=True),
                    "template_keys": keys,
                }
            )
    return {
        "schema_version": 1,
        "templates": [
            entry.model_dump(mode="json", exclude_none=True) for entry in entries
        ],
        "authors": authors,
    }


def render_website_catalog(catalog: AgentTemplateCatalog) -> str:
    data = build_website_catalog(catalog)
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


# --- command line ------------------------------------------------------------


def _report(issues: list[MarketplaceIssue]) -> int:
    for issue in issues:
        print(f"error: {issue.render()}", file=sys.stderr)
    return 1 if issues else 0


def _validate_command(args: argparse.Namespace) -> int:
    issues = validate_marketplace(
        catalog_path=Path(args.catalog),
        base_ref=args.base_ref,
        repo_root=Path(args.repo_root),
    )
    if not issues:
        print("Template catalog, authors and packages are valid.")
    return _report(issues)


def _website_command(args: argparse.Namespace) -> int:
    output = Path(args.output)
    try:
        rendered = render_website_catalog(
            AgentTemplateCatalog(catalog_path=Path(args.catalog))
        )
    except AgentTemplateError as error:
        return _report([MarketplaceIssue.from_error(error)])

    if args.check:
        current = output.read_text(encoding="utf-8") if output.is_file() else None
        if current != rendered:
            print(
                f"error: the website template data in {output} is out of date. "
                f"Regenerate it with: {WEBSITE_COMMAND}",
                file=sys.stderr,
            )
            return 1
        print(f"{output} is current.")
        return 0

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(rendered, encoding="utf-8")
    print(f"Wrote {output}.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="marketplace", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    validate = commands.add_parser(
        "validate", help="Validate every package and the catalog/author graph."
    )
    validate.add_argument("--catalog", default=str(CATALOG_PATH))
    validate.add_argument(
        "--base-ref",
        help="Git ref whose published package versions must stay unchanged.",
    )
    validate.add_argument("--repo-root", default=str(REPO_ROOT))
    validate.set_defaults(handler=_validate_command)

    website = commands.add_parser(
        "website", help="Write the website template data from the catalog reader."
    )
    website.add_argument("--catalog", default=str(CATALOG_PATH))
    website.add_argument("--output", default=str(WEBSITE_OUTPUT))
    website.add_argument(
        "--check",
        action="store_true",
        help="Fail instead of writing when the committed file is out of date.",
    )
    website.set_defaults(handler=_website_command)

    args = parser.parse_args(argv)
    return args.handler(args)


if __name__ == "__main__":
    sys.exit(main())
