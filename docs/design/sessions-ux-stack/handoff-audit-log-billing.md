# Handoff: extract Audit Log and Usage & Billing into `@agenta/settings-ui`

## Where you are

Worktree: `.claude/worktrees/sessions-ux`, branch `pkg/settings-spine`.
Run everything from `web/`.

The tree is **green right now** — `pnpm lint-fix` passes 24/24 and `tsc` is 0 errors across
`@agenta/settings-ui`, `@agenta/oss`, `@agenta/ee`, `@agenta/mobile`. Keep it that way at
every commit.

## Target architecture (this is why the task is worth doing)

Today there are three web apps: `web/oss`, `web/ee`, `web/mobile`. The goal is **only
`web/mobile`** — it replaces both. OSS vs EE becomes an **env-var gate inside that one app**,
not two codebases.

So the `@agenta/*` packages are the real shipping layer, and `oss/`/`ee/` are transitional
hosts on the way out. **Moving EE-only code into `@agenta/settings-ui` is correct**, even
though that package is currently a dependency of `web/oss`. Gate EE features at runtime on
`SettingsAccess.isEE` (from `getEnv("NEXT_PUBLIC_AGENTA_LICENSE") === "ee"`), never by which
package a file lives in. If you find yourself worrying "but this ships to OSS" — that concern
is void here. Don't re-raise it.

## The task

1. **Audit Log** — `web/ee/src/components/pages/settings/AuditLog/` (7 files, ~706 loc)
2. **Usage & Billing** — `web/ee/src/components/pages/settings/Billing/` (~769 loc) plus
   `web/oss/src/components/pages/settings/Billing`
3. Wire both into `/m`'s settings rail behind `access.isEE`
   (`web/mobile/src/features/settings/SettingsScreen.tsx`)

Do Audit Log first and commit it before starting Billing.

## The extraction pattern this codebase already uses

Nine settings pages have been extracted this way. **Follow it exactly** — do not invent a
new shape. Read one of these first as a reference; `MembersPage` is the clearest:

- `web/packages/agenta-settings-ui/src/members/MembersPage.tsx` (view + host slots)
- `web/oss/src/components/pages/settings/WorkspaceManage/WorkspaceManage.tsx` (OSS binding)
- `web/mobile/src/features/settings/MembersTab.tsx` (mobile binding, bottom sheets)

The rules:

- The extracted component is a **view fed by props**. It owns layout, columns, empty states
  and the search filter. It owns no app state and no dialogs.
- Anything host-specific arrives as a **render slot** (`renderUser`, `renderInstructions`,
  `renderRoleCell`) or a **verb prop** (`onDelete`, `confirm`).
- An action whose slot is absent **hides itself** (`hidden: !confirm`) rather than rendering
  a control that does nothing.
- Tables use `DataTable` from `@agenta/ui/ui` — **never** `InfiniteVirtualTable` /
  `createStandardColumns` / `useStaticTable`. Those are antd-backed. `DataTable` supports
  `columns`, `rows`, `rowKey`, `actions`, `filters`, `primaryActions`, `title`, `empty`,
  `loading`, `onRowClick`, `expandedContent`.
- OSS keeps a thin binding file at the old path so its pages don't change.

## What I already learned attempting Audit Log (I reverted; don't repeat this)

I moved the files, rewrote the shell, converted `AuditEventCells`, then ran out of room and
reverted rather than leave a package that doesn't compile. These findings are solid:

**Its two app-layer dependencies should become slots, not moves.**
- `AuditEventCells.tsx:21` and `AuditEventDrawer.tsx:15` import `UserReference` from
  `@/oss/components/References/UserReference`. It's *nearly* portable (only antd
  `Typography` + `@agenta/entities`), but a `renderUser?: (userId, className?) => ReactNode`
  slot is cleaner and matches the pattern.
- `AuditLogFilters.tsx:26` imports `QuickDateRangePicker`, which pulls in
  `@/oss/components/Filters/Sort` — a whole OSS filter component. Definitely a slot:
  `renderDateRange?: (state: {value, onChange}) => ReactNode`.

**`useEntitlements` becomes props.** `AuditLog.tsx` calls `useEntitlements()` for
`hasAudit`/`isLoading`. Take `hasAudit?: boolean` and `entitlementsLoading?: boolean`; the
host resolves entitlements. Note the two-gate model in that file's header comment — tab
visibility is `canViewEvents` (already handled by the sidebar), page content is `Flag.AUDIT`.

**`UpgradePrompt` is already replaced.** Use `UpgradeNotice` from
`packages/agenta-settings-ui/src/access/UpgradeNotice.tsx`. It takes its upgrade link as an
`action` slot because routing and billing availability are the host's.

**The antd surface is light and every piece has an equivalent.** No form engine involved:

| file | antd | replacement |
|---|---|---|
| `AuditLog.tsx` | `Spin` | `Spinner` |
| `AuditEventCells.tsx` | `Tag`, `Tooltip` | `Tag` from `@agenta/ui/components/presentational`; a `title` attribute for the per-cell hover |
| `AuditEventDrawer.tsx` | `Descriptions`, `Empty`, `Tag`, `Typography` | `EmptyState`, `Tag`, plain elements — **`Descriptions` has no equivalent**, write a small definition list |
| `AuditLogFilters.tsx` | `Input` | `Input` from `@agenta/ui/ui` |
| `AuditLogTable.tsx` | `Skeleton` | `DataTable`'s built-in `loading` |

**The bit that stopped me:** `ActorCell` (and the drawer) currently take only `eventId` and
reach for `UserReference` directly. `renderUser` has to be threaded from `AuditLog` →
`AuditLogTable` → its column renderers → `ActorCell`. Plan that threading before you start
editing, or you'll half-convert like I did.

## Gotchas that cost me time this session

- **Never do string/regex surgery on JSX.** I corrupted a file with a brace-matching script
  and had to restore from git. Use the `Edit` tool for anything inside a component body.
  Batched `python` replacements are fine for imports and whole-block swaps you've read first.
- **Check `@agenta/ui` signatures before writing call sites.** I guessed wrong repeatedly.
  `Button` has no `icon` prop (children instead), sizes are `sm` not `small`;
  `Select` is composed (`SelectTrigger`/`SelectContent`/`SelectItem`), not `options`-based;
  `Alert` takes `type`/`message`; `Tag` takes children; `Spinner` takes `size="small"`.
- **A disabled button fires no pointer events.** antd's Tooltip handled that; Radix doesn't.
  Wrap in a `span` if the tooltip on a disabled control matters.
- **OSS lint forbids re-export stubs from `@agenta/*`.** Don't leave
  `export {default} from "@agenta/settings-ui/..."` at an old path — import the package
  directly at the consuming site.
- **`fixed: "left"` and `restField`/`fieldKey` are antd table concerns.** Drop them; they're
  inert on `DataTable`.
- **Registry components need a prettier pass.** `pnpm dlx shadcn@latest add <x>` in
  `web/mobile/` writes upstream formatting; run `npx prettier --write` on the file and check
  its import grouping.

## Wiring `/m` afterwards

In `web/mobile/src/features/settings/SettingsScreen.tsx`:
- add `"auditLog"` / `"billing"` to `AVAILABLE`
- the access object currently hardcodes `billingEnabled: false` and `canViewEvents: false` —
  these gate tab visibility via `isSettingsTabVisible` in `@agenta/settings/navigation`
- render behind `access.isEE`

Mobile hard rules (`web/mobile/CLAUDE.md`): **no antd ever**, no `@/oss` or `@agenta/ee`
imports, one component per file, semantic tokens only.

## Verification (run all of it before each commit)

Save this as a file and run it with `bash` — `set -e` pasted into an interactive shell closes the
session on the first failure.

```bash
set -euo pipefail
cd web
pnpm lint-fix                                   # must be 24/24

for p in @agenta/settings-ui @agenta/oss @agenta/ee @agenta/mobile; do
  echo "== $p"
  pnpm --filter "$p" exec tsc --noEmit          # non-zero exit aborts the gate
done

# no antd anywhere in the package — both quote styles, and the subpath imports
if grep -rnE "from ['\"]antd|from ['\"]@ant-design" packages/agenta-settings-ui/src; then
  echo "antd import found in @agenta/settings-ui" >&2
  exit 1
fi

echo "gates green"
```

Two things this block deliberately does *not* do:

- **It never wraps `tsc` in `$(… | grep -c 'error TS')`.** A command substitution reports the
  pipeline's last status, i.e. `grep`'s — so `pnpm` failing for a reason that isn't a type error
  (bad filter, missing package, OOM, a compiler crash) prints `0` and the gate reads as green.
  Run `tsc` directly under `set -e` and let a failure stop the script.
- **It does not leave the antd `grep` bare.** `grep` exits 1 when it finds nothing, which under
  `set -e` would abort on the *success* case; and the old pattern only matched double quotes, so a
  single-quoted `from 'antd'` slipped through. The `if` form inverts it correctly: a hit is the
  failure.

**None of this session's work has been run in a browser** — every gate has been lint + tsc
only. If you can get the app up, that's worth more than another green typecheck. There is a
standing verification backlog: the `@rc-component/form` migration of `SchemaForm` (it drives
chat elicitation), and the new `/m` write sheets for Projects and Members.

Commit messages: no "Claude"/"Anthropic"/"Co-Authored-By" lines.
