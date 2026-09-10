# Validation

## Release rebase

The results below describe the pre-release baseline. They do not certify the rebase onto
`release/v0.115.3` at `114a19e72d`. Web suites are not run or awaited for that rebase,
as requested by the user; the main agent owns deployment QA. The release keeps Custom
secrets and removes `annotate_trace` and `query_spans` from the default kit.

Checks run on the rebased tree before completing the rebase:

- API overlay tests: 8 passed with ordered operations enabled and 8 passed disabled,
  including the `request_secret` static embed and render-kind assertions.
- `pnpm --config.verify-deps-before-run=false lint-fix`: 25 tasks passed, with four
  existing mobile hook warnings. Scoped Python Ruff format/check passed.
- Entity-ui `types:check` passed after rebuilding the local generated API client.
  The initial check saw stale compiled declarations missing `default_env_var`.
- `git diff --check` passed. Web tests and deployment QA were not run. New shared
  secrets visibility/dirty-prop tests mock the secrets component boundary; desktop
  fixtures mock vault reads and workflow labels rather than calling real providers.

## Implementation coverage

These checks ran against the working tree. Counts below describe separate suites;
they must not be added to the overlapping counts in the spike reports.

| Area | Result |
| --- | --- |
| API build-kit overlay | 8 passed with ordered operations enabled; 8 passed disabled |
| Service template, invoke handler, fallback | 59 passed |
| SDK template, builder guidance, wire, workflow shapes | 131 passed; 1 existing registry-parity skip |
| SDK permission and approval regression selection | 58 passed |
| Shared settings and related helpers | 164 passed across 7 suites after review fixes |
| Remembered creation routing and preferences | 44 passed across 2 suites |
| Desktop config host and slash permissions | 4 passed |
| Mobile suite, including new permission rendering | 157 passed across 21 files |
| SDK/API scoped Ruff and shared UI scoped ESLint | Passed |
| Entity UI and mobile TypeScript | Passed |
| Mobile lint and generated tokens | Passed; 4 existing hook warnings |
| Documentation build | Passed with existing redirect/deprecation warnings |

## Desktop route

The `/w` playground renders `PlaygroundVariantConfig`, which mounts
`PlaygroundConfigSection`, `SchemaPropertyRenderer`, and `AgentTemplateControl`.
The regression in
`web/oss/src/components/Playground/Components/PlaygroundVariantConfig/permissions.test.tsx`
mounts the actual desktop panel and `OSSdrillInUIProvider`. Data and network inputs
are mocked; the settings controls and drawer are not.

It checks zero, one, and multiple environments, saved Ask policy preservation,
top-level Permissions, no restriction editors, and policy writes through the
desktop configuration adapter without deleting saved restrictions.

Run from `web/oss` with installed dependencies:

```bash
NODE_PATH=../node_modules/.pnpm/node_modules node node_modules/vitest/vitest.mjs run src/components/Playground/Components/PlaygroundVariantConfig/permissions.test.tsx src/components/AgentChatSlice/hooks/useChatSlashCommands.test.tsx
```

## Mobile route

The `/m/w/.../sessions/...` route renders `ChatScreen`, `SessionWorkspace`,
`ConfigPane`, `AgentBuildPanel`, and the same shared schema-driven settings.
`ConfigPane` supplies the mobile `DrillInBridgeProvider`.

The regression in `web/mobile/tests/unit/agentPermissions.render.test.tsx` uses that
real bridge, the mobile query client, real schema dispatch, and the actual settings
controls. It tests read-only propagation, restriction-preserving policy edits,
environment visibility, and hidden Advanced permission editors. It does not mount
the full authenticated `ConfigPane` or `AppProviders`.

Run from `web/mobile` with installed dependencies:

```bash
./node_modules/.bin/vitest run tests/unit/agentPermissions.render.test.tsx
```

Mobile Vitest now discovers both `.test.ts` and `.test.tsx` files.

## Browser limits

No running frontend mounts this checkout. Existing deployed instances were inspected
but not restarted or reconfigured. Full Storybook builds timed out; an isolated
single-story dev attempt also failed to open a listener within 180 seconds. Therefore
authenticated `/w` and `/m` browser flows, visual themes, and real portal geometry
remain unverified. The DOM tests are not a substitute for those checks.

## Harness limits

[Claude](claude-spike.md) and [Codex](codex-spike.md) reports contain executed unit
commands and deployed-source observations. Both live product preflights failed
before native-tool execution because their isolated authentication setup was missing.
No claim of live native-tool parity or complete approval enforcement follows from
changing the shared creation default.
