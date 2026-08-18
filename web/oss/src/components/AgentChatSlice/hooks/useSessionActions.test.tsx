/**
 * The rename dialog's keyboard contract.
 *
 * "Rename session" is a modal with a single text field, so Enter has to confirm it. It used to
 * do nothing, leaving the mouse as the only way to submit (#5951).
 *
 * Rendered with `react-dom/client` rather than a testing library: the repo has no
 * `@testing-library/react`, and antd's `modal.confirm` renders into `document.body` anyway, so
 * the assertions read the real DOM either way.
 */
import {act} from "react"

import {App, Modal} from "antd"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const setSessionHeader = vi.fn(async () => true)
const invalidateSessionListQueries = vi.fn()

vi.mock("@agenta/entities/session", () => ({
    archiveSessionRemote: vi.fn(async () => true),
    deleteSessionRemote: vi.fn(async () => true),
    invalidateSessionListQueries: () => invalidateSessionListQueries(),
    setSessionHeader: (...args: unknown[]) => setSessionHeader(...(args as [])),
    unarchiveSessionRemote: vi.fn(async () => true),
}))

vi.mock("@agenta/sessions/state", () => ({
    pinnedSessionIdsAtom: {read: () => [] as string[]},
    toggleSessionPinAtom: {read: () => null, write: () => undefined},
}))

vi.mock("@tanstack/react-query", () => ({
    useQueryClient: () => ({invalidateQueries: vi.fn()}),
}))

vi.mock("jotai", () => ({
    // `projectIdAtom` is the only scalar read; the other is the pinned-ids list.
    useAtomValue: (atom: {debugLabel?: string}) =>
        atom?.debugLabel === "projectId" ? "project-1" : ([] as string[]),
    useSetAtom: () => vi.fn(),
    // Only `sessionHistoryAtomFamily` / `archivedSessionHistoryAtomFamily` are read, and both
    // are empty here so the hook takes the remote (`setSessionHeader`) path.
    useStore: () => ({get: () => [], set: vi.fn()}),
}))

vi.mock("@/oss/state/project", () => ({projectIdAtom: {debugLabel: "projectId"}}))

vi.mock("../state/sessions", () => ({
    archivedSessionHistoryAtomFamily: () => ({}),
    archiveSessionAtomFamily: () => ({}),
    deleteSessionAtomFamily: () => ({}),
    renameSessionAtomFamily: () => ({}),
    sessionHistoryAtomFamily: () => ({}),
    unarchiveSessionAtomFamily: () => ({}),
}))

const {useSessionActions} = await import("./useSessionActions")

let root: Root | null = null
let container: HTMLDivElement | null = null

/** Mounts the hook and hands back its `rename`, with antd's `App` context in place. */
const mountRename = async () => {
    let rename:
        | ((target: {sessionId: string; appId: string | null; name?: string}) => void)
        | null = null

    const Probe = () => {
        rename = useSessionActions().rename
        return null
    }

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
        root!.render(
            <App>
                <Probe />
            </App>,
        )
    })

    return rename!
}

const renameInput = () =>
    document.querySelector<HTMLInputElement>('input[aria-label="Session name"]')

/** antd renders the confirm buttons as `.ant-btn-primary` (Rename) and a default one (Cancel). */
const renameButton = () => document.querySelector<HTMLButtonElement>(".ant-btn-primary")

const pressEnter = async (input: HTMLInputElement) => {
    await act(async () => {
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
        // rc-input locks Enter between keydown and keyup, so a keydown-only helper would
        // silently no-op on the second press within a test.
        input.dispatchEvent(new KeyboardEvent("keyup", {key: "Enter", bubbles: true}))
    })
}

const type = async (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
    await act(async () => {
        setter?.call(input, value)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

describe("useSessionActions rename", () => {
    beforeEach(() => {
        // React only honours `act()` when the environment opts in.
        ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
        document.body.innerHTML = ""
        setSessionHeader.mockClear()
    })

    afterEach(async () => {
        // `modal.confirm` instances outlive their root: closing them is a separate
        // imperative call, so a test that leaves the dialog open (the blank-name cases)
        // would otherwise keep it registered in antd's global destroy registry.
        await act(async () => {
            Modal.destroyAll()
            root?.unmount()
        })
        root = null
        container?.remove()
        container = null
    })

    it("confirms on Enter with the edited name", async () => {
        const rename = await mountRename()
        await act(async () => {
            rename({sessionId: "session-1", appId: null, name: "Old name"})
        })

        const input = renameInput()
        expect(input).toBeTruthy()

        await type(input!, "  New name  ")
        await pressEnter(input!)

        expect(setSessionHeader).toHaveBeenCalledWith({
            sessionId: "session-1",
            projectId: "project-1",
            name: "New name",
        })
        // The dialog closes, exactly as it does when the Rename button is clicked.
        expect(renameInput()).toBeNull()
    })

    it("does not submit a blank name on Enter, and keeps the dialog open", async () => {
        const rename = await mountRename()
        await act(async () => {
            rename({sessionId: "session-1", appId: null, name: "Old name"})
        })

        const input = renameInput()
        await type(input!, "   ")
        await pressEnter(input!)

        expect(setSessionHeader).not.toHaveBeenCalled()
        // Nothing was renamed, so the dialog has to stay up for the name to be corrected.
        expect(renameInput()).toBeTruthy()
        expect(renameButton()?.disabled).toBe(true)

        // And it recovers: typing a name re-enables Rename, and Enter then submits.
        await type(renameInput()!, "New name")
        expect(renameButton()?.disabled).toBe(false)
        await pressEnter(input!)

        expect(setSessionHeader).toHaveBeenCalledWith({
            sessionId: "session-1",
            projectId: "project-1",
            name: "New name",
        })
        expect(renameInput()).toBeNull()
    })

    it("does not submit a blank name on the Rename button either", async () => {
        const rename = await mountRename()
        await act(async () => {
            rename({sessionId: "session-1", appId: null, name: "Old name"})
        })

        await type(renameInput()!, "   ")
        await act(async () => renameButton()?.click())

        expect(setSessionHeader).not.toHaveBeenCalled()
        expect(renameInput()).toBeTruthy()
    })

    it("runs Enter through onOk, so the button shows the rename in flight", async () => {
        let settle: (() => void) | null = null
        setSessionHeader.mockImplementationOnce(
            () =>
                new Promise<boolean>((resolve) => {
                    settle = () => resolve(true)
                }),
        )

        const rename = await mountRename()
        await act(async () => {
            rename({sessionId: "session-1", appId: null, name: "Old name"})
        })

        const input = renameInput()
        await type(input!, "New name")
        await pressEnter(input!)

        // Same lifecycle as clicking Rename: the dialog stays up, showing progress.
        expect(renameInput()).toBeTruthy()
        expect(renameButton()?.classList.contains("ant-btn-loading")).toBe(true)

        await act(async () => {
            settle?.()
        })

        expect(renameInput()).toBeNull()
    })

    it("confirms on the Rename button with the edited name", async () => {
        const rename = await mountRename()
        await act(async () => {
            rename({sessionId: "session-1", appId: null, name: "Old name"})
        })

        await type(renameInput()!, "  New name  ")
        await act(async () => renameButton()?.click())

        expect(setSessionHeader).toHaveBeenCalledWith({
            sessionId: "session-1",
            projectId: "project-1",
            name: "New name",
        })
        expect(renameInput()).toBeNull()
    })
})
