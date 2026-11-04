// @vitest-environment jsdom
/**
 * The test set menu button and its two confirm dialogs, rendered from plain props: which items
 * each mode offers, the wording for one or many drafts, the chat variant, and the saving state.
 */
import {act} from "react"

import type {TestsetMenuModel} from "@agenta/playground-ui/hooks"
import {TestsetMenu} from "@agenta/playground-ui/panels/runs"
import {KeepDraftRowsDialog, UnsavedTestsetDialog} from "@agenta/playground-ui/panels/testsets"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {button, click, settle, stubResizeObserver} from "../support/playgroundHarness"

let root: Root
let host: HTMLDivElement

const model = (overrides: Partial<TestsetMenuModel> = {}): TestsetMenuModel => ({
    loadableId: "testset:workflow:rev-1",
    visible: true,
    label: "Test set",
    isConnected: false,
    hasLocalChanges: false,
    hasSuccessfulResults: false,
    isChat: false,
    connectedRevisionId: null,
    connectedTestsetId: null,
    dialog: null,
    saving: false,
    connect: vi.fn(),
    sync: vi.fn(),
    manage: vi.fn(),
    change: vi.fn(),
    disconnect: vi.fn(),
    close: vi.fn(),
    confirmLoad: vi.fn(),
    confirmEdit: vi.fn(),
    confirmKeepDrafts: vi.fn(),
    resolveUnsaved: vi.fn(),
    syncSubmit: vi.fn(),
    canSyncSubmit: vi.fn(),
    ...overrides,
})

const render = async (node: React.ReactNode) => {
    act(() => root.render(node))
    await settle()
}
const openMenu = async () => {
    const trigger = host.querySelector<HTMLButtonElement>("button")!
    await act(async () => {
        trigger.dispatchEvent(
            new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
        )
    })
    await settle()
}
const items = () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) => ({
        label: item.textContent,
        disabled: item.hasAttribute("data-disabled"),
    }))
const alert = () => document.querySelector<HTMLElement>('[role="alertdialog"]')!

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
    stubResizeObserver()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("The test set menu", () => {
    it("Shows nothing before the playground has rows", async () => {
        await render(<TestsetMenu model={model({visible: false})} />)

        expect(host.textContent).toBe("")
    })

    it("Local mode offers Connect test set", async () => {
        const local = model()
        await render(<TestsetMenu model={local} />)
        expect(host.textContent).toContain("Test set")

        await openMenu()

        expect(items()).toEqual([{label: "Connect test set", disabled: false}])
        await act(async () => document.querySelector<HTMLElement>('[role="menuitem"]')!.click())
        expect(local.connect).toHaveBeenCalled()
    })

    it("Connected mode offers sync, manage, change and disconnect", async () => {
        await render(
            <TestsetMenu
                model={model({isConnected: true, hasLocalChanges: true, label: "Capitals (v2)"})}
            />,
        )
        expect(host.textContent).toContain("Capitals (v2)")

        await openMenu()

        expect(items()).toEqual([
            {label: "Sync changes", disabled: false},
            {label: "Manage test cases", disabled: false},
            {label: "Change test set", disabled: false},
            {label: "Disconnect", disabled: false},
        ])
    })

    it("Sync changes is disabled without edits", async () => {
        await render(<TestsetMenu model={model({isConnected: true})} />)

        await openMenu()

        expect(items()[0]).toEqual({label: "Sync changes", disabled: true})
    })

    it("Add to test set shows only with a handler, and waits for a run", async () => {
        await render(<TestsetMenu model={model()} onAddToTestset={vi.fn()} />)

        await openMenu()

        expect(items()).toEqual([
            {label: "Connect test set", disabled: false},
            {label: "Add to test set", disabled: true},
        ])
    })
})

describe("The keep-draft dialog", () => {
    const keepDraft = (props: Partial<Parameters<typeof KeepDraftRowsDialog>[0]> = {}) => {
        const handlers = {onKeep: vi.fn(), onDiscard: vi.fn(), onCancel: vi.fn()}
        return {
            handlers,
            node: (
                <KeepDraftRowsDialog
                    draftCount={1}
                    testsetName="Capitals"
                    chat={false}
                    {...handlers}
                    {...props}
                />
            ),
        }
    }

    it("The keep-draft dialog counts one or many drafts", async () => {
        await render(keepDraft().node)
        expect(alert().textContent).toContain("Keep your draft test cases?")
        expect(alert().textContent).toContain("You have 1 draft test case in the playground.")
        expect(alert().textContent).toContain("You can keep it and load Capitals alongside.")

        await render(keepDraft({draftCount: 3, testsetName: null}).node)
        expect(alert().textContent).toContain("You have 3 draft test cases in the playground.")
        expect(alert().textContent).toContain("You can keep them and load the test set alongside.")
    })

    it("Keep and load and Discard drafts answer the dialog", async () => {
        const {node, handlers} = keepDraft()
        await render(node)

        await click(alert(), "Keep and load")
        await click(alert(), "Discard drafts")

        expect(handlers.onKeep).toHaveBeenCalledTimes(1)
        expect(handlers.onDiscard).toHaveBeenCalledTimes(1)
    })

    it("The chat variant offers only Load and replace", async () => {
        const {node, handlers} = keepDraft({chat: true})
        await render(node)

        expect(alert().textContent).toContain("Replace the current conversation?")
        expect(alert().textContent).toContain(
            "Loading Capitals replaces the conversation in the playground.",
        )
        expect(button(alert(), "Keep and load")).toBeUndefined()
        await click(alert(), "Load and replace")
        expect(handlers.onDiscard).toHaveBeenCalled()
    })
})

describe("The unsaved test set dialog", () => {
    const unsaved = (props: Partial<Parameters<typeof UnsavedTestsetDialog>[0]> = {}) => {
        const handlers = {onSave: vi.fn(), onDiscard: vi.fn(), onCancel: vi.fn()}
        return {
            handlers,
            node: (
                <UnsavedTestsetDialog intent="disconnect" saving={false} {...handlers} {...props} />
            ),
        }
    }

    it("Disconnect and change name their own actions", async () => {
        await render(unsaved().node)
        expect(alert().textContent).toContain("Save changes?")
        expect(button(alert(), "Save & disconnect")).toBeDefined()
        expect(button(alert(), "Discard & disconnect")).toBeDefined()

        await render(unsaved({intent: "change"}).node)
        expect(alert().textContent).toContain("Load different test set?")
        expect(button(alert(), "Save & load")).toBeDefined()
        expect(button(alert(), "Discard & Load")).toBeDefined()
    })

    it("Saving disables every button and Escape", async () => {
        const {node, handlers} = unsaved({saving: true})
        await render(node)

        for (const label of ["Cancel", "Discard & disconnect", "Save & disconnect"]) {
            expect(button(alert(), label)?.disabled, label).toBe(true)
        }
        await act(async () => {
            alert().dispatchEvent(
                new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}),
            )
        })
        await settle()
        expect(handlers.onCancel).not.toHaveBeenCalled()
        expect(alert()).not.toBeNull()
    })
})
