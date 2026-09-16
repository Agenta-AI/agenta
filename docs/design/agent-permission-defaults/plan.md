# Implementation plan

## Build-kit policies

Set explicit permissions in `api/oss/src/core/workflows/build_kit.py`.

| Allow | Ask |
| --- | --- |
| `discover_tools` | |
| `read_config` | |
| `commit_revision` | `create_schedule` |
| `test_run` | `create_subscription` |
| `rename_session` | `remove_schedule` |
| `rename_agent` | `remove_subscription` |
| `discover_triggers` | |
| `list_schedules` | |
| `list_deliveries` | |
| `test_subscription` | |
| `list_subscriptions` | |

Add `list_subscriptions`; preserve conditional `read_config` inclusion. Leave browser
interaction embeds, skills, and runtime sandbox overlay data unchanged. Acceptance:
exact operation membership and explicit policy tests with both catalog flag states.
The release kit has 15 platform operations: 11 Allow and four Ask (14 total without
`read_config`). `annotate_trace` and `query_spans` are not in the kit; they remain
catalog opt-ins, not newly allowed operations. Preserve the `request_secret` embed.

## Creation defaults

Change only the canonical new-agent template's `runner.permissions.default` from
`allow_reads` to `allow`. Preserve runtime/schema fallbacks for unspecified requests.
Cover template parity and remembered Pi/Claude/Codex creation routing. Existing policies
must survive edits and harness changes. Verify existing UI and builder integration
defaults remain `{default: "allow", tools: {}}`.

## Shared settings UI

Use the existing policy dropdown in a top-level Permissions section. Remove harness
and sandbox permission editors from drawer and changed-field views. Hide the build-kit
permission display without altering overlay data. Keep build-kit switches in Advanced.
Show environment selection only for `sandboxOptions.length > 1`; hide Advanced if empty.
Custom secrets remain available whenever a revision id exists, independently of the
environment selector and build kit. Preserve credential commit callbacks and block
credential operations while the section has unsaved edits.

Move dirty classification and `/permissions` signals to Permissions. Undo must target
only `runner.permissions.default` or `sandbox.kind`, not hidden restriction subtrees.
Ensure buffered Model/Advanced saves cannot overwrite a newer live permission value.

Acceptance: component tests for zero/one/multiple environments, hidden controls, saved
restriction preservation, dirty/revert behavior, and concurrent draft edits. Refresh
Storybook and check shared desktop/mobile rendering in light and dark themes.
Both `/w` and `/m` must mount the same settings behavior. Cover the desktop panel
adapter and the mobile UI bridge separately; a shared-component test alone does not
establish host coverage.

## Harness spikes

Run Claude and Codex independently using [the spike matrix](spikes.md). Keep experimental
runtime changes out of the defaults/UI implementation. Record actual tested cells and
blocked cells separately. Source inspection is not live harness evidence.

## Validation and review

Review each implementation independently. Extend existing API overlay, SDK/service
template, entity creation, config patch, and section change tests. Reuse runner permission,
relay, adapter, and release-gate suites for approvals and native tools. Configure security
fixtures explicitly Ask rather than relying on the superseded template default.

No commits, pushes, or shared deployment replacement are part of this implementation
session unless separately requested.
