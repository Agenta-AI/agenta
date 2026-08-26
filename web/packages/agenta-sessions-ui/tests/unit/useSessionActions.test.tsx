/**
 * The rename dialog's keyboard contract.
 *
 * "Rename session" is a modal with a single text field, so Enter has to confirm it. It used to
 * do nothing, leaving the mouse as the only way to submit (#5951).
 *
 * Rendered with `react-dom/client` rather than a testing library: the repo has no
 * `@testing-library/react`, and the confirm portals into `document.body` anyway, so the
 * assertions read the real DOM either way.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const setSessionHeader = vi.fn(async () => true)

vi.mock("@agenta/entities/session", () => ({
    archiveSessionRemote: vi.fn(async () => true),
    deleteSessionRemote: vi.fn(async () => true),
    setSessionHeader: (...args: unknown[]) => setSessionHeader(...(args as [])),
    unarchiveSessionRemote: vi.fn(async () => true),
}))

vi.mock("@agenta/sessions/state", () => ({
    pinnedSessionIdsAtom: {debugLabel: "pinnedIds"},
    toggleSessionPinAtom: {debugLabel: "togglePin"},
}))

vi.mock("@agenta/shared/state", () => ({projectIdAtom: {debugLabel: "projectId"}}))

vi.mock("@tanstack/react-query", () => ({
    useQueryClient: () => ({invalidateQueries: vi.fn()}),
}))

vi.mock("jotai", () => ({
    // `projectIdAtom` is the only scalar read; the other is the pinned-ids list.
    useAtomValue: (atom: {debugLabel?: string}) =>
        atom?.debugLabel === "projectId" ? "project-1" : ([] as string[]),
    useSetAtom: () => vi.fn(),
}))

const {useSessionActions} = await import("../../src/useSessionActions")
const {default: AppMessageContext} = await import("@agenta/ui/app-message")

let root: Root | null = null
let container: HTMLDivElement | null = null

/** Mounts the hook alongside the confirm outlet the `modal` facade renders into. */
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
            <>
                <Probe />
                <AppMessageContext />
            </>,
        )
    })

    return rename!
}

const renameInput = () =>
    document.querySelector<HTMLInputElement>('input[aria-label="Session name"]')

/** The OK button carries the marker class the hook uses to reach it from Enter. */
const renameButton = () => document.querySelector<HTMLButtonElement>(".rename-session-ok")

/** The confirm's Cancel button, found by label — it carries no marker class. */
const dialogCancel = () =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find(
        (button) => button.textContent?.trim() === "Cancel",
    )

const pressEnter = async (input: HTMLInputElement) => {
    await act(async () => {
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
        // rc-input locks Enter between keydown and keyup, so a keydown-only helper would
        // silently no-op on the second press within a test.
        input.dispatchEvent(new KeyboardEvent("keyup", {key: "Enter", bubbles: true}))
    })
}

/** `onOk` is async, so closing the dialog lands a microtask after the click that started it. */
const flush = async () => {
    await act(async () => {})
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
        // The confirm store is module-global and outlives the root, so a test that deliberately
        // leaves the dialog open (the blank-name cases) would re-render it into the NEXT test's
        // outlet. antd had `Modal.destroyAll` for this; the facade has no equivalent, so the
        // leftovers are dismissed the way a user would.
        for (let i = 0; i < 5 && dialogCancel(); i += 1) {
            await act(async () => dialogCancel()?.click())
        }
        await act(async () => {
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
        expect(renameButton()?.dataset.loading).toBe("true")

        await act(async () => {
            settle?.()
        })
        await flush()

        expect(renameInput()).toBeNull()
    })

    it("confirms on the Rename button with the edited name", async () => {
        const rename = await mountRename()
        await act(async () => {
            rename({sessionId: "session-1", appId: null, name: "Old name"})
        })

        await type(renameInput()!, "  New name  ")
        await act(async () => renameButton()?.click())
        await flush()

        expect(setSessionHeader).toHaveBeenCalledWith({
            sessionId: "session-1",
            projectId: "project-1",
            name: "New name",
        })
        expect(renameInput()).toBeNull()
    })
})
