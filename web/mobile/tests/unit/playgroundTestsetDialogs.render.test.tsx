// @vitest-environment jsdom
/**
 * The test set menu button and the run pane's two confirm dialogs, rendered from a plain model:
 * which items each mode offers, the wording for one or many drafts, the chat variant, and the
 * saving state.
 */
import {act} from "react"

import type {TestsetMenuModel} from "@agenta/playground-ui/hooks"
import {TestsetMenu} from "@agenta/playground-ui/panels/runs"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PlaygroundTestsetMenu} from "@/features/playground/PlaygroundTestsetMenu"

import {button, click, settle, stubResizeObserver} from "../support/playgroundHarness"

// The run pane's menu draws its dialogs from the model; the cases hand it one.
const current = vi.hoisted(() => ({model: null as unknown}))
vi.mock("@agenta/playground-ui/hooks", async (original) => ({
    ...(await original<object>()),
    useTestsetMenuModel: () => current.model,
}))
vi.mock("next/router", () => ({useRouter: () => ({query: {}})}))
vi.mock("@/features/context/useProjectPermission", () => ({useProjectPermission: () => false}))

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

    it("Local mode offers Load test set", async () => {
        const local = model()
        await render(<TestsetMenu model={local} />)
        expect(host.textContent).toContain("Test set")

        await openMenu()

        expect(items()).toEqual([{label: "Load test set", disabled: false}])
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
            {label: "Load test set", disabled: false},
            {label: "Add to test set", disabled: true},
        ])
    })
})

type Dialog = NonNullable<TestsetMenuModel["dialog"]>
const withDialog = (dialog: Dialog, overrides: Partial<TestsetMenuModel> = {}) => {
    const menu = model({dialog, ...overrides})
    current.model = menu
    return menu
}
const keepDrafts = (overrides: Partial<Extract<Dialog, {kind: "keep-drafts"}>> = {}): Dialog => ({
    kind: "keep-drafts",
    draftCount: 1,
    testsetName: "Capitals",
    chat: false,
    payload: {} as never,
    ...overrides,
})

describe("The keep-draft dialog", () => {
    it("The keep-draft dialog counts one or many drafts", async () => {
        withDialog(keepDrafts())
        await render(<PlaygroundTestsetMenu />)
        expect(alert().textContent).toContain("Keep your draft test cases?")
        expect(alert().textContent).toContain("You have 1 draft test case in the playground.")
        expect(alert().textContent).toContain("You can keep it and load Capitals alongside.")

        withDialog(keepDrafts({draftCount: 3, testsetName: null}))
        await render(<PlaygroundTestsetMenu />)
        expect(alert().textContent).toContain("You have 3 draft test cases in the playground.")
        expect(alert().textContent).toContain("You can keep them and load the test set alongside.")
    })

    it("Keep and load and Discard drafts answer the dialog", async () => {
        const menu = withDialog(keepDrafts())
        await render(<PlaygroundTestsetMenu />)

        await click(alert(), "Keep and load")
        await click(alert(), "Discard drafts")

        expect(menu.confirmKeepDrafts).toHaveBeenNthCalledWith(1, true)
        expect(menu.confirmKeepDrafts).toHaveBeenNthCalledWith(2, false)
    })

    it("The chat variant offers only Load and replace", async () => {
        const menu = withDialog(keepDrafts({chat: true}))
        await render(<PlaygroundTestsetMenu />)

        expect(alert().textContent).toContain("Replace the current conversation?")
        expect(alert().textContent).toContain(
            "Loading Capitals replaces the conversation in the playground.",
        )
        expect(button(alert(), "Keep and load")).toBeUndefined()
        await click(alert(), "Load and replace")
        expect(menu.confirmKeepDrafts).toHaveBeenCalledWith(false)
    })
})

describe("The unsaved test set dialog", () => {
    it("Disconnect and change name their own actions", async () => {
        withDialog({kind: "unsaved", intent: "disconnect"})
        await render(<PlaygroundTestsetMenu />)
        expect(alert().textContent).toContain("Save changes?")
        expect(button(alert(), "Save & disconnect")).toBeDefined()
        expect(button(alert(), "Discard & disconnect")).toBeDefined()

        withDialog({kind: "unsaved", intent: "change"})
        await render(<PlaygroundTestsetMenu />)
        expect(alert().textContent).toContain("Load different test set?")
        expect(button(alert(), "Save & load")).toBeDefined()
        expect(button(alert(), "Discard & Load")).toBeDefined()
    })

    it("Saving disables every button and Escape", async () => {
        const menu = withDialog({kind: "unsaved", intent: "disconnect"}, {saving: true})
        await render(<PlaygroundTestsetMenu />)

        for (const label of ["Cancel", "Discard & disconnect", "Save & disconnect"]) {
            expect(button(alert(), label)?.disabled, label).toBe(true)
        }
        await act(async () => {
            alert().dispatchEvent(
                new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}),
            )
        })
        await settle()
        expect(menu.close).not.toHaveBeenCalled()
        expect(alert()).not.toBeNull()
    })
})
