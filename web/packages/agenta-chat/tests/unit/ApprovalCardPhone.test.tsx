/**
 * The change card on a phone (task 50.2, M05): Deny and Approve are drawn 44 px high, "View full
 * diff" opens the whole diff full screen with a back arrow to the chat, and a row of a grouped
 * card opens its detail full screen. The desktop keeps the diff and the rows in place.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const screen = vi.hoisted(() => ({phone: true}))
vi.mock("@agenta/ui/phone", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/ui/phone")>()),
    useIsPhone: () => screen.phone,
}))
vi.mock("../../src/hooks/useAlwaysAllowTool", () => ({
    useAlwaysAllowTool: () => ({
        infoFor: () => ({eligible: false, alreadyAllowed: false}),
        grantMany: (toolNames: string[]) => toolNames,
    }),
}))
vi.mock("../../src/hooks/useChangeVersions", () => ({
    useChangeVersions: (base?: {version?: number}) => ({
        baseVersion: base?.version,
        latestVersion: undefined,
    }),
}))

const {ApprovalCard} = await import("../../src/components/ApprovalCard")
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const LONG_DIFF = [
    "--- old",
    "+++ new",
    "@@ -1,14 +1,14 @@",
    " ## Urgency",
    "-A bug is medium unless money is involved.",
    "+A bug is medium unless money is involved or 3 or more customers report it in a week.",
    ...Array.from({length: 11}, (_, index) => ` Line ${index + 1}`),
    "-Old closing line",
    "+New closing line",
].join("\n")

const instructionsCall = {
    approvalId: "a1",
    toolName: "edit_agent_config",
    input: {agent: "Support triage", base_revision_id: "rev-4", operations: []},
    changePreview: {
        applies: true,
        base: {id: "rev-4", version: "4"},
        operations: [{index: 0, applies: true}],
        changes: [
            {
                path: ["parameters", "agent", "instructions", "agents_md"],
                operation_indexes: [0],
                kind: "changed",
                diff: LONG_DIFF,
            },
        ],
    },
}

const modelCall = (id: string, value: string) => ({
    approvalId: id,
    toolName: "edit_agent_config",
    input: {agent: "Support triage", base_revision_id: "rev-4", operations: []},
    changePreview: {
        applies: true,
        base: {id: "rev-4", version: "4"},
        operations: [{index: 0, applies: true}],
        changes: [
            {
                path: ["parameters", "agent", "llm", "model"],
                operation_indexes: [0],
                kind: "changed",
                old: "claude-sonnet-5.5",
                new: value,
            },
        ],
    },
})

let host: HTMLDivElement
let root: Root
beforeEach(() => {
    screen.phone = true
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const render = async (approvals: unknown[]) => {
    await act(async () => {
        root.render(
            <ApprovalCard
                approvals={approvals as never}
                onRespond={() => undefined}
                onApproveAll={() => undefined}
                onDenyAll={() => undefined}
            />,
        )
    })
}
const click = async (element: Element | null | undefined) => {
    expect(element).toBeTruthy()
    await act(async () => {
        ;(element as HTMLElement).click()
    })
}
const buttonNamed = (text: string) =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text))
const detail = () => document.querySelector('[data-testid="change-phone-detail"]')

describe("the change card on a phone", () => {
    it("draws Deny and Approve 44 px high", async () => {
        await render([instructionsCall])
        expect(buttonNamed("Deny")?.className).toContain("h-11")
        expect(buttonNamed("Approve")?.className).toContain("h-11")
    })

    it("opens the whole diff full screen with a back arrow to the chat", async () => {
        await render([instructionsCall])
        const inlineRows = host.querySelector('[data-testid="change-diff"]')!.children.length
        await click(host.querySelector('[data-testid="change-full-diff"]'))
        const screenEl = detail()
        expect(screenEl?.querySelector("h1")?.textContent).toBe("Instructions › AGENTS.md")
        const full = screenEl?.querySelector('[data-testid="change-diff-full"]')
        expect(full?.textContent).toContain("Line 11")
        expect(full?.textContent).toContain("New closing line")
        // The card keeps its short diff under the screen.
        expect(host.querySelector('[data-testid="change-diff"]')!.children.length).toBe(inlineRows)
        await click(screenEl?.querySelector('[aria-label="Back to Chat"]'))
        expect(detail()).toBeNull()
    })

    it("opens a row of a grouped card full screen", async () => {
        await render([modelCall("a1", "claude-opus-5.5"), modelCall("a2", "gpt-6")])
        expect(buttonNamed("Approve all")?.className).toContain("h-11")
        const row = host.querySelector('[data-testid="change-block-row"] button')
        expect(row?.className).toContain("min-h-11")
        await click(row)
        expect(detail()?.textContent).toContain("claude-opus-5.5")
        expect(row?.getAttribute("aria-expanded")).toBeNull()
    })
})

describe("the change card on a desktop", () => {
    it("opens the whole diff in place and the rows in place", async () => {
        screen.phone = false
        await render([instructionsCall])
        expect(buttonNamed("Approve")?.className).not.toContain("h-11")
        await click(host.querySelector('[data-testid="change-full-diff"]'))
        expect(detail()).toBeNull()
        expect(host.querySelector('[data-testid="change-diff"]')?.textContent).toContain("Line 11")
    })
})
