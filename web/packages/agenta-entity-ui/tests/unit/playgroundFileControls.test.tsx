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
    const buckets = new Map<string, ReturnType<typeof atom<boolean>>>()
    return {
        useSessionFilesPane: (scope: string) => {
            if (!buckets.has(scope)) buckets.set(scope, atom(false))
            const [open, set] = useAtom(buckets.get(scope)!)
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

for (const scope of ["agent-first", "revision-drawer-chat-scope"]) {
    describe(`${scope} Settings discovery`, () => {
        for (const state of ["normal", "loading", "error", "empty", "capped"]) {
            it(`keeps a synchronized folder toggle after the total count in ${state}`, () => {
                fixture.drive.isLoading = state === "loading"
                fixture.drive.errored = state === "error"
                fixture.drive.fileCount = state === "empty" ? 0 : 12
                fixture.drive.fileCountCapped = state === "capped"
                const host = document.createElement("div")
                const root = createRoot(host)
                act(() =>
                    root.render(
                        <Provider store={createStore()}>
                            <StorageFilesHeader scope={scope} sessionId="session-1" />
                            <StorageFilesHeader scope={scope} sessionId="session-1" />
                        </Provider>,
                    ),
                )
                const buttons = [...host.querySelectorAll("button")]
                expect(buttons).toHaveLength(2)
                expect(buttons[0].disabled).toBe(false)
                act(() => buttons[0].click())
                expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "true"])
                act(() => buttons[1].click())
                expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual([
                    "false",
                    "false",
                ])
                if (state === "capped") expect(host.textContent).toContain("12+ files")
                if (state === "empty") expect(host.textContent).toContain("No files")
                if (state === "normal")
                    expect(host.querySelector('[data-tooltip="Total files"]')!.textContent).toBe(
                        "12 files",
                    )
                act(() => root.unmount())
            })
        }
    })
}
it("disables the no-conversation control and explains why", () => {
    const host = document.createElement("div")
    const root = createRoot(host)
    act(() => root.render(<StorageFilesHeader scope="no-session" />))
    expect(host.querySelector("button")!.disabled).toBe(true)
    expect(host.querySelector("button")!.title).toBe("Open a conversation to browse files.")
    act(() => root.unmount())
})
it("does not add a toggle to unrelated hosts", () => {
    const host = document.createElement("div")
    const root = createRoot(host)
    act(() => root.render(<StorageFilesHeader sessionId="session" />))
    expect(host.querySelector("button")).toBeNull()
    act(() => root.unmount())
})
