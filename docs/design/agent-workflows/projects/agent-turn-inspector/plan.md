# Agent Turn Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated, agent-native "Turn Inspector" panel to the agent playground's Build mode, plus a per-turn capture of exactly what was sent to the agent, so the team can debug why the agent misbehaved, what it ran with, and whether tool calls were correct.

**Architecture:** Pure capture/correlation logic lives in `@agenta/playground` (unit-tested). A session-scoped in-memory Jotai store in `web/oss` holds the request snapshots, written from the chat transport at send time (replacing the temp `[AgentChat OUTGOING]` diagnostic). A new `TurnInspector` drawer (its own state, not the trace drawer) renders three tabs — Timeline (message parts), Context (captures), Raw (payloads). The inline Build-mode step log is unchanged.

**Tech Stack:** React, Jotai, TypeScript, antd + `@agenta/ui` (`EnhancedDrawer`), Tailwind (v3, semantic antd tokens), AI SDK `UIMessage`. Package tests: vitest. Node 24 via `export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"`.

**Spec:** `docs/design/agent-workflows/projects/agent-turn-inspector/design.md`

---

## Conventions for every task

- Run FE lint/tsc with Node 24: `export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"` first.
- Lint changed files: from `web/`, `npx eslint --fix <paths>`.
- Typecheck oss: from `web/oss`, `npx tsc --noEmit` (grep for your files — the repo has a pre-existing error baseline; only NEW errors in your files matter).
- Package tests: from `web/packages/agenta-playground`, `npx vitest run tests/unit/<file>`.
- Commit convention: `type(area): Title`. No `Co-Authored-By`, no "Claude"/Anthropic in messages.
- Commit with `git commit --no-verify` after linting manually (the pre-commit `turbo lint` hook has timed out and reverted files in this repo).
- Text size default is `text-xs` (12px); dark mode via antd semantic tokens (`text-colorText`, `bg-colorFillTertiary`, …), never `dark:`.

---

## Phase 1 — Timeline inspector (no new plumbing)

Ships a working inspector that renders any turn's steps exhaustively from data already on the client.

### Task 1: Inspector open-state atom

**Files:**
- Create: `web/oss/src/components/AgentChatSlice/state/turnInspector.ts`

- [ ] **Step 1: Write the atom + target type**

```ts
import {atom} from "jotai"

/** Which assistant turn the Turn Inspector is open on. `null` = closed. */
export interface TurnInspectorTarget {
    sessionId: string
    /** The assistant turn's message id (its parts drive the Timeline tab). */
    assistantMessageId: string
}

export const turnInspectorAtom = atom<TurnInspectorTarget | null>(null)
```

- [ ] **Step 2: Typecheck**

Run (from `web/oss`): `npx tsc --noEmit 2>&1 | grep turnInspector`
Expected: no output (no errors in the new file).

- [ ] **Step 3: Commit**

```bash
git add web/oss/src/components/AgentChatSlice/state/turnInspector.ts
git commit --no-verify -m "feat(frontend): turn-inspector open-state atom"
```

---

### Task 2: Timeline tab component

Renders every part of an assistant turn in order: reasoning, tool calls with full input/output/error, text, and HITL/approval state. Reuses the existing `formatValue`/`IOBlock` idiom from `ToolActivity` but shows everything, un-truncated.

**Files:**
- Create: `web/oss/src/components/AgentChatSlice/components/TurnInspector/TimelineTab.tsx`

- [ ] **Step 1: Write the component**

```tsx
import {memo} from "react"

import type {ToolUIPart, UIMessage} from "ai"
import {Typography} from "antd"

const {Text} = Typography

const isToolPart = (t: string) => t.startsWith("tool-") || t === "dynamic-tool"

const toolName = (part: ToolUIPart): string => {
    const type = part.type as string
    if (type === "dynamic-tool") return (part as {toolName?: string}).toolName || "tool"
    return type.replace(/^tool-/, "")
}

const format = (value: unknown): string => {
    if (value == null) return ""
    if (typeof value === "string") return value
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

const Block = ({label, value, danger}: {label: string; value: string; danger?: boolean}) => (
    <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-[10px] text-colorTextTertiary">{label}</span>
        <pre
            className={`m-0 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded px-2 py-1.5 font-mono text-[11px] leading-snug ${
                danger ? "bg-[var(--ant-color-error-bg)] !text-colorErrorText" : "bg-colorFillTertiary text-colorTextSecondary"
            }`}
        >
            {value}
        </pre>
    </div>
)

const PartNode = ({part}: {part: UIMessage["parts"][number]}) => {
    const type = part.type as string
    if (type === "reasoning") {
        const text = (part as {text?: string}).text ?? ""
        return (
            <div className="flex flex-col gap-1">
                <Text type="secondary" className="!text-[11px] font-medium">reasoning</Text>
                <div className="text-xs italic text-colorTextTertiary whitespace-pre-wrap">{text}</div>
            </div>
        )
    }
    if (type === "text") {
        const text = (part as {text?: string}).text ?? ""
        if (!text.trim()) return null
        return (
            <div className="flex flex-col gap-1">
                <Text type="secondary" className="!text-[11px] font-medium">text</Text>
                <div className="text-xs text-colorText whitespace-pre-wrap">{text}</div>
            </div>
        )
    }
    if (isToolPart(type)) {
        const p = part as ToolUIPart
        const state = p.state as string
        const input = (p as {input?: unknown}).input
        const output = (p as {output?: unknown}).output
        const errorText = (p as {errorText?: string}).errorText
        return (
            <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                    <Text className="!text-xs !font-medium font-mono">{toolName(p)}</Text>
                    <Text
                        type={state === "output-error" ? "danger" : "secondary"}
                        className="!text-[11px]"
                    >
                        {state}
                    </Text>
                </div>
                {input != null ? <Block label="input" value={format(input)} /> : null}
                {errorText !== undefined ? (
                    <Block label="error" value={errorText} danger />
                ) : output != null ? (
                    <Block label="output" value={format(output)} />
                ) : null}
            </div>
        )
    }
    return (
        <div className="flex flex-col gap-1">
            <Text type="secondary" className="!text-[11px] font-medium">{type}</Text>
        </div>
    )
}

/** The Timeline tab: every part of one assistant turn, in order, un-truncated. */
const TimelineTab = ({message}: {message: UIMessage | null}) => {
    if (!message) {
        return <div className="p-4 text-xs text-colorTextTertiary">No turn selected.</div>
    }
    const parts = message.parts ?? []
    return (
        <div className="flex flex-col gap-4 p-4">
            {parts.length === 0 ? (
                <div className="text-xs text-colorTextTertiary">This turn produced no parts.</div>
            ) : (
                parts.map((part, i) => (
                    <div key={`${message.id}-${i}`} className="border-0 border-l-2 border-solid border-colorBorderSecondary pl-3">
                        <PartNode part={part} />
                    </div>
                ))
            )}
        </div>
    )
}

export default memo(TimelineTab)
```

- [ ] **Step 2: Lint + typecheck**

Run (from `web`): `npx eslint --fix oss/src/components/AgentChatSlice/components/TurnInspector/TimelineTab.tsx`
Run (from `web/oss`): `npx tsc --noEmit 2>&1 | grep TimelineTab`
Expected: eslint clean; no tsc output for the file.

- [ ] **Step 3: Commit**

```bash
git add web/oss/src/components/AgentChatSlice/components/TurnInspector/TimelineTab.tsx
git commit --no-verify -m "feat(frontend): turn-inspector Timeline tab"
```

---

### Task 3: Inspector drawer shell (Timeline only for now)

**Files:**
- Create: `web/oss/src/components/AgentChatSlice/components/TurnInspector/TurnInspector.tsx`
- Reference: `web/packages/agenta-ui` exports `EnhancedDrawer` (confirm the import path with `grep -rn "EnhancedDrawer" web/packages/agenta-ui/src/index.ts`).

- [ ] **Step 1: Confirm the drawer primitive export**

Run: `grep -rn "EnhancedDrawer" web/packages/agenta-ui/src`
Expected: an exported `EnhancedDrawer` (used by the cron/schedule drawers). Note its exact import specifier (e.g. `@agenta/ui`); use it below. If it does not exist, fall back to antd `Drawer` with `rootClassName` for dark-mode tokens.

- [ ] **Step 2: Write the shell**

```tsx
import {useMemo, useState} from "react"

import {EnhancedDrawer} from "@agenta/ui"
import type {UIMessage} from "ai"
import {Segmented} from "antd"
import {useAtom, useAtomValue} from "jotai"

import {sessionMessagesAtom} from "../../state/sessions"
import {turnInspectorAtom} from "../../state/turnInspector"

import TimelineTab from "./TimelineTab"

type Tab = "timeline" | "context" | "raw"

/** Dedicated Build-mode turn inspector. Own state (`turnInspectorAtom`), NOT the trace drawer. */
const TurnInspector = () => {
    const [target, setTarget] = useAtom(turnInspectorAtom)
    const allMessages = useAtomValue(sessionMessagesAtom)
    const [tab, setTab] = useState<Tab>("timeline")

    const message: UIMessage | null = useMemo(() => {
        if (!target) return null
        const list = allMessages[target.sessionId] ?? []
        return list.find((m) => m.id === target.assistantMessageId) ?? null
    }, [target, allMessages])

    return (
        <EnhancedDrawer
            open={!!target}
            onClose={() => setTarget(null)}
            width={560}
            title="Turn inspector"
            destroyOnClose
        >
            <div className="flex h-full min-h-0 flex-col">
                <div className="px-4 pt-2">
                    <Segmented<Tab>
                        value={tab}
                        onChange={setTab}
                        options={[
                            {label: "Timeline", value: "timeline"},
                            {label: "Context", value: "context"},
                            {label: "Raw", value: "raw"},
                        ]}
                    />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {tab === "timeline" ? <TimelineTab message={message} /> : null}
                    {tab === "context" ? (
                        <div className="p-4 text-xs text-colorTextTertiary">Context — added in Phase 2.</div>
                    ) : null}
                    {tab === "raw" ? (
                        <div className="p-4 text-xs text-colorTextTertiary">Raw — added in Phase 3.</div>
                    ) : null}
                </div>
            </div>
        </EnhancedDrawer>
    )
}

export default TurnInspector
```

- [ ] **Step 3: Lint + typecheck**

Run (from `web`): `npx eslint --fix oss/src/components/AgentChatSlice/components/TurnInspector/TurnInspector.tsx`
Run (from `web/oss`): `npx tsc --noEmit 2>&1 | grep TurnInspector`
Expected: eslint clean; no tsc output. If `EnhancedDrawer`'s props differ (e.g. no `width`/`title`), adjust to its real signature discovered in Step 1.

- [ ] **Step 4: Commit**

```bash
git add web/oss/src/components/AgentChatSlice/components/TurnInspector/TurnInspector.tsx
git commit --no-verify -m "feat(frontend): turn-inspector drawer shell"
```

---

### Task 4: Mount the inspector + add the "Inspect turn" affordance

**Files:**
- Modify: `web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx`

The affordance is added in `AgentConversation`'s `renderMessage`, next to the existing per-turn `Stopped`/`Resend` block, gated on Build mode (`!chatMaximized`) and assistant role. The `<TurnInspector />` is mounted once at the panel root.

- [ ] **Step 1: Add imports**

Add near the other component imports in `AgentChatPanel.tsx`:

```ts
import TurnInspector from "./components/TurnInspector/TurnInspector"
import {turnInspectorAtom} from "./state/turnInspector"
```

- [ ] **Step 2: Read Build mode + the setter inside `AgentConversation`**

Find where `AgentConversation` reads atoms (near `const detailed`/other `useAtomValue` calls in the inner component) and add:

```ts
const openTurnInspector = useSetAtom(turnInspectorAtom)
const buildMode = !useAtomValue(chatPanelMaximizedAtom)
```

(`chatPanelMaximizedAtom` and `useSetAtom` are already imported in this file.)

- [ ] **Step 3: Add the affordance in `renderMessage`**

In `renderMessage`, in the block that already renders the `Stopped` tag for `isLast && message.role === "assistant"`, add an always-available (Build-mode) inspect button for assistant turns. Insert this just after the existing `{stopped && isLast && message.role === "assistant" && (...)}` block, inside the `<MessageRow>`:

```tsx
{buildMode && message.role === "assistant" && (
    <button
        type="button"
        onClick={() =>
            openTurnInspector({sessionId, assistantMessageId: message.id})
        }
        className="flex w-fit cursor-pointer items-center gap-1 self-start rounded border-0 bg-transparent px-1 py-0.5 text-xs text-colorTextTertiary transition-colors hover:text-colorPrimary"
    >
        <TreeStructure size={12} />
        Inspect turn
    </button>
)}
```

`TreeStructure` is already imported from `@phosphor-icons/react` in `AgentMessage.tsx`; add it to the `AgentChatPanel.tsx` phosphor import (verify with `grep -n "@phosphor-icons/react" web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx` and extend that import).

- [ ] **Step 4: Mount the inspector at the panel root**

In the `AgentConversation` return, just after the opening root `<div className="relative flex h-full min-h-0 w-full flex-col gap-3" ...>` (where `modalContextHolder` is rendered), add:

```tsx
<TurnInspector />
```

- [ ] **Step 5: Lint + typecheck**

Run (from `web`): `npx eslint --fix oss/src/components/AgentChatSlice/AgentChatPanel.tsx`
Run (from `web/oss`): `npx tsc --noEmit 2>&1 | grep AgentChatPanel`
Expected: clean.

- [ ] **Step 6: Manual verification**

Deploy locally (see `hosting/AGENTS.md`), open an agent in the playground, run a tool-using turn, ensure Build mode (config panel visible). Confirm: an "Inspect turn" control appears on the assistant turn; clicking it opens the drawer; the Timeline tab lists reasoning/tool/text parts with input/output/error, un-truncated. In Chat mode (maximized) the control is absent.

- [ ] **Step 7: Commit**

```bash
git add web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx
git commit --no-verify -m "feat(frontend): mount turn inspector + inspect-turn affordance"
```

---

## Phase 2 — Capture store + Context tab

### Task 5: Pure capture + correlation logic (TDD, in the package)

**Files:**
- Create: `web/packages/agenta-playground/src/state/execution/turnCapture.ts`
- Test: `web/packages/agenta-playground/tests/unit/turnCapture.test.ts`
- Modify: `web/packages/agenta-playground/src/index.ts` (or the execution barrel that already exports `buildAgentRequest`) to export the new symbols.

- [ ] **Step 1: Write the failing test**

```ts
import {describe, expect, it} from "vitest"

import {
    appendCapped,
    buildTurnCapture,
    capturesForTrigger,
    triggerUserMessageId,
} from "../../src/state/execution/turnCapture"

describe("turnCapture", () => {
    it("finds the last user message id as the trigger", () => {
        const messages = [
            {id: "u1", role: "user"},
            {id: "a1", role: "assistant"},
            {id: "u2", role: "user"},
            {id: "a2", role: "assistant"},
        ]
        expect(triggerUserMessageId(messages)).toBe("u2")
    })

    it("returns null when there is no user message", () => {
        expect(triggerUserMessageId([{id: "a1", role: "assistant"}])).toBeNull()
    })

    it("builds a capture from a built AgentRequest", () => {
        const req = {
            invocationUrl: "https://x/invoke?project_id=p",
            requestBody: {
                session_id: "s1",
                references: {application: {id: "app"}},
                data: {
                    inputs: {messages: [{id: "u1", role: "user"}]},
                    parameters: {agent: {instructions: {agents_md: "hi"}}},
                },
            },
        }
        const c = buildTurnCapture(req, "req-1", 1000)
        expect(c).toEqual({
            requestId: "req-1",
            at: 1000,
            triggerUserMessageId: "u1",
            parameters: {agent: {instructions: {agents_md: "hi"}}},
            messages: [{id: "u1", role: "user"}],
            references: {application: {id: "app"}},
            sessionId: "s1",
            invocationUrl: "https://x/invoke?project_id=p",
        })
    })

    it("groups all sends of a turn under one trigger id", () => {
        const base = {parameters: {}, messages: [], references: null, sessionId: "s", invocationUrl: "u"}
        const captures = [
            {...base, requestId: "r1", at: 1, triggerUserMessageId: "u1"},
            {...base, requestId: "r2", at: 2, triggerUserMessageId: "u1"},
            {...base, requestId: "r3", at: 3, triggerUserMessageId: "u2"},
        ]
        expect(capturesForTrigger(captures, "u1").map((c) => c.requestId)).toEqual(["r1", "r2"])
        expect(capturesForTrigger(captures, null)).toEqual([])
    })

    it("evicts the oldest whole turns beyond the cap, keeping all sends of kept turns", () => {
        const base = {parameters: {}, messages: [], references: null, sessionId: "s", invocationUrl: "u"}
        let list: ReturnType<typeof capturesForTrigger> = []
        list = appendCapped(list, {...base, requestId: "r1", at: 1, triggerUserMessageId: "u1"}, 2)
        list = appendCapped(list, {...base, requestId: "r1b", at: 2, triggerUserMessageId: "u1"}, 2)
        list = appendCapped(list, {...base, requestId: "r2", at: 3, triggerUserMessageId: "u2"}, 2)
        list = appendCapped(list, {...base, requestId: "r3", at: 4, triggerUserMessageId: "u3"}, 2)
        // u1 (oldest turn) evicted; both u1 sends gone; u2 + u3 kept.
        expect(list.map((c) => c.triggerUserMessageId)).toEqual(["u2", "u3"])
    })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `web/packages/agenta-playground`): `npx vitest run tests/unit/turnCapture.test.ts`
Expected: FAIL — cannot resolve `../../src/state/execution/turnCapture`.

- [ ] **Step 3: Write the implementation**

```ts
/** A snapshot of one request sent to the agent, taken at send time so the Context/Raw tabs are
 * accurate AT THAT TURN (the config drifts after a self-commit; reconstructing later lies). */
export interface TurnRequestCapture {
    requestId: string
    at: number
    /** Last `role:"user"` message id in the sent array; shared by a turn's initial send + resumes. */
    triggerUserMessageId: string | null
    parameters: unknown
    messages: unknown[]
    references: unknown
    sessionId: string
    invocationUrl: string
}

interface MessageLike {
    id?: string
    role?: string
}

export const triggerUserMessageId = (messages: MessageLike[]): string | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === "user") return messages[i]?.id ?? null
    }
    return null
}

/** Build a capture from a built `AgentRequest` (the return of `buildAgentRequest`). `requestId`
 * and `at` are supplied by the caller so this stays pure/testable. */
export const buildTurnCapture = (
    req: {invocationUrl: string; requestBody: Record<string, unknown>},
    requestId: string,
    at: number,
): TurnRequestCapture => {
    const body = req.requestBody as {
        session_id?: string
        references?: unknown
        data?: {inputs?: {messages?: unknown[]}; parameters?: unknown}
    }
    const messages = body.data?.inputs?.messages ?? []
    return {
        requestId,
        at,
        triggerUserMessageId: triggerUserMessageId(messages as MessageLike[]),
        parameters: body.data?.parameters ?? null,
        messages,
        references: body.references ?? null,
        sessionId: body.session_id ?? "",
        invocationUrl: req.invocationUrl,
    }
}

/** All sends belonging to one turn (initial + resumes), by trigger id. */
export const capturesForTrigger = (
    captures: TurnRequestCapture[],
    triggerId: string | null,
): TurnRequestCapture[] =>
    triggerId ? captures.filter((c) => c.triggerUserMessageId === triggerId) : []

/** Append a capture, evicting the OLDEST whole turns (by distinct trigger id) beyond `maxTurns`
 * so a kept turn never loses some of its sends. */
export const appendCapped = (
    captures: TurnRequestCapture[],
    capture: TurnRequestCapture,
    maxTurns: number,
): TurnRequestCapture[] => {
    const next = [...captures, capture]
    const triggers: string[] = []
    for (const c of next) {
        const t = c.triggerUserMessageId ?? c.requestId
        if (!triggers.includes(t)) triggers.push(t)
    }
    if (triggers.length <= maxTurns) return next
    const keep = new Set(triggers.slice(triggers.length - maxTurns))
    return next.filter((c) => keep.has(c.triggerUserMessageId ?? c.requestId))
}
```

- [ ] **Step 4: Export the symbols**

In the barrel that already exports `buildAgentRequest` (find it: `grep -rn "buildAgentRequest" web/packages/agenta-playground/src/index.ts`), add:

```ts
export {
    appendCapped,
    buildTurnCapture,
    capturesForTrigger,
    triggerUserMessageId,
    type TurnRequestCapture,
} from "./state/execution/turnCapture"
```

- [ ] **Step 5: Run the test to verify it passes**

Run (from `web/packages/agenta-playground`): `npx vitest run tests/unit/turnCapture.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add web/packages/agenta-playground/src/state/execution/turnCapture.ts web/packages/agenta-playground/tests/unit/turnCapture.test.ts web/packages/agenta-playground/src/index.ts
git commit --no-verify -m "feat(playground): per-turn request capture + correlation helpers"
```

---

### Task 6: Capture store atom

**Files:**
- Create: `web/oss/src/components/AgentChatSlice/state/turnCaptures.ts`

- [ ] **Step 1: Write the store**

```ts
import {appendCapped, type TurnRequestCapture} from "@agenta/playground"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

/** Keep the last N turns' captures per session (ephemeral; debugging surface, not persisted). */
const MAX_TURNS = 20

const capturesBySessionAtom = atom<Record<string, TurnRequestCapture[]>>({})

/** Write one send's capture (called from the transport at send time). */
export const captureTurnRequestAtom = atom(
    null,
    (get, set, capture: TurnRequestCapture) => {
        if (!capture.sessionId) return
        const all = get(capturesBySessionAtom)
        const list = all[capture.sessionId] ?? []
        set(capturesBySessionAtom, {
            ...all,
            [capture.sessionId]: appendCapped(list, capture, MAX_TURNS),
        })
    },
)

/** Read all captures for a session. */
export const sessionCapturesAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => get(capturesBySessionAtom)[sessionId] ?? []),
)
```

- [ ] **Step 2: Typecheck**

Run (from `web/oss`): `npx tsc --noEmit 2>&1 | grep turnCaptures`
Expected: no output. (If `@agenta/playground` doesn't resolve the new export, re-run `pnpm --filter @agenta/playground build` or `pnpm install`.)

- [ ] **Step 3: Commit**

```bash
git add web/oss/src/components/AgentChatSlice/state/turnCaptures.ts
git commit --no-verify -m "feat(frontend): session-scoped turn-capture store"
```

---

### Task 7: Capture at send time (replace the temp diagnostic)

**Files:**
- Modify: `web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx`

The transport's `prepareSendMessagesRequest` currently holds the temp `[AgentChat OUTGOING]` `console.warn`. Replace it with a capture write. The setter is read via a ref (the transport `useMemo` must not depend on it).

- [ ] **Step 1: Add imports**

```ts
import {buildTurnCapture} from "@agenta/playground"
import {generateId} from "@agenta/shared/utils"
import {captureTurnRequestAtom} from "./state/turnCaptures"
```

(`buildAgentRequest` is already imported from `@agenta/playground`; `generateId` may already be imported — verify and don't duplicate.)

- [ ] **Step 2: Add a ref'd setter inside `AgentConversation`**

Near `entityIdRef` in `AgentConversation`:

```ts
const captureTurnRequest = useSetAtom(captureTurnRequestAtom)
const captureRef = useRef(captureTurnRequest)
captureRef.current = captureTurnRequest
```

- [ ] **Step 3: Replace the temp diagnostic block**

In `prepareSendMessagesRequest`, delete the entire `// TEMP DIAGNOSTIC …` try/catch block (the `[AgentChat OUTGOING]` console.warn) and replace it with:

```ts
captureRef.current(buildTurnCapture(req, generateId(), Date.now()))
```

Placed after the `if (!req) { throw … }` guard and before `return {api: req.invocationUrl, …}`.

- [ ] **Step 4: Lint + typecheck**

Run (from `web`): `npx eslint --fix oss/src/components/AgentChatSlice/AgentChatPanel.tsx`
Run (from `web/oss`): `npx tsc --noEmit 2>&1 | grep AgentChatPanel`
Expected: clean. The temp `console.warn` is gone (removes the loose diagnostic).

- [ ] **Step 5: Commit**

```bash
git add web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx
git commit --no-verify -m "feat(frontend): capture outgoing agent request per send"
```

---

### Task 8: Context tab

Shows, for the selected turn, every send (initial + resumes) with its config-at-turn and exact messages. Multiple sends render as a numbered list so the loop/stale-config is visible.

**Files:**
- Create: `web/oss/src/components/AgentChatSlice/components/TurnInspector/ContextTab.tsx`
- Modify: `web/oss/src/components/AgentChatSlice/components/TurnInspector/TurnInspector.tsx` (wire the tab + compute the trigger id)

- [ ] **Step 1: Write `ContextTab`**

```tsx
import {memo} from "react"

import {type TurnRequestCapture} from "@agenta/playground"
import {Typography} from "antd"

const {Text} = Typography

const format = (value: unknown): string => {
    if (value == null) return "null"
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

const agentInstructions = (parameters: unknown): string | null => {
    const p = parameters as {agent?: {instructions?: {agents_md?: unknown}}} | null
    const md = p?.agent?.instructions?.agents_md
    return typeof md === "string" ? md : null
}

const agentModel = (parameters: unknown): string | null => {
    const p = parameters as {agent?: {llm?: {model?: unknown}; model?: unknown}} | null
    const m = p?.agent?.llm?.model ?? p?.agent?.model
    return typeof m === "string" ? m : null
}

const Block = ({label, value}: {label: string; value: string}) => (
    <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-[10px] text-colorTextTertiary">{label}</span>
        <pre className="m-0 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-colorFillTertiary px-2 py-1.5 font-mono text-[11px] leading-snug text-colorTextSecondary">
            {value}
        </pre>
    </div>
)

const Send = ({capture, index, total}: {capture: TurnRequestCapture; index: number; total: number}) => {
    const model = agentModel(capture.parameters)
    const instructions = agentInstructions(capture.parameters)
    return (
        <div className="flex flex-col gap-2 rounded-lg border border-solid border-colorBorderSecondary p-3">
            <div className="flex items-center gap-2">
                <Text className="!text-xs !font-medium">Request {index + 1} of {total}</Text>
                {model ? <Text type="secondary" className="!text-[11px] font-mono">{model}</Text> : null}
            </div>
            {instructions != null ? <Block label="instructions (agents_md)" value={instructions} /> : null}
            <Block label="parameters (config as sent)" value={format(capture.parameters)} />
            <Block label={`messages sent (${(capture.messages ?? []).length})`} value={format(capture.messages)} />
        </div>
    )
}

/** The Context tab: every send for the selected turn, config-at-turn + exact messages. */
const ContextTab = ({captures}: {captures: TurnRequestCapture[]}) => {
    if (captures.length === 0) {
        return (
            <div className="p-4 text-xs text-colorTextTertiary">
                No capture for this turn. Captures are recorded live in Build mode; a turn restored from a
                previous session has none.
            </div>
        )
    }
    return (
        <div className="flex flex-col gap-3 p-4">
            {captures.length > 1 ? (
                <Text type="secondary" className="!text-xs">
                    This turn made {captures.length} requests (initial + resumes). Compare them to spot
                    drift or a loop.
                </Text>
            ) : null}
            {captures.map((c, i) => (
                <Send key={c.requestId} capture={c} index={i} total={captures.length} />
            ))}
        </div>
    )
}

export default memo(ContextTab)
```

- [ ] **Step 2: Wire it into the shell**

In `TurnInspector.tsx`: import the tab + capture reads; compute the trigger id (the user message immediately before the assistant turn) and the captures for it; render `<ContextTab captures={captures} />` in the `context` branch.

Add imports:

```ts
import {capturesForTrigger} from "@agenta/playground"

import {sessionCapturesAtomFamily} from "../../state/turnCaptures"

import ContextTab from "./ContextTab"
```

Add derivations (after `message` is computed):

```ts
const captures = useAtomValue(sessionCapturesAtomFamily(target?.sessionId ?? ""))
const turnCaptures = useMemo(() => {
    if (!target) return []
    const list = allMessages[target.sessionId] ?? []
    const idx = list.findIndex((m) => m.id === target.assistantMessageId)
    // The trigger is the last user message at or before this assistant turn.
    let triggerId: string | null = null
    for (let i = idx; i >= 0; i--) {
        if (list[i]?.role === "user") {
            triggerId = list[i].id
            break
        }
    }
    return capturesForTrigger(captures, triggerId)
}, [target, allMessages, captures])
```

Replace the `context` placeholder with:

```tsx
{tab === "context" ? <ContextTab captures={turnCaptures} /> : null}
```

- [ ] **Step 3: Lint + typecheck**

Run (from `web`): `npx eslint --fix oss/src/components/AgentChatSlice/components/TurnInspector/ContextTab.tsx oss/src/components/AgentChatSlice/components/TurnInspector/TurnInspector.tsx`
Run (from `web/oss`): `npx tsc --noEmit 2>&1 | grep -E "ContextTab|TurnInspector"`
Expected: clean.

- [ ] **Step 4: Manual verification**

Local deploy. Run a turn that triggers a HITL approval (so it makes ≥2 requests), approve it, then open the inspector → Context tab. Confirm: multiple "Request k of N" cards; each shows the instructions/model and the exact messages sent for that send; you can eyeball drift between sends.

- [ ] **Step 5: Commit**

```bash
git add web/oss/src/components/AgentChatSlice/components/TurnInspector/ContextTab.tsx web/oss/src/components/AgentChatSlice/components/TurnInspector/TurnInspector.tsx
git commit --no-verify -m "feat(frontend): turn-inspector Context tab (config + messages sent)"
```

---

## Phase 3 — Raw tab

### Task 9: Raw tab (literal payloads + copy)

**Files:**
- Create: `web/oss/src/components/AgentChatSlice/components/TurnInspector/RawTab.tsx`
- Modify: `web/oss/src/components/AgentChatSlice/components/TurnInspector/TurnInspector.tsx` (wire the `raw` branch)

- [ ] **Step 1: Write `RawTab`**

```tsx
import {memo} from "react"

import {type TurnRequestCapture} from "@agenta/playground"
import {App, Button, Typography} from "antd"

const {Text} = Typography

/** One capture's literal outgoing request body, copyable for repro / bug reports. */
const RawTab = ({captures}: {captures: TurnRequestCapture[]}) => {
    const {message} = App.useApp()
    if (captures.length === 0) {
        return <div className="p-4 text-xs text-colorTextTertiary">No capture for this turn.</div>
    }
    return (
        <div className="flex flex-col gap-3 p-4">
            {captures.map((c, i) => {
                const body = {
                    session_id: c.sessionId,
                    references: c.references,
                    data: {inputs: {messages: c.messages}, parameters: c.parameters},
                }
                const json = JSON.stringify(body, null, 2)
                return (
                    <div key={c.requestId} className="flex flex-col gap-1.5 rounded-lg border border-solid border-colorBorderSecondary p-3">
                        <div className="flex items-center gap-2">
                            <Text className="!text-xs !font-medium">Request {i + 1} of {captures.length}</Text>
                            <Text type="secondary" className="!text-[11px] font-mono truncate">{c.invocationUrl}</Text>
                            <Button
                                type="link"
                                className="!ml-auto !px-0 !text-xs"
                                onClick={() => {
                                    navigator.clipboard?.writeText(json)
                                    message.success("Request body copied")
                                }}
                            >
                                Copy JSON
                            </Button>
                        </div>
                        <pre className="m-0 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-colorFillTertiary px-2 py-1.5 font-mono text-[11px] leading-snug text-colorTextSecondary">
                            {json}
                        </pre>
                    </div>
                )
            })}
        </div>
    )
}

export default memo(RawTab)
```

- [ ] **Step 2: Wire it into the shell**

In `TurnInspector.tsx`, import `RawTab` and replace the `raw` placeholder:

```tsx
{tab === "raw" ? <RawTab captures={turnCaptures} /> : null}
```

- [ ] **Step 3: Lint + typecheck**

Run (from `web`): `npx eslint --fix oss/src/components/AgentChatSlice/components/TurnInspector/RawTab.tsx oss/src/components/AgentChatSlice/components/TurnInspector/TurnInspector.tsx`
Run (from `web/oss`): `npx tsc --noEmit 2>&1 | grep -E "RawTab|TurnInspector"`
Expected: clean.

- [ ] **Step 4: Manual verification**

Local deploy. Open the inspector → Raw tab. Confirm the literal request body renders per send and "Copy JSON" copies it (paste elsewhere to verify). Dark mode: toggle the theme, confirm tokens (bg/text) read correctly in both.

- [ ] **Step 5: Commit**

```bash
git add web/oss/src/components/AgentChatSlice/components/TurnInspector/RawTab.tsx web/oss/src/components/AgentChatSlice/components/TurnInspector/TurnInspector.tsx
git commit --no-verify -m "feat(frontend): turn-inspector Raw tab (copyable payloads)"
```

---

## Final verification

- [ ] From `web/packages/agenta-playground`: `npx vitest run tests/unit/turnCapture.test.ts` — all pass.
- [ ] From `web/oss`: `npx tsc --noEmit 2>&1 | grep -E "TurnInspector|TimelineTab|ContextTab|RawTab|turnCaptures|turnInspector|AgentChatPanel"` — no new errors.
- [ ] From `web`: `npx eslint oss/src/components/AgentChatSlice/components/TurnInspector oss/src/components/AgentChatSlice/state/turnInspector.ts oss/src/components/AgentChatSlice/state/turnCaptures.ts` — clean.
- [ ] Manual: Build mode shows "Inspect turn"; Chat mode hides it; Timeline/Context/Raw all render; a HITL turn shows multiple captures; the inline step log is unchanged; the trace drawer is untouched.
