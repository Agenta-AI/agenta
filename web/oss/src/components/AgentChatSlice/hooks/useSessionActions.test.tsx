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

import {App} from "antd"
import {createRoot} from "react-dom/client"
import {beforeEach, describe, expect, it, vi} from "vitest"

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

/** Mounts the hook and hands back its `rename`, with antd's `App` context in place. */
const mountRename = async () => {
    let rename:
        | ((target: {sessionId: string; appId: string | null; name?: string}) => void)
        | null = null

    const Probe = () => {
        rename = useSessionActions().rename
        return null
    }

    const host = document.createElement("div")
    document.body.appendChild(host)
    await act(async () => {
        createRoot(host).render(
            <App>
                <Probe />
            </App>,
        )
    })

    return rename!
}

const renameInput = () =>
    document.querySelector<HTMLInputElement>('input[aria-label="Session name"]')

const pressEnter = async (input: HTMLInputElement) => {
    await act(async () => {
        input.dispatchEvent(
            new KeyboardEvent("keydown", {key: "Enter", keyCode: 13, bubbles: true} as never),
        )
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

    it("keeps the dialog open when Enter is pressed on a blank name", async () => {
        const rename = await mountRename()
        await act(async () => {
            rename({sessionId: "session-1", appId: null, name: "Old name"})
        })

        const input = renameInput()
        await type(input!, "   ")
        await pressEnter(input!)

        expect(setSessionHeader).not.toHaveBeenCalled()
        expect(renameInput()).toBeTruthy()
    })
})
