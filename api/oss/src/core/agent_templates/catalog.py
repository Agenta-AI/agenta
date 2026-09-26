import json
from pathlib import Path

from pydantic import ValidationError

from oss.src.core.agent_templates.dtos import (
    InternalTemplateSource,
    ResolvedTemplateSource,
)
from oss.src.core.agent_templates.exceptions import (
    TemplateSourceInvalid,
    TemplateSourceNotFound,
)
from oss.src.core.agent_templates.models import (
    AgentTemplateConnection,
    AgentTemplateConnectionOption,
    AgentTemplateEntry,
    CatalogAuthor,
    CatalogDocument,
    CatalogTemplateRecord,
    GatewayConnectionOption,
    ParsedTemplatePackage,
)
from oss.src.core.agent_templates.parser import TemplatePackageParser
from oss.src.core.agent_templates.sources import (
    confined_child,
    package_digest,
    read_catalog_document,
)

# Labels for the derived tools summary ("2 GitHub + 2 Slack tools"). Unknown
# providers fall back to their slug.
PROVIDER_LABELS: dict[str, str] = {
    "attio": "Attio",
    "confluence": "Confluence",
    "datadog": "Datadog",
    "discord": "Discord",
    "github": "GitHub",
    "gitlab": "GitLab",
    "gmail": "Gmail",
    "googlecalendar": "Google Calendar",
    "googledrive": "Google Drive",
    "hubspot": "HubSpot",
    "intercom": "Intercom",
    "jira": "Jira",
    "linear": "Linear",
    "newrelic": "New Relic",
    "notion": "Notion",
    "pagerduty": "PagerDuty",
    "posthog": "PostHog",
    "salesforce": "Salesforce",
    "sentry": "Sentry",
    "slack": "Slack",
    "telegram": "Telegram",
    "zendesk": "Zendesk",
}


def _invalid(code: str, message: str, **details: object) -> TemplateSourceInvalid:
    return TemplateSourceInvalid(code, message, details=details or None)


def _option_slug(option: object) -> str:
    if isinstance(option, GatewayConnectionOption):
        return option.integration
    return option.server  # type: ignore[attr-defined]


def tools_summary(connections: list[AgentTemplateConnection]) -> str:
    parts = [
        f"{len(connection.primary.tools)} "
        f"{PROVIDER_LABELS.get(connection.primary.slug, connection.primary.slug)}"
        for connection in connections
        if connection.primary.tools
    ]
    return f"{' + '.join(parts)} tools" if parts else ""


def read_authors(authors_path: Path) -> dict[str, CatalogAuthor]:
    authors: dict[str, CatalogAuthor] = {}
    if not authors_path.is_dir():
        return authors
    for path in sorted(authors_path.glob("*.json")):
        try:
            author = CatalogAuthor.model_validate(
                json.loads(path.read_text(encoding="utf-8"))
            )
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise _invalid(
                "template_author_invalid",
                "A template author document is missing or invalid JSON.",
                path=f"authors/{path.name}",
            ) from exc
        except ValidationError as exc:
            raise _invalid(
                "template_author_invalid",
                "A template author document does not match schema version 1.",
                path=f"authors/{path.name}",
                errors=[
                    {
                        "field": ".".join(str(part) for part in error["loc"]),
                        "message": error["msg"],
                    }
                    for error in exc.errors()
                ],
            ) from exc
        if author.id != path.stem:
            raise _invalid(
                "template_author_invalid",
                "An author document's id must match its file name.",
                path=f"authors/{path.name}",
            )
        authors[author.id] = author
    return authors


class AgentTemplateCatalog:
    """The one reader for bundled template presentation data.

    The API and the website data generator both call it, so display fallbacks
    and package-derived summaries exist in one place.
    """

    def __init__(
        self,
        *,
        catalog_path: Path,
        package_parser: TemplatePackageParser | None = None,
    ) -> None:
        self._catalog_path = catalog_path
        self._parser = package_parser or TemplatePackageParser()
        self._entries: list[AgentTemplateEntry] | None = None
        self._document: CatalogDocument | None = None
        self._authors: dict[str, CatalogAuthor] = {}

    def _parse(self, key: str, version: str, relative: str) -> ParsedTemplatePackage:
        root = confined_child(self._catalog_path.parent, relative)
        return self._parser.parse(
            ResolvedTemplateSource(
                source=InternalTemplateSource(key=key),
                root=root,
                version=version,
                digest=package_digest(root),
            )
        )

    def _entry(
        self,
        *,
        key: str,
        record: CatalogTemplateRecord,
        version: str,
        package: ParsedTemplatePackage,
    ) -> AgentTemplateEntry:
        metadata = record.metadata
        assert metadata is not None
        display = metadata.display
        connections = []
        for requirement in package.agent.connections:
            slugs = [_option_slug(option) for option in requirement.options]
            connections.append(
                AgentTemplateConnection(
                    key=requirement.key,
                    role=requirement.purpose,
                    required=requirement.required,
                    primary=AgentTemplateConnectionOption(
                        slug=slugs[0],
                        scope=requirement.setup_notes,
                        tools=display.connection_tools.get(requirement.key),
                    ),
                    alternatives=slugs[1:],
                )
            )
        return AgentTemplateEntry(
            key=key,
            source=InternalTemplateSource(key=key),
            version=version,
            latest=record.latest,
            versions=list(record.versions),
            digest=package.digest,
            name=metadata.display_name or package.agent.name,
            summary=metadata.summary,
            description=metadata.description or package.agent.description,
            category=metadata.category,
            tags=metadata.tags,
            author=self._authors[metadata.author_id],
            initials=display.initials,
            color=display.color,
            instructions_summary=display.instructions_summary,
            trigger=display.trigger,
            trigger_description=display.trigger_description,
            seed_message=display.seed_message,
            builder_message=display.builder_message or display.seed_message,
            model=display.model,
            tools_summary=tools_summary(connections),
            connections=connections,
            example=display.example,
            media=metadata.media,
        )

    def validate(self) -> None:
        """Validate the whole catalog/author graph and every package version."""
        self._load(validate_all_versions=True)

    def _load(self, *, validate_all_versions: bool = False) -> list[AgentTemplateEntry]:
        document = read_catalog_document(self._catalog_path)
        authors = read_authors(self._catalog_path.parent / "authors")
        self._authors = authors
        entries: list[AgentTemplateEntry] = []
        for key, record in document.templates.items():
            try:
                InternalTemplateSource(key=key)
            except ValidationError as exc:
                raise _invalid(
                    "template_catalog_key_invalid",
                    "A template catalog key is not a lowercase slug.",
                    key=key,
                ) from exc
            if record.latest not in record.versions:
                raise _invalid(
                    "template_catalog_version_missing",
                    "The catalog's latest version has no package directory.",
                    key=key,
                    version=record.latest,
                )
            if record.listed and record.metadata is None:
                raise _invalid(
                    "template_catalog_metadata_missing",
                    "A listed template needs catalog metadata.",
                    key=key,
                )
            if validate_all_versions:
                for version, relative in record.versions.items():
                    if version != record.latest:
                        self._parse(key, version, relative)
            package = self._parse(key, record.latest, record.versions[record.latest])
            if record.metadata is None:
                continue
            if record.metadata.author_id not in authors:
                raise _invalid(
                    "template_author_missing",
                    "A template references an author that does not exist.",
                    key=key,
                    author_id=record.metadata.author_id,
                )
            known = {connection.key for connection in package.agent.connections}
            unknown = sorted(set(record.metadata.display.connection_tools) - known)
            if unknown:
                raise _invalid(
                    "template_catalog_connection_unknown",
                    "Catalog tool lists reference connections the package does not declare.",
                    key=key,
                    connection_keys=unknown,
                )
            if record.listed:
                entries.append(
                    self._entry(
                        key=key,
                        record=record,
                        version=record.latest,
                        package=package,
                    )
                )
        self._document = document
        self._entries = entries
        return entries

    def entries(self) -> list[AgentTemplateEntry]:
        if self._entries is None:
            self._load()
        assert self._entries is not None
        return self._entries

    def authors(self) -> list[CatalogAuthor]:
        self.entries()
        return list(self._authors.values())

    def query(
        self,
        *,
        search: str | None = None,
        category: str | None = None,
        author_id: str | None = None,
    ) -> list[AgentTemplateEntry]:
        needle = (search or "").strip().lower()
        results = []
        for entry in self.entries():
            if category and entry.category.lower() != category.lower():
                continue
            if author_id and entry.author.id != author_id:
                continue
            haystack = [entry.key, entry.name, entry.summary, entry.description]
            haystack += entry.tags
            for connection in entry.connections:
                for slug in [connection.primary.slug, *connection.alternatives]:
                    haystack += [slug, PROVIDER_LABELS.get(slug, slug)]
            if needle and not any(needle in value.lower() for value in haystack):
                continue
            results.append(entry)
        return results

    def package_digest(self, *, key: str, version: str) -> str:
        record = read_catalog_document(self._catalog_path).templates.get(key)
        if record is None or version not in record.versions:
            raise TemplateSourceNotFound(f"{key}@{version}")
        return package_digest(
            confined_child(self._catalog_path.parent, record.versions[version])
        )

    def fetch(self, *, key: str, version: str | None = None) -> AgentTemplateEntry:
        entry = next((item for item in self.entries() if item.key == key), None)
        if entry is None:
            raise TemplateSourceNotFound(key)
        if version is None or version == entry.version:
            return entry
        assert self._document is not None
        record = self._document.templates[key]
        relative = record.versions.get(version)
        if relative is None:
            raise TemplateSourceNotFound(f"{key}@{version}")
        return self._entry(
            key=key,
            record=record,
            version=version,
            package=self._parse(key, version, relative),
        )
