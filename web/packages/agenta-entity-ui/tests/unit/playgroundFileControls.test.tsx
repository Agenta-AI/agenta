import {act} from "react"
import {createRoot} from "react-dom/client"

import {Provider, createStore} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

const fixture = vi.hoisted(() => ({
    drive: {
        isLoading: false,
        errored: false,
        partialErrored: false,
        isFetching: false,
        fileCount: 12,
        fileCountCapped: false,
    },
}))
vi.mock("@agenta/entities/drive", () => ({useConfigDrive: () => fixture}))
vi.mock("../../src/drive/DriveFileRow", () => ({
    DriveWarningBadge: ({children}: {children: React.ReactNode}) => children,
}))
vi.mock("../../src/drive/SessionFilesPane", async () => {
    const {atom, useAtom} = await import("jotai")
    const openAtom = atom(false)
    return {
        useSessionFilesPane: () => {
            const [open, set] = useAtom(openAtom)
            return {open, toggle: () => set(!open)}
        },
    }
})
vi.mock("@agenta/ui/shortcuts", () => ({ShortcutKeys: () => null}))
vi.mock("@agenta/ui/ui", () => ({
    Button: ({
        children,
        variant: _variant,
        size: _size,
        ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {variant?: string; size?: string}) => (
        <button {...props}>{children}</button>
    ),
    SimpleTooltip: ({children, title}: {children: React.ReactNode; title: React.ReactNode}) => (
        <span data-tooltip={typeof title === "string" ? title : undefined}>{children}</span>
    ),
    SkeletonBlock: () => <span data-loading />,
}))
import StorageFilesHeader from "../../src/drive/StorageFilesHeader"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

beforeEach(() =>
    Object.assign(fixture.drive, {
        isLoading: false,
        errored: false,
        partialErrored: false,
        isFetching: false,
        fileCount: 12,
        fileCountCapped: false,
    }),
)

function render(ui: React.ReactNode) {
    const host = document.createElement("div")
    const root = createRoot(host)
    act(() => root.render(<Provider store={createStore()}>{ui}</Provider>))
    return {host, unmount: () => act(() => root.unmount())}
}

describe("StorageFilesHeader files toggle", () => {
    for (const state of ["loaded", "loading", "error"] as const) {
        it(`flips the pane while the drive is ${state}`, () => {
            fixture.drive.isLoading = state === "loading"
            fixture.drive.errored = state === "error"
            const {host, unmount} = render(
                <StorageFilesHeader scope="agent-first" sessionId="session-1" />,
            )
            const button = host.querySelector("button")!
            expect(button.disabled).toBe(false)
            act(() => button.click())
            expect(button.getAttribute("aria-pressed")).toBe("true")
            act(() => button.click())
            expect(button.getAttribute("aria-pressed")).toBe("false")
            unmount()
        })
    }

    it("is disabled without a conversation and says why", () => {
        const {host, unmount} = render(<StorageFilesHeader scope="agent-first" />)
        expect(host.querySelector("button")!.disabled).toBe(true)
        expect(
            host.querySelector('[data-tooltip="Open a conversation to browse files."]'),
        ).not.toBeNull()
        unmount()
    })

    it("does not render without a scope", () => {
        const {host, unmount} = render(<StorageFilesHeader sessionId="session" />)
        expect(host.querySelector("button")).toBeNull()
        unmount()
    })
})
