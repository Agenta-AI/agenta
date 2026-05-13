# Client Packages

This directory will hold generated client packages split by language.

Planned layout:

```text
clients/
  python/
  typescript/
```

Primary entrypoint:

- `clients/scripts/generate.sh`

Use `--language python`, `--language typescript`, or `--language all`.

The top-level script contains the language-specific generation logic.

Defaults:

- `--language all`
- `--openapi-url http://localhost/api/openapi.json`

Examples:

```bash
bash ./clients/scripts/generate.sh
```

```bash
bash ./clients/scripts/generate.sh --openapi-url http://localhost/api/openapi.json
```

```bash
bash ./clients/scripts/generate.sh --language python
```

```bash
bash ./clients/scripts/generate.sh --language typescript
```
