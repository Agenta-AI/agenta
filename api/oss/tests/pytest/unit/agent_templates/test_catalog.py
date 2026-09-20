import asyncio
import json
import re
from pathlib import Path

from oss.src.core.agent_templates.dtos import InternalTemplateSource
from oss.src.core.agent_templates.parser import TemplatePackageParser
from oss.src.core.agent_templates.sources import InternalTemplateSourceResolver


REPO_ROOT = next(
    parent for parent in Path(__file__).parents if (parent / "web").is_dir()
)
CATALOG = (
    REPO_ROOT / "api" / "oss" / "src" / "resources" / "agent_templates" / "catalog.json"
)
FRONTEND_TEMPLATES = (
    REPO_ROOT
    / "web"
    / "packages"
    / "agenta-entities"
    / "src"
    / "workflow"
    / "agentTemplates.ts"
)
LEGACY_EXAMPLE_KEYS = {"outbound-prospecting"}


def _frontend_source_keys() -> set[str]:
    source = FRONTEND_TEMPLATES.read_text(encoding="utf-8")
    return set(
        re.findall(r'source:\s*\{kind:\s*"internal",\s*key:\s*"([^"]+)"\}', source)
    )


def test_catalog_has_exactly_one_source_for_every_starter_card():
    frontend_keys = _frontend_source_keys()
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))

    assert len(frontend_keys) == 28
    assert set(catalog) == frontend_keys | LEGACY_EXAMPLE_KEYS


def test_every_catalog_package_resolves_and_passes_strict_parsing():
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    resolver = InternalTemplateSourceResolver(catalog_path=CATALOG)
    parser = TemplatePackageParser()

    for key in sorted(catalog):
        resolved = asyncio.run(resolver.resolve(source=InternalTemplateSource(key=key)))
        package = parser.parse(resolved)
        assert package.agent.key
        assert package.agent.instructions.strip()
