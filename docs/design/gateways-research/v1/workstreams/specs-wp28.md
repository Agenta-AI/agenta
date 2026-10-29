# WP28 — Generated development mock catalogue and provider routing

Implement the development-only generated entries defined in `../mocks.md`.  This package makes
each gateway namespace routable through its production-shaped URL and resolution path, using
only the two local compose mock services and a local Composio-shaped fake.

*Depends on:* WP5, WP6, WP7, WP8, WP9, WP10.  *Blocks:* WP29 and completion of C1's mock
matrix.

## Outcome

With `AGENTA_GATEWAYS_MOCKS_ENABLED=true`, a development API lists and resolves:

- LLM builtin providers `agenta` and `mock`;
- LLM standard provider `mock`;
- MCP builtin providers `agenta`, `composio`, and `mock`;
- MCP standard provider `mock`; and
- the existing LLM and MCP custom endpoints, when test-created.

With the switch unset or false, none of the generated mock entries exists and their routes are
not usable.  No mock entry is persisted in a gateway endpoint table.

## Ownership and files

WP28 owns the generated-catalogue and route additions:

- `api/oss/src/utils/env.py` — the explicit mock-enable switch and development-only upstream
  credential/profile configuration.
- `api/oss/src/core/gateways/llms/catalog.py` and `service.py` — generated LLM builtin and
  standard mock entries, including their secret-owner rules.
- `api/oss/src/core/gateways/mcps/service.py` — generated MCP builtin mock and standard mock
  entries, and the local Composio test-double resolution.
- `api/oss/src/apis/fastapi/gateways/llms/{proxy,utils}.py` — builtin LLM routes beside the
  existing standard and custom routes.
- `api/oss/src/apis/fastapi/gateways/mcps/{proxy,utils}.py` — standard MCP routes beside the
  existing builtin and custom routes.
- `api/oss/src/core/gateways/{llms,mcps}/providers/mock/{adapter,app}.py` — only the protected
  test profile and safe response marker described in `mocks.md`.
- OSS/EE dev compose files and their development environment examples — enable the switch and
  pass the same non-secret development test token to API and mock services.

It does not own acceptance fixtures or acceptance test files; WP29 owns those.  It must not
change custom endpoint persistence, external Composio configuration, or production provider
catalogues.

## Provider rules

- **LLM builtin / agenta:** generated Agenta-supplied-key endpoints.  Initially mock-backed;
  future Gemini and Bedrock entries extend this provider.  It never depends on a project-owned
  provider key.
- **LLM builtin / mock:** generated mock-backed endpoint that independently exercises builtin
  provider dispatch.
- **LLM standard / mock:** generated only when the project has the mock provider credential.
  It follows the same standard catalogue and secret-resolution path as a real standard provider.
- **MCP builtin / agenta:** generated Agenta-owned tools, mock-backed.
- **MCP builtin / composio:** a generated connection-shaped endpoint using the local Composio
  fake adapter in development.  It preserves the brokered URL grammar and auth strategy but
  never calls a real broker.
- **MCP builtin / mock:** a generated mock-backed endpoint, separate from Agenta.
- **MCP standard / mock:** generated only when the project has the standard mock credential;
  it uses the standard provider/target resolution path, not custom-row lookup.

The provider key, route grammar, endpoint namespace, and selected upstream profile must be
explicit data.  Do not infer them from a test name or special-case an acceptance caller.

## Verification

Unit tests prove each generated entry's namespace, route, upstream selection, auth mode,
visibility gating, and absence when mocks are disabled.  Router tests prove the two newly
supported route families select their namespaces without changing standard, builtin, or custom
routes already present.  A small compose smoke test proves the API and both mock services agree
on the enabled flag and the protected upstream credential.
