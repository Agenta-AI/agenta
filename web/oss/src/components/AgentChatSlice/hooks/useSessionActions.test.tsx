/**
 * Enter in the rename-session dialog must confirm, matching the Rename button.
 *
 * Rendered with `react-dom/client` rather than a testing library (the repo has no
 * `@testing-library/react`, per ApprovedContentManifest.test.tsx). `modal.confirm` portals
 * into `document.body`, so assertions read the real DOM. Only the network boundary is stubbed.
 */
import {act} from "react"

import {App, Modal} from "antd"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useSessionActions, type SessionActionTarget} from "./useSessionActions"

const {setSessionHeader} = vi.hoisted(() => ({
    setSessionHeader: vi.fn(async () => true),
}))

vi.mock("@agenta/entities/session", () => ({
    setSessionHeader,
    invalidateSessionListQueries: vi.fn(),
    archiveSessionRemote: vi.fn(),
    deleteSessionRemote: vi.fn(),
    unarchiveSessionRemote: vi.fn(),
}))

vi.mock("@agenta/sessions/state", () => ({
    pinnedSessionIdsAtom: {init: []},
    toggleSessionPinAtom: {},
}))

vi.mock("@agenta/shared/hooks", () => ({
    useAltKey: () => "Alt+",
}))

vi.mock("@/oss/state/project", () => ({
    projectIdAtom: {init: "project-1"},
}))

vi.mock("../state/sessions", () => {
    const list = {init: []}
    const write = {}
    return {
        archivedSessionHistoryAtomFamily: () => list,
        sessionHistoryAtomFamily: () => list,
        archiveSessionAtomFamily: () => write,
        deleteSessionAtomFamily: () => write,
        renameSessionAtomFamily: () => write,
        unarchiveSessionAtomFamily: () => write,
    }
})

vi.mock("@tanstack/react-query", () => ({
    useQueryClient: () => ({invalidateQueries: vi.fn()}),
}))

vi.mock("jotai", () => ({
    useAtomValue: (target: {init?: unknown}) => target?.init ?? "project-1",
    useSetAtom: () => () => undefined,
    useStore: () => ({get: () => [], set: () => undefined}),
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const originalGetComputedStyle = window.getComputedStyle.bind(window)

const target: SessionActionTarget = {
    sessionId: "session-1",
    appId: null,
    name: "Untitled session",
}

let root: Root | null = null
let host: HTMLDivElement | null = null
let rename: ((next: SessionActionTarget) => void) | null = null

const renameInput = () =>
    document.querySelector<HTMLInputElement>('input[aria-label="Session name"]')

const requireRenameInput = () => {
    const input = renameInput()
    if (!input) throw new Error("expected the rename-session input")
    return input
}

const renameButton = () =>
    document.querySelector<HTMLButtonElement>(".rename-session-ok") ??
    Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent === "Rename",
    )

const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set

const setInputValue = (input: HTMLInputElement, value: string) => {
    nativeValueSetter?.call(input, value)
    input.dispatchEvent(new InputEvent("input", {bubbles: true, composed: true}))
    input.dispatchEvent(new Event("change", {bubbles: true}))
}

const pressEnter = (input: HTMLInputElement) => {
    input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
    input.dispatchEvent(new KeyboardEvent("keyup", {key: "Enter", bubbles: true}))
}

const Probe = () => {
    rename = useSessionActions().rename
    return null
}

const mountRename = async () => {
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)

    await act(async () => {
        root?.render(
            <App>
                <Probe />
            </App>,
        )
    })

    await act(async () => {
        rename?.(target)
    })
}

beforeEach(() => {
    window.getComputedStyle = ((elt: Element) =>
        originalGetComputedStyle(elt)) as typeof window.getComputedStyle
    setSessionHeader.mockClear()
    setSessionHeader.mockResolvedValue(true)
})

afterEach(async () => {
    await act(async () => {
        Modal.destroyAll()
        root?.unmount()
    })
    window.getComputedStyle = originalGetComputedStyle
    root = null
    host?.remove()
    host = null
    rename = null
    document.body.innerHTML = ""
})

describe("useSessionActions rename dialog", () => {
    it("confirms on Enter with a trimmed name and closes", async () => {
        await mountRename()
        const input = requireRenameInput()

        await act(async () => {
            setInputValue(input, "  Pricing agent QA  ")
        })
        await act(async () => {
            pressEnter(input)
        })

        await vi.waitFor(() => {
            expect(setSessionHeader).toHaveBeenCalledWith({
                sessionId: "session-1",
                projectId: "project-1",
                name: "Pricing agent QA",
            })
        })
        await vi.waitFor(() => {
            expect(renameInput()).toBeNull()
        })
    })

    it("keeps the dialog open when Enter is pressed on a blank name", async () => {
        await mountRename()
        const input = requireRenameInput()

        await act(async () => {
            setInputValue(input, "   ")
        })
        await act(async () => {
            pressEnter(input)
        })

        expect(setSessionHeader).not.toHaveBeenCalled()
        expect(renameInput()).toBeTruthy()
        expect(renameButton()?.disabled).toBe(true)

        await act(async () => {
            setInputValue(requireRenameInput(), "Pricing agent QA")
        })
        await act(async () => {
            pressEnter(requireRenameInput())
        })

        await vi.waitFor(() => {
            expect(setSessionHeader).toHaveBeenCalledWith({
                sessionId: "session-1",
                projectId: "project-1",
                name: "Pricing agent QA",
            })
        })
        await vi.waitFor(() => {
            expect(renameInput()).toBeNull()
        })
    })

    it("keeps the dialog open when Rename is clicked on a blank name", async () => {
        await mountRename()
        const input = requireRenameInput()

        await act(async () => {
            setInputValue(input, "   ")
        })

        await act(async () => {
            renameButton()?.click()
        })

        expect(setSessionHeader).not.toHaveBeenCalled()
        expect(renameInput()).toBeTruthy()
    })
})
