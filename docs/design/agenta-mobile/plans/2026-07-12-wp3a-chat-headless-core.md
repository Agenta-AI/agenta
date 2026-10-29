# WP3a — Create the `@agenta/chat` headless core package

> **EXECUTED 2026-07-25 UNDER COPY-EXTRACTION MODE — COMPLETE.** 18 commits
> (`3984282642`…`032b125b`), all dual-reviewed incl. a full byte-parity audit; 190 package
> tests; OSS byte-untouched. Commit/review table + WP3b gotchas in
> [../README.md](../README.md). The task list below reflects the original MOVE-mode plan —
> read it through the strategy-change banner: "OSS re-import" steps were NOT executed (deferred
> to the desktop re-plumb); package-side content was executed as C1-C5 per the mapping below.

> **STRATEGY CHANGE 2026-07-25 (Arda's direction): COPY-EXTRACTION, NOT MOVE-EXTRACTION.**
> Too many in-flight FE PRs (tsc cleanup, component PRs, a local antd→shadcn migration branch)
> overlap the OSS `AgentChatSlice` — editing it risks conflicts and regressions on a working
> surface. Therefore, from T2 onward: **the package COPIES the behavior verbatim
> (fixture-pinned) and OSS stays byte-untouched.** No `AgentChatSlice` edits in this workstream.
> The original same-commit OSS re-imports (this plan's Tasks 2-13 "OSS re-import" steps) are
> DEFERRED to the desktop re-plumb PR, sequenced after the FE PR queue drains and the shadcn
> branch lands — that PR deletes the OSS copies wholesale. Execution history: T1 (scaffold,
> `3984282642`) stands; the original T2-T4 move-mode commits were REWOUND off the branch after
> review-approval (they touched OSS chat files); the partial move-mode T5 was discarded.
> Copy-mode task mapping: C1 = package-side neutral types (PendingAttachment, MessageAction —
> no OSS edits, no virtuosoState since that was OSS-only) + T5/T6 pure copies; C2 = T7/T8
> copies; C3 = T9/T10/T11 copies; C4 = T12 hooks (package-local copies of sessionEphemera/
> expandState included); C5 = T13 registries. Duplication is bounded: the copied blocks are
> stable (untouched since early July) and both sides are pinned by the same fixtures.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `web/packages/agenta-chat` (`@agenta/chat`), a headless (zero markup, zero antd/virtuoso/lexical) chat-behavior package; neutralize the four desktop type leaks in the OSS `AgentChatSlice`; lift the pure behavior blocks into the package with fixture tests and immediate OSS re-import so before/after output is identical by construction; then sketch the hook assembly (Phase 4) and skin-registration mechanism (Phase 5).

**Architecture:** Three layers per `docs/design/agenta-mobile/design.md` ("The chat: headless core + per-app skins") and `docs/design/agenta-mobile/chat-headless-contract.md`: Layer 1 engine already lives in `@agenta/playground`/`@agenta/entities`/`@agenta/shared`; Layer 2 (this WP) is `@agenta/chat` — pure view-model functions, neutral types, headless hooks, and skin registries; Layer 3 skins (desktop antd/x today, mobile shadcn in WP3b) register components against shared keys and render what the core returns. OSS keeps its 2,200-line host but consumes the lifted pure blocks immediately, preventing core/OSS drift.

**Tech Stack:** TypeScript 5.9, vitest 4 (node env, tests in `tests/unit/`), pnpm workspace, `ai` 6.0.0-beta.150 / `@ai-sdk/react` 3.0.0-beta.153 (peer), jotai 2 (peer), Next 15.5.18 consumer via `transpilePackages`.

**Worktree discipline (read before any edit):** when this work is done in a git worktree, ALL
edits must land under that worktree root, not the main checkout. Search tools sometimes return
main-repo paths — never edit those. Before the first edit of a session, run `git status` from the
worktree root and confirm every file path you touch sits under it.

**Shared verification commands** (used by every task; `web` = `<worktree>/web`):

```bash
# package tests
cd web/packages/agenta-chat && pnpm vitest run
# package typecheck + lint
cd web/packages/agenta-chat && pnpm run check
# OSS typecheck (oss package name is @agenta/oss; script is "types:check": "tsc")
cd web && pnpm turbo run types:check --filter=@agenta/oss --filter=@agenta/chat
# lint autofix before every commit (repo convention, web/CLAUDE.md)
cd web && pnpm lint-fix
```

**Allowed deps for `@agenta/chat`:** `@agenta/playground`, `@agenta/entities`, `@agenta/shared`, `ai`, `@ai-sdk/react`, `jotai`, `react` (types/hooks only). **NEVER:** `antd`, `@ant-design/*`, `react-virtuoso`, `lexical`.

---

## Phase 1 — Scaffold the package

### Task 1: Create `web/packages/agenta-chat` and wire it into the workspace

**Files**
- Create: `web/packages/agenta-chat/package.json`
- Create: `web/packages/agenta-chat/tsconfig.json`
- Create: `web/packages/agenta-chat/vitest.config.ts`
- Create: `web/packages/agenta-chat/src/index.ts`
- Create: `web/packages/agenta-chat/src/model/index.ts`
- Create: `web/packages/agenta-chat/tests/unit/package.test.ts`
- Modify: `web/oss/next.config.ts` (~line 90 `transpilePackages` array — add `"@agenta/chat"` after `"@agenta/playground-ui"`; `ee/next.config.ts` extends this config, no separate edit)
- Modify: `web/oss/package.json` (dependencies, next to line 26 `@agenta/playground`) — add `"@agenta/chat": "workspace:../packages/agenta-chat"`
- Modify: `web/ee/package.json` (dependencies, next to line 27) — same entry
- No change needed: `web/pnpm-workspace.yaml` already globs `packages/*`; package lint reuses `web/packages/eslint.config.mjs`; turbo discovers workspace packages automatically.

**Steps**
- [ ] Write the failing test first — `tests/unit/package.test.ts` (this is also the permanent forbidden-deps guard):

```ts
import {readFileSync} from "node:fs"
import {join} from "node:path"

import {describe, expect, it} from "vitest"

const FORBIDDEN = ["antd", "@ant-design/x", "@ant-design/icons", "react-virtuoso", "lexical"]

describe("@agenta/chat package contract", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"))

    it("is named @agenta/chat with a src entry", () => {
        expect(pkg.name).toBe("@agenta/chat")
        expect(pkg.main).toBe("./src/index.ts")
    })

    it("never depends on desktop UI toolkits", () => {
        const all = {
            ...pkg.dependencies,
            ...pkg.peerDependencies,
            ...pkg.devDependencies,
        }
        for (const dep of FORBIDDEN) expect(all[dep], dep).toBeUndefined()
    })
})
```

- [ ] Run `cd web/packages/agenta-chat && pnpm vitest run` — expect FAIL (no package.json / vitest yet; the scaffold doesn't exist).
- [ ] Create `package.json`, mirroring `web/packages/agenta-playground/package.json`:

```json
{
    "name": "@agenta/chat",
    "version": "0.1.0",
    "private": true,
    "sideEffects": false,
    "main": "./src/index.ts",
    "types": "./src/index.ts",
    "scripts": {
        "build": "tsc --noEmit",
        "types:check": "tsc --noEmit",
        "lint": "eslint --config ../eslint.config.mjs src/",
        "test": "pnpm run test:unit",
        "test:unit": "vitest run",
        "test:watch": "vitest",
        "test:coverage": "vitest run --coverage",
        "check": "pnpm run types:check && pnpm run lint"
    },
    "exports": {
        ".": "./src/index.ts",
        "./model": "./src/model/index.ts",
        "./state": "./src/state/index.ts",
        "./hooks": "./src/hooks/index.ts",
        "./skin": "./src/skin/index.ts"
    },
    "dependencies": {
        "@agenta/entities": "workspace:../agenta-entities",
        "@agenta/playground": "workspace:../agenta-playground",
        "@agenta/shared": "workspace:../agenta-shared"
    },
    "peerDependencies": {
        "@ai-sdk/react": ">=3.0.0-beta.0",
        "ai": ">=6.0.0-beta.0",
        "jotai": ">=2.0.0",
        "react": ">=18.0.0"
    },
    "devDependencies": {
        "@types/node": "^20.19.20",
        "@types/react": "^19.0.10",
        "@vitest/coverage-v8": "^4.1.4",
        "ai": "6.0.0-beta.150",
        "typescript": "^5.9.3",
        "vitest": "^4.1.4"
    }
}
```

  (Note: `exports` lists `./state`, `./hooks`, `./skin` up front; their `index.ts` files are created in Tasks 12–13 — until then only `.` and `./model` resolve, which is fine because nothing imports the others yet. If the eslint import resolver complains, add the subpath entries in the task that creates each directory instead.)
- [ ] Create `tsconfig.json` (verbatim from agenta-playground):

```json
{
    "extends": "../tsconfig.base.json",
    "compilerOptions": {
        "baseUrl": ".",
        "rootDir": "src",
        "tsBuildInfoFile": ".tsbuildinfo",
        "moduleResolution": "bundler"
    },
    "include": ["src/**/*.ts", "src/**/*.tsx", "../css-modules.d.ts"],
    "exclude": ["node_modules", "dist"]
}
```

- [ ] Create `vitest.config.ts` (verbatim from agenta-playground: `include: ["tests/unit/**/*.test.ts"]`, `environment: "node"`, junit reporter, v8 coverage over `src/**/*.ts` excluding `src/**/index.ts`).
- [ ] Create `src/index.ts` with `export * from "./model"` and `src/model/index.ts` as the model barrel (until Task 2 gives it a real module, export a version const: `export const CHAT_PACKAGE = "@agenta/chat"`).
- [ ] Add `"@agenta/chat": "workspace:../packages/agenta-chat"` to `web/oss/package.json` and `web/ee/package.json` dependencies; add `"@agenta/chat"` to the `transpilePackages` array in `web/oss/next.config.ts:90-100`.
- [ ] Run `cd web && pnpm install` to link the workspace package.
- [ ] Run `cd web/packages/agenta-chat && pnpm vitest run` — expect PASS (2 tests).
- [ ] Run `cd web/packages/agenta-chat && pnpm run check` and `cd web && pnpm turbo run types:check --filter=@agenta/oss` — expect PASS.
- [ ] `cd web && pnpm lint-fix`, then commit: `feat(chat): scaffold @agenta/chat headless package`

---

## Phase 2 — Neutralize the type leaks (behavior-neutral for OSS)

### Task 2: Neutral `PendingAttachment` replaces antd `UploadFile` as attachment state

Decision (from reading the markup): `ComposerAttachments.tsx` only reads `f.uid`, `f.name`, and `f.originFileObj as File` (for `type`/`size`/preview) — it has no use for any other `UploadFile` field, so it switches to `PendingAttachment` directly; no render-time adapter is needed anywhere.

**Files**
- Create: `web/packages/agenta-chat/src/model/attachments.ts` (+ re-export from `src/model/index.ts`)
- Create: `web/packages/agenta-chat/tests/unit/model/attachments.test.ts`
- Modify: `web/oss/src/components/AgentChatSlice/state/sessionEphemera.ts` (line 1 antd import, line 29 map type)
- Modify: `web/oss/src/components/AgentChatSlice/AgentConversation.tsx` (lines 48, 364, 1515-1526, plus every `originFileObj` read in the send path ~499-516 — find them all with `grep -n originFileObj web/oss/src/components/AgentChatSlice/AgentConversation.tsx`)
- Modify: `web/oss/src/components/AgentChatSlice/components/ComposerAttachments.tsx` (lines 13, 26, 60, 125)

**Steps**
- [ ] Failing test `tests/unit/model/attachments.test.ts`:

```ts
import {describe, expect, it} from "vitest"

import {toPendingAttachment} from "../../../src/model/attachments"

describe("toPendingAttachment", () => {
    it("derives the same uid formula the desktop composer used", () => {
        const file = new File(["hello"], "notes.txt", {lastModified: 1720000000000})
        const att = toPendingAttachment(file)
        expect(att).toEqual({
            file,
            uid: `notes.txt-1720000000000-${file.size}`,
            name: "notes.txt",
        })
    })
})
```

- [ ] Run `pnpm vitest run tests/unit/model/attachments.test.ts` — expect FAIL (module missing).
- [ ] Implement `src/model/attachments.ts` (uid formula lifted verbatim from `AgentConversation.tsx:1515-1520`):

```ts
/** Neutral pending-attachment state — the headless replacement for antd `UploadFile`. */
export interface PendingAttachment {
    /** The live blob; never serialized (same lifetime as the composer draft). */
    file: File
    uid: string
    name: string
}

export const toPendingAttachment = (file: File): PendingAttachment => ({
    file,
    uid: `${file.name}-${file.lastModified}-${file.size}`,
    name: file.name,
})
```

- [ ] Run the test — expect PASS.
- [ ] OSS re-import, `sessionEphemera.ts`: delete `import type {UploadFile} from "antd"` (line 1), add `import type {PendingAttachment} from "@agenta/chat"`, change line 29 to `export const attachmentsBySession = new Map<string, PendingAttachment[]>()` (update the doc comment: `PendingAttachment.file holds live File blobs`).
- [ ] OSS re-import, `AgentConversation.tsx`: remove the `UploadFile` type import (line 48); line 364 `useState<PendingAttachment[]>(...)`; delete the local `toUploadFile` (1515-1520) and import `toPendingAttachment` + `PendingAttachment` from `@agenta/chat`; line 1526 `accepted.map(toPendingAttachment)`; replace every `f.originFileObj` read (send path, ~499-516) with `f.file` (no cast needed — it is a real `File`).
- [ ] OSS re-import, `ComposerAttachments.tsx`: replace the `UploadFile` import (line 13) with `import type {PendingAttachment} from "@agenta/chat"`; props `files: PendingAttachment[]` (line 26); line 60 and line 125 become `const file = f.file` (drop the `as File | undefined` casts and the `file ?` guards where they only existed because `originFileObj` was optional — `f.file` is always present, so `const size = formatBytes(file.size)` simplifies).
- [ ] Verify: `cd web && pnpm turbo run types:check --filter=@agenta/oss --filter=@agenta/chat` PASS; confirm `grep -rn "UploadFile" web/oss/src/components/AgentChatSlice/` returns nothing.
- [ ] `cd web && pnpm lint-fix`; commit: `refactor(chat): neutralize attachment state to PendingAttachment`

### Task 3: Move virtuoso `StateSnapshot` out of shared session ephemera

**Files**
- Create: `web/oss/src/components/AgentChatSlice/state/virtuosoState.ts` (desktop-local)
- Modify: `web/oss/src/components/AgentChatSlice/state/sessionEphemera.ts` (drop line 2 `react-virtuoso` import, lines 16-21 `virtStateBySession`, and its `delete` in `clearSessionEphemera` line 45)
- Modify: `web/oss/src/components/AgentChatSlice/AgentConversation.tsx` (line 108 import; usages at 451, 459 unchanged)
- Modify: `web/oss/src/components/AgentChatSlice/state/sessions.ts` (line 8 import; call sites 243, 324)

**Steps** (pure move — no package test; OSS typecheck is the gate)
- [ ] Create `state/virtuosoState.ts` carrying the `virtStateBySession` map and its doc comment verbatim from `sessionEphemera.ts:16-21`, plus:

```ts
export const clearVirtuosoState = (sessionId: string) => virtStateBySession.delete(sessionId)
```

- [ ] Remove the map, the `StateSnapshot` import, and the `virtStateBySession.delete(sessionId)` line from `sessionEphemera.ts` (`clearSessionEphemera` keeps drafts/attachments/fresh markers).
- [ ] `AgentConversation.tsx:108`: import `virtStateBySession` from `./state/virtuosoState` instead of `./state/sessionEphemera`.
- [ ] `sessions.ts`: add `import {clearVirtuosoState} from "./virtuosoState"` and call it immediately next to both `clearSessionEphemera(id)` calls (lines 243 and 324) so deleted sessions still drop their snapshots.
- [ ] Verify OSS typecheck PASS; confirm `grep -n "react-virtuoso" web/oss/src/components/AgentChatSlice/state/sessionEphemera.ts` is empty.
- [ ] `cd web && pnpm lint-fix`; commit: `refactor(chat): move virtuoso snapshots out of shared session ephemera`

### Task 4: Neutral `MessageAction` toolbar descriptors

**Files**
- Create: `web/packages/agenta-chat/src/model/actions.ts` (+ barrel export)
- Modify: `web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx` (toolbar block, lines 561-618 — read it first; it builds antd-x `ActionsProps["items"]` inline)

**Steps**
- [ ] Add the neutral type (type-only, no test needed beyond typecheck — it is the contract shape from chat-headless-contract.md §2 item 3):

```ts
import type {ReactNode} from "react"

/** Neutral message-toolbar action — skins map these to their own toolbar markup. */
export interface MessageAction {
    key: string
    label: string
    icon?: ReactNode
    onClick: () => void
}
```

- [ ] In `AgentMessage.tsx`, split the current 561-618 block in two: (1) a `const toolbarActions: MessageAction[] = [...]` array holding key/label/icon/onClick for copy, regenerate, rewind, trace, etc. (typed with the package import), then (2) the existing antd-x `<Actions>` call maps `toolbarActions` to its `items` prop at the JSX site. Behavior and markup identical; only the intermediate data shape changes.
- [ ] Verify OSS typecheck + a manual glance that the rendered `items` mapping preserves any antd-x-specific fields (e.g. `onItemClick`) exactly as before.
- [ ] `cd web && pnpm lint-fix`; commit: `refactor(chat): shape message toolbar as neutral action descriptors`

---

## Phase 3 — Lift the pure blocks (fixture tests + immediate OSS re-import)

Fixture strategy for all Phase 3 tasks: hand-authored `UIMessage[]` JSON fixtures under `web/packages/agenta-chat/tests/unit/fixtures/`, loaded via direct JSON import (vitest handles it), cast `as unknown as UIMessage[]`. One fixture file per shape: `textTurn.json`, `toolTurn.json`, `approvalTurn.json`, `supersededGate.json`, `emptyTurns.json`, `reasoningOnlyTurn.json`. The before/after guarantee is by construction — the code is moved verbatim and OSS re-imports it in the same commit — and the fixture tests pin the behavior against regression.

### Task 5: `src/model/parts.ts` — part predicates, tool identity, `partToolName`

**Files**
- Create: `web/packages/agenta-chat/src/model/parts.ts` (+ barrel export)
- Create: `web/packages/agenta-chat/tests/unit/model/parts.test.ts` and `tests/unit/fixtures/emptyTurns.json`
- Modify: `web/oss/src/components/AgentChatSlice/AgentConversation.tsx` (delete lines 172-185: `isVisiblePart`, `isEmptyAssistantTurn`; import from `@agenta/chat`)
- Modify: `web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx` (delete lines 110-121: `isToolPart`, `toolIdentity`; import)
- Modify: `web/oss/src/components/AgentChatSlice/components/ApprovalDock.tsx` (delete line 26 local `isToolPart`; import)
- Modify: `web/oss/src/components/AgentChatSlice/assets/toolDisplay.ts` (move `partToolName` (line 79 ff.) verbatim into the package; keep a re-export so existing importers are untouched)

**Steps**
- [ ] Fixture `tests/unit/fixtures/emptyTurns.json`:

```json
[
    {"id": "u1", "role": "user", "parts": [{"type": "text", "text": "hi"}]},
    {"id": "a1", "role": "assistant", "parts": []},
    {"id": "a2", "role": "assistant", "parts": [{"type": "reasoning", "text": "   "}]},
    {"id": "a3", "role": "assistant", "parts": [{"type": "text", "text": "hello"}]}
]
```

- [ ] Failing test:

```ts
import type {ToolUIPart, UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {isEmptyAssistantTurn, isToolPart, isVisiblePart, toolIdentity} from "../../../src/model/parts"
import emptyTurnsJson from "../fixtures/emptyTurns.json"

const emptyTurns = emptyTurnsJson as unknown as UIMessage[]

describe("part predicates", () => {
    it("classifies tool part types", () => {
        expect(isToolPart("tool-search")).toBe(true)
        expect(isToolPart("dynamic-tool")).toBe(true)
        expect(isToolPart("text")).toBe(false)
    })
    it("treats blank text/reasoning as invisible", () => {
        expect(isVisiblePart({type: "reasoning", text: "   "} as never)).toBe(false)
        expect(isVisiblePart({type: "file"} as never)).toBe(true)
    })
    it("collapses truly empty assistant turns", () => {
        expect(emptyTurns.map(isEmptyAssistantTurn)).toEqual([false, true, true, false])
    })
    it("keys tool identity on type + input JSON", () => {
        const p = {type: "tool-x", input: {a: 1}} as unknown as ToolUIPart
        expect(toolIdentity(p)).toBe('tool-x::{"a":1}')
        expect(toolIdentity({type: "tool-x"} as unknown as ToolUIPart)).toBe("tool-x::null")
    })
})
```

- [ ] Run — expect FAIL. Implement `src/model/parts.ts` with the code moved verbatim: `isToolPart` (AgentMessage.tsx:110), `isVisiblePart` + `isEmptyAssistantTurn` (AgentConversation.tsx:172-185, with the tool-type disjunct expressed via `isToolPart`), `toolIdentity` (AgentMessage.tsx:112-121 including the try/catch and doc comment), and `partToolName` moved verbatim from `assets/toolDisplay.ts:79`. Run — expect PASS.
- [ ] OSS re-import in the same commit: delete the four local copies listed under Files, import from `@agenta/chat`; `assets/toolDisplay.ts` re-exports `partToolName` so `ApprovalDock.tsx` and others keep compiling unchanged.
- [ ] Verify: package tests PASS, `pnpm run check` PASS, OSS typecheck PASS, `pnpm lint-fix`.
- [ ] Commit: `refactor(chat): lift part predicates and tool identity into @agenta/chat`

### Task 6: `src/model/error.ts` — `parseAgentRunError`

**Files**
- Create: `web/packages/agenta-chat/src/model/error.ts` (+ barrel export)
- Create: `web/packages/agenta-chat/tests/unit/model/error.test.ts`
- Modify: `web/oss/src/components/AgentChatSlice/AgentConversation.tsx` (delete lines 187-220 `ParsedRunError` + `parseAgentRunError`; import both from `@agenta/chat`)

**Steps**
- [ ] Failing test:

```ts
import {describe, expect, it} from "vitest"

import {parseAgentRunError} from "../../../src/model/error"

describe("parseAgentRunError", () => {
    it("extracts message+code from a status envelope", () => {
        const raw = JSON.stringify({status: {code: 429, message: "Rate limited"}})
        expect(parseAgentRunError(new Error(raw))).toEqual({message: "Rate limited", code: 429})
    })
    it("extracts a top-level message envelope", () => {
        expect(parseAgentRunError('{"message":"Agent run failed: boom"}')).toEqual({
            message: "Agent run failed: boom",
        })
    })
    it("passes plain strings through", () => {
        expect(parseAgentRunError("socket hang up")).toEqual({message: "socket hang up"})
    })
    it("falls back on empty/undefined input", () => {
        expect(parseAgentRunError(undefined)).toEqual({message: "The agent run failed."})
        expect(parseAgentRunError("")).toEqual({message: "The agent run failed."})
    })
})
```

- [ ] Run — FAIL. Implement `src/model/error.ts` — the interface and function moved **verbatim** from `AgentConversation.tsx:187-220` (including the `undefined`-vs-omitted `code` behavior: return `{message, code: typeof status?.code === "number" ? status.code : undefined}`; if the strict-equality `toEqual` on the envelope-without-code case trips over an explicit `code: undefined` key, assert with `expect(res.message)`/`expect(res.code).toBeUndefined()` instead — do NOT change the moved code). Run — PASS.
- [ ] OSS re-import: delete the local block, `import {parseAgentRunError, type ParsedRunError} from "@agenta/chat"`. Typecheck, lint-fix.
- [ ] Commit: `refactor(chat): lift parseAgentRunError into @agenta/chat`

### Task 7: `src/model/toolSummary.ts` — tool output summarization

**Files**
- Create: `web/packages/agenta-chat/src/model/toolSummary.ts` (+ barrel export)
- Create: `web/packages/agenta-chat/tests/unit/model/toolSummary.test.ts`
- Modify: `web/oss/src/components/AgentChatSlice/assets/toolFormat.ts` (move `stripFence` (line 13) into the package next to its consumer; re-export from the asset file)
- Modify: `web/oss/src/components/AgentChatSlice/components/ToolActivity.tsx` (delete lines 35-92: `SETTLED`/`isSettled`, `isDeferredError`, `isNotHandledOutput`, `summarizeOutput`, `rowSummary`; import from `@agenta/chat`)

**Steps**
- [ ] Failing test:

```ts
import type {ToolUIPart} from "ai"
import {describe, expect, it} from "vitest"

import {isSettled, rowSummary, summarizeOutput} from "../../../src/model/toolSummary"

describe("summarizeOutput", () => {
    it("counts array results", () => {
        expect(summarizeOutput([1, 2])).toBe("2 results")
        expect(summarizeOutput([1])).toBe("1 result")
    })
    it("normalizes and clamps strings at 80 chars", () => {
        expect(summarizeOutput("  a\n b  ")).toBe("a b")
        expect(summarizeOutput("x".repeat(100))).toBe(`${"x".repeat(80)}…`)
    })
    it("prefers well-known string fields, else counts fields", () => {
        expect(summarizeOutput({summary: "done", other: 1})).toBe("done")
        expect(summarizeOutput({a: 1, b: 2})).toBe("2 fields")
        expect(summarizeOutput({})).toBeNull()
    })
})

describe("rowSummary", () => {
    const part = (over: object): ToolUIPart => ({type: "tool-x", ...over}) as unknown as ToolUIPart
    it("marks not_handled outputs", () => {
        expect(rowSummary(part({state: "output-available", output: {status: "not_handled"}}))).toBe(
            "not handled by this client",
        )
    })
    it("lets a registered per-tool summary win, normalized", () => {
        const display = {summary: () => "  custom   line  "}
        expect(rowSummary(part({state: "output-available", output: {a: 1}}), display)).toBe(
            "custom line",
        )
    })
    it("maps deferred errors, failures, denials", () => {
        expect(
            rowSummary(part({state: "output-error", errorText: "DEFERRED_NOT_EXECUTED:x"})),
        ).toBe("waiting on another approval")
        expect(rowSummary(part({state: "output-error", errorText: "boom"}))).toBe("failed")
        expect(rowSummary(part({state: "output-denied"}))).toBe("denied")
        expect(isSettled("output-denied")).toBe(true)
        expect(isSettled("input-streaming")).toBe(false)
    })
})
```

- [ ] Run — FAIL. Implement `src/model/toolSummary.ts`: move `ToolActivity.tsx:35-92` **verbatim** (`SETTLED`, `isSettled`, `DEFERRED_PREFIX`, `isDeferredError`, `isNotHandledOutput`, `summarizeOutput`, `rowSummary` with all doc comments), plus `stripFence` moved from `assets/toolFormat.ts:13`. Type the second `rowSummary` parameter with a minimal structural interface so the OSS `ToolDisplay` stays where it is until Phase 5:

```ts
export interface ToolSummaryDisplay {
    summary?: (input: unknown, output: unknown) => string | null | undefined
}
export const rowSummary = (part: ToolUIPart, display?: ToolSummaryDisplay): string | null => { /* moved body */ }
```

- [ ] Run — PASS. OSS re-import: `ToolActivity.tsx` imports `{isSettled, rowSummary, summarizeOutput, isNotHandledOutput}` from `@agenta/chat` (keep `isNotHandledOutput` exported — `StatusIcon` at line 98 uses it); `assets/toolFormat.ts` re-exports `stripFence` from `@agenta/chat` for its other importers. Typecheck, lint-fix.
- [ ] Commit: `refactor(chat): lift tool output summarization into @agenta/chat`

### Task 8: `src/model/approvals.ts` — `getPendingApprovals`

**Files**
- Create: `web/packages/agenta-chat/src/model/approvals.ts` (+ barrel export)
- Create: `web/packages/agenta-chat/tests/unit/model/approvals.test.ts` and `tests/unit/fixtures/approvalTurn.json`
- Modify: `web/oss/src/components/AgentChatSlice/components/ApprovalDock.tsx` (delete the `PendingApproval` interface, `ApprovalRef`, and `getPendingApprovals` lines ~10-45; import from `@agenta/chat`)
- Modify: `web/oss/src/components/AgentChatSlice/AgentConversation.tsx` (line 996 call site: import `getPendingApprovals` from `@agenta/chat` instead of the ApprovalDock module)

**Steps**
- [ ] Fixture `approvalTurn.json`:

```json
[
    {"id": "u1", "role": "user", "parts": [{"type": "text", "text": "clean up /tmp"}]},
    {"id": "a1", "role": "assistant", "parts": [
        {"type": "tool-delete_files", "toolCallId": "c1", "state": "approval-requested",
         "input": {"path": "/tmp"}, "approval": {"id": "appr_1"}},
        {"type": "tool-list_files", "toolCallId": "c2", "state": "output-available",
         "input": {"path": "/tmp"}, "output": ["a", "b"]},
        {"type": "dynamic-tool", "toolName": "shell", "toolCallId": "c3",
         "state": "approval-requested", "input": {"cmd": "rm -rf"}, "approval": {"id": "appr_2"}}
    ]}
]
```

- [ ] Failing test asserting: two approvals in order `[{approvalId: "appr_1", toolName: "delete_files", input: {path: "/tmp"}}, {approvalId: "appr_2", toolName: "shell", input: {cmd: "rm -rf"}}]` (second `toolName` per `partToolName`'s dynamic-tool handling — adjust the expectation to whatever `partToolName` actually returns for the fixture once Task 5 moved it); empty array when the last message is a user turn; empty array for `[]`.
- [ ] Run — FAIL. Implement by moving `ApprovalDock.tsx:22-45` **verbatim** (interfaces + function), importing `isToolPart`/`partToolName` from `./parts`. Run — PASS.
- [ ] OSS re-import: `ApprovalDock.tsx` and `AgentConversation.tsx` both import from `@agenta/chat`; delete the ApprovalDock-local export. Typecheck, lint-fix.
- [ ] Commit: `refactor(chat): lift getPendingApprovals into @agenta/chat`

### Task 9: `src/model/turnStatus.ts` — hasAnswer / noResponse / error derivation

**Files**
- Create: `web/packages/agenta-chat/src/model/turnStatus.ts` (+ barrel export)
- Create: `web/packages/agenta-chat/tests/unit/model/turnStatus.test.ts` and `tests/unit/fixtures/reasoningOnlyTurn.json`
- Modify: `web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx` (lines 280-312: replace the inline `hasAnswer`/`hasReasoning`/`hasContent`/`noResponse`/`errorText`/`showError`/`isError` block with one call; lines 270-278 `fullText`/`sources` stay — they are render concerns)

**Steps**
- [ ] Failing test (fixtures: a text turn, `reasoningOnlyTurn.json` with a single non-empty reasoning part, an empty-parts turn):

```ts
import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {deriveTurnStatus} from "../../../src/model/turnStatus"
import reasoningOnlyJson from "../fixtures/reasoningOnlyTurn.json"

const reasoningOnly = (reasoningOnlyJson as unknown as UIMessage[])[0]
const settled = {isUser: false, isStreaming: false}

describe("deriveTurnStatus", () => {
    it("reasoning alone is not an answer — settled turn reads noResponse", () => {
        const s = deriveTurnStatus(reasoningOnly, settled)
        expect(s.hasAnswer).toBe(false)
        expect(s.hasReasoning).toBe(true)
        expect(s.hasContent).toBe(true)
        expect(s.noResponse).toBe(true)
    })
    it("trusts traceError only on answer-less turns; runError always counts", () => {
        const withTrace = deriveTurnStatus(reasoningOnly, {...settled, traceError: "quota"})
        expect(withTrace).toMatchObject({errorText: "quota", showError: true, isError: true})
        const answered = {
            id: "a",
            role: "assistant",
            parts: [{type: "text", text: "hi"}],
        } as unknown as UIMessage
        const recovered = deriveTurnStatus(answered, {...settled, traceError: "quota"})
        expect(recovered.errorText).toBeNull()
        const streamDeath = deriveTurnStatus(answered, {...settled, runError: "died"})
        expect(streamDeath).toMatchObject({errorText: "died", showError: true, isError: false})
    })
    it("streaming suppresses showError", () => {
        const s = deriveTurnStatus(reasoningOnly, {isUser: false, isStreaming: true, runError: "x"})
        expect(s.showError).toBe(false)
        expect(s.noResponse).toBe(false)
    })
})
```

- [ ] Run — FAIL. Implement `deriveTurnStatus(message, {isUser, isStreaming, traceError?, runError?})` returning `{hasAnswer, hasReasoning, hasContent, noResponse, errorText, showError, isError}` — the seven derivations moved **verbatim** from `AgentMessage.tsx:280-312` (with `isToolPart` from `./parts`; `errorText` normalized to `string | null`; keep every original comment — they encode the trace-vs-run error policy). Run — PASS.
- [ ] OSS re-import in `AgentMessage.tsx`:

```ts
const {hasAnswer, hasContent, noResponse, errorText, showError, isError} = deriveTurnStatus(
    message,
    {isUser, isStreaming, traceError, runError},
)
```

  (`copyText` at line 316 keeps working since `errorText: null` is falsy in the `.filter(Boolean)`.) Typecheck, lint-fix.
- [ ] Commit: `refactor(chat): lift turn status derivation into @agenta/chat`

### Task 10: `src/model/renderModel.ts` — the turn render model

**Files**
- Create: `web/packages/agenta-chat/src/model/renderModel.ts` (+ barrel export)
- Create: `web/packages/agenta-chat/tests/unit/model/renderModel.test.ts`, `tests/unit/fixtures/toolTurn.json`, `tests/unit/fixtures/supersededGate.json`
- Modify: `web/oss/src/components/AgentChatSlice/components/AgentMessage.tsx` (lines 329-350 `executedToolIdentities` memo body, 380-416 `RenderItem` type + `isSupersededGate` + `renderItems` builder)

**Steps**
- [ ] Fixtures. `toolTurn.json` — one assistant turn with parts `[text, tool(output-available), tool(output-error), text]` to prove consecutive-tool folding; `supersededGate.json` — one turn with `{type:"tool-write_file", state:"approval-responded", input:{p:1}}` plus an executed sibling `{type:"tool-write_file", state:"output-available", input:{p:1}}` and a still-pending gate `{type:"tool-send_mail", state:"approval-responded", input:{q:2}}` with no executed sibling.
- [ ] Failing test:

```ts
import type {ToolUIPart, UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {buildTurnRenderItems, executedToolIdentities} from "../../../src/model/renderModel"
import supersededJson from "../fixtures/supersededGate.json"
import toolTurnJson from "../fixtures/toolTurn.json"

const toolTurn = (toolTurnJson as unknown as UIMessage[])[0]
const superseded = (supersededJson as unknown as UIMessage[])[0]
const never = () => false

describe("buildTurnRenderItems", () => {
    it("folds only consecutive tool parts into one group", () => {
        const executed = executedToolIdentities(toolTurn.parts)
        const items = buildTurnRenderItems(toolTurn.parts, {executed, isClientToolPart: never})
        expect(items.map((i) => i.kind)).toEqual(["part", "tools", "part"])
        expect(items[1].kind === "tools" && items[1].parts).toHaveLength(2)
    })
    it("drops an answered gate once its executed sibling exists; keeps in-flight gates", () => {
        const executed = executedToolIdentities(superseded.parts)
        const items = buildTurnRenderItems(superseded.parts, {executed, isClientToolPart: never})
        const tools = items.filter((i) => i.kind === "tools").flatMap((i) => (i as {parts: ToolUIPart[]}).parts)
        expect(tools.map((p) => p.state)).toEqual(["output-available", "approval-responded"])
    })
    it("splits client tools out of the fold, breaking the run", () => {
        const isClient = (p: ToolUIPart) => (p as {toolCallId?: string}).toolCallId === "c2"
        const executed = executedToolIdentities(toolTurn.parts)
        const items = buildTurnRenderItems(toolTurn.parts, {executed, isClientToolPart: isClient})
        expect(items.map((i) => i.kind)).toEqual(["part", "tools", "clientTool", "part"])
    })
})
```

- [ ] Run — FAIL. Implement with the code moved from `AgentMessage.tsx` — `RenderItem` union (380-383), executed-identity set (337-350 memo body as a plain function), `isSupersededGate` (390-391 taking the set as a parameter), and the `renderItems` builder loop (398-416), with `isClientToolPart` injected as a predicate so the client-tool registry (Phase 5) stays out of the pure layer:

```ts
export type RenderItem =
    | {kind: "part"; part: UIMessage["parts"][number]; index: number}
    | {kind: "tools"; parts: ToolUIPart[]; index: number}
    | {kind: "clientTool"; part: ToolUIPart; index: number}

export const executedToolIdentities = (parts: UIMessage["parts"]): Set<string> => /* moved */

export const isSupersededGate = (p: ToolUIPart, executed: Set<string>): boolean =>
    p.state === "approval-responded" && executed.has(toolIdentity(p))

export const buildTurnRenderItems = (
    parts: UIMessage["parts"],
    opts: {executed: Set<string>; isClientToolPart: (p: ToolUIPart) => boolean},
): RenderItem[] => /* moved loop */
```

  Keep the original comments (the HITL cold-replay comment at 384-389 especially). Run — PASS.
- [ ] OSS re-import in `AgentMessage.tsx`: the `executedToolIdentities` `useMemo` (337-350) becomes `useMemo(() => executedToolIdentities(message.parts), [toolSignature])` (the `toolSignature` staleness trick stays in the component); delete the local `RenderItem`/`isSupersededGate`/builder and call `buildTurnRenderItems(message.parts, {executed, isClientToolPart: (p) => isClientToolPart(p, {isStreaming, isLastMessage}, renderMap)})`. `renderMap` and the registry-backed `isClientToolPart` stay OSS-side until Phase 5. Typecheck, lint-fix.
- [ ] Commit: `refactor(chat): lift turn render model into @agenta/chat`

### Task 11: `src/model/grouping.ts` + `src/model/sessionStatus.ts` — turn grouping and run-status precedence

**Files**
- Create: `web/packages/agenta-chat/src/model/grouping.ts`, `web/packages/agenta-chat/src/model/sessionStatus.ts` (+ barrel exports)
- Create: `web/packages/agenta-chat/tests/unit/model/grouping.test.ts`
- Modify: `web/oss/src/components/AgentChatSlice/AgentConversation.tsx` (lines 1693-1701 grouping IIFE; lines 1007-1016 status ternary)

**Steps**
- [ ] Failing test:

```ts
import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {getTurnGrouping} from "../../../src/model/grouping"
import {deriveSessionRunStatus} from "../../../src/model/sessionStatus"

const msg = (id: string, role: "user" | "assistant"): UIMessage =>
    ({id, role, parts: []}) as unknown as UIMessage

describe("getTurnGrouping", () => {
    it("anchors the active turn on the last user message", () => {
        const messages = [msg("u1", "user"), msg("a1", "assistant"), msg("u2", "user"), msg("a2", "assistant")]
        expect(getTurnGrouping(messages)).toEqual({lastUserIndex: 2, activeStart: 2, reserveActive: true})
    })
    it("reserves no fill when the active turn opens the transcript", () => {
        expect(getTurnGrouping([msg("u1", "user"), msg("a1", "assistant")])).toEqual({
            lastUserIndex: 0, activeStart: 0, reserveActive: false,
        })
    })
    it("degenerates safely with no user turn", () => {
        expect(getTurnGrouping([msg("a1", "assistant")])).toEqual({
            lastUserIndex: -1, activeStart: 1, reserveActive: true,
        })
    })
})

describe("deriveSessionRunStatus precedence: error > awaiting > running > idle", () => {
    it.each([
        [{error: true, hitlPending: true, busy: true}, "error"],
        [{error: false, hitlPending: true, busy: true}, "awaiting"],
        [{error: false, hitlPending: false, busy: true}, "running"],
        [{error: false, hitlPending: false, busy: false}, "idle"],
    ] as const)("%o -> %s", (input, expected) => {
        expect(deriveSessionRunStatus(input)).toBe(expected)
    })
})
```

- [ ] Run — FAIL. Implement `getTurnGrouping(messages): {lastUserIndex, activeStart, reserveActive}` from `AgentConversation.tsx:1693-1701` (loop + `activeStart` + `reserveActive = activeStart > 0`, comments preserved), and:

```ts
export type SessionRunStatus = "idle" | "running" | "awaiting" | "error"

/** Precedence: error > awaiting approval > running > idle. */
export const deriveSessionRunStatus = (input: {
    error: boolean
    hitlPending: boolean
    busy: boolean
}): SessionRunStatus =>
    input.error ? "error" : input.hitlPending ? "awaiting" : input.busy ? "running" : "idle"
```

- [ ] Run — PASS. OSS re-import: the grouping IIFE becomes `const {lastUserIndex, activeStart, reserveActive} = getTurnGrouping(messages)`; the status effect body (1007-1016) becomes `setSessionStatus({id: sessionId, status: deriveSessionRunStatus({error: !!error, hitlPending, busy})})` (OSS `SessionRunStatus` in `state/sessions.ts` is the identical union — if it's importable, alias it to the package type; otherwise leave both, they are assignable). Typecheck, lint-fix.
- [ ] Commit: `refactor(chat): lift turn grouping and session-status precedence into @agenta/chat`

---

## Phase 4 — Assemble the headless hooks (signatures + paths only; implementation per contract §3)

### Task 12: Move the existing headless hooks and neutral ephemera; assemble the four new hooks

- [ ] Move verbatim (path swap; OSS imports updated in the same commit; the module-level `queuedBySession` map moves with its hook):
  - `web/oss/src/components/AgentChatSlice/hooks/useAgentChatQueue.ts` → `web/packages/agenta-chat/src/hooks/useAgentChatQueue.ts` — `useAgentChatQueue({status, messages, stopped, resumeOrphaned?, sendQueued, sessionId?})`, exports `QueuedMessage {id, text, fileParts?: FileUIPart[]}`. Deps (`@agenta/playground` `canReleaseQueuedMessage`/`isHitlPending`, `@agenta/shared/utils` `generateId`, `ai` types) are all allowed.
  - `web/oss/src/components/AgentChatSlice/hooks/useAgentModelKeyStatus.ts` → `web/packages/agenta-chat/src/hooks/useAgentModelKeyStatus.ts` — returns `AgentModelKeyStatus {provider, model, hasKey, providerEntry, loading, gateActive}`. Deps (`@agenta/entities/secret`, `@agenta/entities/workflow`, `@agenta/shared`, jotai) are all allowed.
  - `web/oss/src/components/AgentChatSlice/state/sessionEphemera.ts` (now neutral after Tasks 2-3) → `web/packages/agenta-chat/src/state/sessionEphemera.ts`; OSS `state/sessions.ts:8` imports `clearSessionEphemera`/`markSessionFresh` from `@agenta/chat/state`.
  - `web/oss/src/components/AgentChatSlice/state/expandState.ts` → `web/packages/agenta-chat/src/state/expandState.ts` (shared key builders `reasoningKey`/`errorKey`/`toolRowKey`/`toolGroupKey` + atoms; pure jotai + `ai` types).
- [ ] New hooks (create with these signatures; bodies lift the corresponding `AgentConversation.tsx` blocks):
  - `web/packages/agenta-chat/src/hooks/useComposerAttachments.ts` — `useComposerAttachments({sessionId, limits}: {sessionId: string; limits: AttachmentLimits}): {files: PendingAttachment[]; rejections: AttachmentRejection[]; add(incoming: File[]): void; remove(uid: string): void; clear(): void; atMax: boolean; toParts(): Promise<FileUIPart[]>}` — lifts `AgentConversation.tsx:362-376,1522-1532` plus `validateIncoming`/`filesToParts` from `assets/attachments.ts`/`assets/files.ts` (both File-based and pure; they move to `src/model/attachmentRules.ts`). Drag-drop handlers (1536-1551) stay OSS-side — they are DOM/desktop concerns.
  - `web/packages/agenta-chat/src/hooks/useSessionHydration.ts` — `useSessionHydration({sessionId, entityId}): {isHydrating: boolean; seeded: boolean}` — lifts the seed → skeleton-vs-hero → server-hydrate → SWR-revalidate sequencing from `AgentConversation.tsx:571-603,891-913`, using `isSessionFresh` from the moved ephemera.
  - `web/packages/agenta-chat/src/hooks/useApprovalDock.ts` — `useApprovalDock({messages, respond}: {messages: UIMessage[]; respond(args: {id: string; approved: boolean}): void}): {current: PendingApproval | null; count: number; respond(approved: boolean): void; approveAll(): void}` — wraps `getPendingApprovals` (Task 8).
  - `web/packages/agenta-chat/src/hooks/useAgentConversation.ts` — the host, exactly the contract §3 sketch: `useAgentConversation({entityId, sessionId}): {messages: UIMessage[]; status: "ready" | "submitted" | "streaming" | "error"; runStatus: SessionRunStatus; error?: ParsedRunError; turns: TurnViewModel[]; send(input: {text: string; files?: File[]}): void; stop(): void; regenerate(id: string): void; rewind(message: UIMessage): RewindPlan; isHydrating: boolean; isEmpty: boolean}` — composes `useChat` + `AgentChatTransport`/`buildAgentRequest` (engine), `useAgentChatQueue`, `useSessionHydration`, `useApprovalDock`, `deriveSessionRunStatus`, `parseAgentRunError`, `getTurnGrouping`, `buildTurnRenderItems`. `RewindPlan = {sideEffects: string[]; confirm(): void}` (pure scan stays in `assets/rewind.ts` → moves to `src/model/rewind.ts`; the antd `modal.confirm` at `AgentConversation.tsx:1672-1685` stays in the skin).
  - `web/packages/agenta-chat/src/hooks/index.ts` + `src/state/index.ts` barrels.
- [ ] OSS re-imports the two moved hooks and the ephemera/expand state immediately (path swaps only); the new hooks' first consumer is the mobile skin (WP3b) — OSS adoption is the follow-up re-plumb.
- [ ] Verify (typecheck both packages, package tests, lint-fix); commit: `feat(chat): assemble headless conversation hooks` (one commit per moved hook is acceptable if the executor prefers smaller steps).

---

## Phase 5 — Skin registration for the three registries (signatures + paths only)

### Task 13: `registerChatSkin` and registry resolvers

- [ ] Create `web/packages/agenta-chat/src/skin/types.ts`:

```ts
export interface ChatSkinRegistration {
    /** render.kind (from renderKindFor) → toolName → widget module. */
    clientTools?: Record<string, Record<string, ClientToolWidget>>
    /** tool name → approval body renderer + copy overrides. */
    approvals?: Record<string, ApprovalBodyEntry>
    /** raw tool name → display metadata (label/source/kind/summary). */
    toolDisplay?: Record<string, ToolDisplayEntry>
}
export interface ClientToolWidget {
    meta: {settle: "auto" | "manual"; degradedEarlierInTurn?: boolean}
    Component: ComponentType<ClientToolWidgetProps>
}
export interface ApprovalBodyEntry {
    Body: ComponentType<{input: unknown; entityId: string; fallback: ReactNode}>
    headline?: string
    approveLabel?: string
}
```

  (`ToolDisplayEntry` = the existing `ToolDisplay` shape from `assets/toolDisplay.ts`, which moves here with its resolver; `ToolSummaryDisplay` from Task 7 becomes a subset of it.)
- [ ] Create `web/packages/agenta-chat/src/skin/registry.ts` — `registerChatSkin(skin: ChatSkinRegistration): void` (merge semantics, last registration wins per key) plus the resolvers the core consumes: `resolveClientToolWidget(kind: string, toolName: string): ClientToolWidget | undefined`, `resolveApprovalBody(toolName: string): ApprovalBodyEntry | undefined`, `resolveToolDisplay(rawName: string): ToolDisplayEntry` — same keys as today (`renderKindFor(...)`, tool name, `resolveToolDisplay(rawName)` per contract §4). Export from `src/skin/index.ts`.
- [ ] OSS registrations stay where they are: `web/oss/src/components/AgentChatSlice/components/clientTools/registry.tsx`, `web/oss/src/components/AgentChatSlice/components/approvals/registry.tsx`, and `web/oss/src/components/AgentChatSlice/assets/toolDisplay.ts` each call `registerChatSkin({...})` at module scope with their existing antd entries; their local `resolve*` helpers become re-exports of the package resolvers so no call site changes. (Alternative `ChatSkinProvider` React context deliberately rejected: the registries are consulted from pure functions like the render-model predicate, and module-level registration matches the existing `Record<string, Renderer>` pattern with zero re-render cost.)
- [ ] Verify + lint-fix; commit: `feat(chat): skin registration for clientTools, approvals, and toolDisplay registries`

---

## Final acceptance

- [ ] `cd web/packages/agenta-chat && pnpm vitest run` — all fixture tests green.
- [ ] `cd web/packages/agenta-chat && pnpm run check` — types + lint green.
- [ ] `cd web && pnpm turbo run types:check --filter=@agenta/oss --filter=@agenta/chat` — green.
- [ ] `grep -rn "antd\|react-virtuoso\|@ant-design" web/packages/agenta-chat/src/` — empty.
- [ ] `grep -rn "UploadFile" web/oss/src/components/AgentChatSlice/` — empty; `grep -n "react-virtuoso" web/oss/src/components/AgentChatSlice/state/sessionEphemera.ts` — empty (file itself moved to the package by Task 12).
- [ ] Desktop chat manually smoke-checked (send, attach, tool turn, approval dock, error turn) — behavior-neutral.

## Not in this plan

- **Desktop re-plumb** of `AgentConversation.tsx` onto `useAgentConversation` (the contract's acceptance test — zero visual change, pure de-duplication) — follow-up track per contract §5 item 5.
- **Mobile skin / WP3b** (shadcn + AI Elements skin in `web/mobile`, elicitation field kinds, ChatSkin registration for mobile).
- **Scroll-hook extraction** (`useConversationScroll`, SC-1..4, jump pill, virtuoso variant, `AgentConversation.tsx:465-488,1140-1497`) — judged follow-up: it is desktop-only, ~350 lines of DOM engineering with no mobile consumer, and Task 3 already removed its only shared-state leak.
- **Moving the remaining engine assets** (`AgentChatTransport`, `transcriptToMessages`, `trace.ts`, markdown) — only the pieces Phase 4 hooks require move in WP3a.
