# Metadata and versioning

## Version responsibilities

1. **Package content:** keep `plugin.json.version`, the existing `<key>/<version>/` folder and content digest. Changing instructions, setup, skills or packaged files produces a new version. Published versions are immutable.
2. **Package format:** keep the portable `$schema` identifier and `ai.agenta/agents.json.schema_version`. Keep supported extension v1. Unsupported behavioral formats fail with a supported-version hint.
3. **Presentation format:** declare `schema_version: 1` in catalog and author documents. Git commits identify presentation edits. A new screenshot does not change executable package content.

## Catalog

Keep `api/oss/src/resources/agent_templates/catalog.json`. Replace the unwrapped map with `{schema_version: 1, templates: {...}}` in the same release as the reader and frontend migration. There is one supported catalog envelope, no legacy reader and no new custom catalog-root setting.

Each keyed record keeps `latest` and `versions`. A `metadata` object holds:

- `author_id`: a stable reference into the author registry.
- `display_name`, `summary`, `description`: presentation copy.
- `category`, `tags`: discovery fields.
- `display`: initials, color, examples and every other current gallery presentation field identified by the migration audit.
- `media`: ordered entries with `kind`, `url`, `alt`, optional `caption` and optional `poster_url`. Initial supported kinds are image and video.

Where names/descriptions already exist in a package, metadata is a deliberate display override. The Python reader applies the fallback to the selected package. It also derives connection/tool summaries from package definitions. Presentation metadata must not duplicate executable connection, skill or automation definitions.

The API and website data generator call that reader. The website consumes generated JSON. No second TypeScript normalization and no residual handwritten connection/tool list are allowed in production. Frozen migration fixtures are tests only.

## Authors and media

Add `authors/<id>.json` and, when needed, `media/` beside the catalog. Prefer external video URLs over committed video binaries. Do not put marketing media inside installable packages.

Author documents contain `schema_version`, `id`, `name`, `bio`, optional `avatar_url`, and `links: [{kind, url, label?}]`. Derive template membership from catalog references. Do not copy full author profiles into each template.

The portable plugin author object remains standard: name, email and URL. Do not insert Agenta-specific IDs or media fields into it.

## Validation and evolution

- The writer/CI schema catches unknown-field typos. Optional media fallback is presentation behavior, not a promise to run mixed frontend/API versions.
- Unsupported catalog/author schema versions fail clearly. The old unwrapped catalog is rejected rather than accepted forever.
- A future catalog format change must define its coordinated migration. Do not pre-build a compatibility framework.
- External package versions remain a distinct compatibility boundary. Keep strict package validation and actionable unsupported-format errors.
- Validate author references, package mappings, selected versions, gallery ordering, and package immutability.
- Keep stable template keys and author IDs when display names change. Define redirects if a shipped website route later changes.

The catalog, API and frontend are one release unit. The independently built website can be newer than an installed app. It sends a stable key, not a new-format catalog to the old app. A missing key requires an unavailable/version message, not a legacy catalog reader.
