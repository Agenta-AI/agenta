// @vitest-environment jsdom
import {useEffect, useState} from "react"

import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {
    BottomSheet,
    BottomSheetMenu,
    PhonePrimaryAction,
    PhoneScreenHeader,
    SidebarSheet,
    useIsPhone,
} from "../../src/phone"
import {
    defineView,
    PhoneViewChrome,
    useViewForm,
    useViewStack,
    useViewTitle,
    ViewStackHost,
    type ViewDef,
    type ViewProps,
} from "../../src/view-stack"

afterEach(cleanup)

const AGENT = {kind: "agent_draft", revisionId: "rev-1"} as const

const readOnlySeen: (boolean | undefined)[] = []

const FormBody = ({params, readOnly}: ViewProps<{name: string}>) => {
    const [value, setValue] = useState("")
    useViewTitle(params.name)
    useViewForm({
        dirty: value !== "",
        valid: true,
        save: async () => true,
        leaveDescription: "leave",
    })
    readOnlySeen.push(readOnly)
    return readOnly ? (
        <p>{`read ${params.name}`}</p>
    ) : (
        <input aria-label="field" value={value} onChange={(e) => setValue(e.target.value)} />
    )
}

const editableView = defineView<{name: string}>({
    id: "test.editable",
    apply: "on_save",
    Component: FormBody,
})
const readOnlyView = defineView<{name: string}>({
    id: "test.readOnly",
    apply: "on_save",
    readOnlyOnPhone: true,
    Component: FormBody,
})

const OpenOnMount = <P,>({view, params}: {view: ViewDef<P>; params: P}) => {
    const stack = useViewStack()
    useEffect(() => {
        void stack.open(view, params, AGENT)
        // Open once, like a row tap.
    }, [])
    return <p>root</p>
}

const renderStack = (view: ViewDef<{name: string}>, phone: boolean) =>
    render(
        <ViewStackHost chrome={PhoneViewChrome} rootTitle="Configuration" phone={phone}>
            <OpenOnMount view={view} params={{name: "AGENTS.md"}} />
        </ViewStackHost>,
    )

describe("PhoneViewChrome", () => {
    it("shows the back arrow to the screen before, with its name, and the view's title", async () => {
        renderStack(editableView, true)
        const back = await screen.findByRole("button", {name: "Back to Configuration"})
        expect(back.textContent).toBe("Configuration")
        expect(screen.getByRole("heading", {name: "AGENTS.md"})).toBeTruthy()
        // No desktop controls on a phone.
        expect(screen.queryByRole("button", {name: /widen/i})).toBeNull()
        expect(screen.queryByRole("button", {name: "Close"})).toBeNull()
    })

    it("draws Cancel and Save 44 px high for an editable view", async () => {
        renderStack(editableView, true)
        const save = await screen.findByRole("button", {name: "Save"})
        expect(save.className).toContain("h-11")
        expect(screen.getByRole("button", {name: "Cancel"}).className).toContain("h-11")
    })

    it("the back arrow goes back to the root", async () => {
        renderStack(editableView, true)
        fireEvent.click(await screen.findByRole("button", {name: "Back to Configuration"}))
        await waitFor(() => expect(screen.queryByTestId("phone-view-chrome")).toBeNull())
        expect(screen.getByText("root")).toBeTruthy()
    })
})

describe("readOnly input", () => {
    it("a phone container passes readOnly to a view marked readOnlyOnPhone, and draws no action row", async () => {
        readOnlySeen.length = 0
        renderStack(readOnlyView, true)
        expect(await screen.findByText("read AGENTS.md")).toBeTruthy()
        expect(readOnlySeen.at(-1)).toBe(true)
        expect(screen.queryByRole("button", {name: "Save"})).toBeNull()
        expect(screen.queryByRole("button", {name: "Cancel"})).toBeNull()
        expect(screen.queryByText(/computer/i)).toBeNull()
    })

    it("the same view is editable outside a phone container", async () => {
        readOnlySeen.length = 0
        renderStack(readOnlyView, false)
        expect(await screen.findByRole("textbox", {name: "field"})).toBeTruthy()
        expect(readOnlySeen.at(-1)).toBeUndefined()
        expect(screen.getByRole("button", {name: "Save"})).toBeTruthy()
    })

    it("a view without readOnlyOnPhone stays editable on a phone", async () => {
        readOnlySeen.length = 0
        renderStack(editableView, true)
        expect(await screen.findByRole("textbox", {name: "field"})).toBeTruthy()
        expect(readOnlySeen.at(-1)).toBeUndefined()
    })
})

describe("PhoneScreenHeader", () => {
    it("reads Back without a name, and has a 44 px hit area", () => {
        const onBack = vi.fn()
        render(<PhoneScreenHeader title="Files" onBack={onBack} />)
        const back = screen.getByRole("button", {name: "Back"})
        expect(back.className).toContain("h-11")
        expect(back.className).toContain("min-w-11")
        fireEvent.click(back)
        expect(onBack).toHaveBeenCalledOnce()
    })

    it("has no back arrow without onBack", () => {
        render(<PhoneScreenHeader title="Files" />)
        expect(screen.queryByRole("button")).toBeNull()
    })
})

describe("BottomSheetMenu", () => {
    const Menu = ({onPick}: {onPick: (key: string) => void}) => {
        const [open, setOpen] = useState(true)
        return (
            <>
                <p>{open ? "open" : "closed"}</p>
                <BottomSheetMenu
                    open={open}
                    onOpenChange={setOpen}
                    title="Add automation"
                    items={[
                        {
                            key: "app",
                            label: "App trigger",
                            description: "React to an event from a connected app",
                            onSelect: () => onPick("app"),
                        },
                        {
                            key: "schedule",
                            label: "Scheduled trigger",
                            description: "Run on a recurring schedule",
                            onSelect: () => onPick("schedule"),
                        },
                    ]}
                />
            </>
        )
    }

    it("shows the heading, one row per entry and Cancel", () => {
        render(<Menu onPick={vi.fn()} />)
        expect(screen.getByText("Add automation")).toBeTruthy()
        expect(screen.getByRole("menuitem", {name: /App trigger/})).toBeTruthy()
        expect(screen.getByText("Run on a recurring schedule")).toBeTruthy()
        expect(screen.getByRole("button", {name: "Cancel"}).className).toContain("h-11")
    })

    it("a tap on an entry closes the sheet and runs it", () => {
        const onPick = vi.fn()
        render(<Menu onPick={onPick} />)
        fireEvent.click(screen.getByRole("menuitem", {name: /Scheduled trigger/}))
        expect(onPick).toHaveBeenCalledWith("schedule")
        expect(screen.getByText("closed")).toBeTruthy()
    })

    it("Cancel closes the sheet and runs nothing", () => {
        const onPick = vi.fn()
        render(<Menu onPick={onPick} />)
        fireEvent.click(screen.getByRole("button", {name: "Cancel"}))
        expect(onPick).not.toHaveBeenCalled()
        expect(screen.getByText("closed")).toBeTruthy()
    })
})

describe("PhonePrimaryAction", () => {
    it("is a full-width 44 px button that runs its action", () => {
        const onClick = vi.fn()
        render(<PhonePrimaryAction onClick={onClick}>Add integration</PhonePrimaryAction>)
        const button = screen.getByRole("button", {name: "Add integration"})
        expect(button.className).toContain("h-11")
        expect(button.className).toContain("w-full")
        fireEvent.click(button)
        expect(onClick).toHaveBeenCalledOnce()
    })

    it("takes no tap while it loads", () => {
        const onClick = vi.fn()
        render(
            <PhonePrimaryAction onClick={onClick} loading>
                Add integration
            </PhonePrimaryAction>,
        )
        const button = screen.getByRole("button", {name: /Add integration/})
        expect((button as HTMLButtonElement).disabled).toBe(true)
    })
})

describe("SidebarSheet", () => {
    it("is 300 px wide and closes with Close the sidebar", () => {
        const onOpenChange = vi.fn()
        render(
            <SidebarSheet
                open
                onOpenChange={onOpenChange}
                title="Navigation"
                leading={<button type="button">Back</button>}
            >
                <a href="/x">Configuration</a>
            </SidebarSheet>,
        )
        const sheet = screen.getByTestId("sidebar-sheet")
        expect(sheet.style.width).toBe("300px")
        expect(screen.getByRole("button", {name: "Back"})).toBeTruthy()
        const close = screen.getByRole("button", {name: "Close the sidebar"})
        expect(close.className).toContain("size-11")
        fireEvent.click(close)
        expect(onOpenChange).toHaveBeenCalledWith(false)
    })
})

describe("useIsPhone", () => {
    it("reads the window width on the first render of a component that mounts later", () => {
        const original = window.matchMedia
        window.matchMedia = ((query: string) => ({
            matches: query === "(max-width: 767.98px)",
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        })) as unknown as typeof window.matchMedia
        const renders: boolean[] = []
        const Probe = () => {
            renders.push(useIsPhone())
            return null
        }
        render(<Probe />)
        window.matchMedia = original
        expect(renders[0]).toBe(true)
    })
})

describe("BottomSheet", () => {
    const Opened = () => {
        const [open, setOpen] = useState(false)
        return (
            <BottomSheet
                open={open}
                onOpenChange={setOpen}
                title="Sessions"
                trigger={<button type="button">Charged twice for March</button>}
            >
                <p>rows</p>
            </BottomSheet>
        )
    }

    it("opens from its trigger and gives the focus back to it when Cancel closes it", async () => {
        render(<Opened />)
        const trigger = screen.getByRole("button", {name: "Charged twice for March"})
        trigger.focus()
        fireEvent.click(trigger)
        expect(await screen.findByText("rows")).toBeTruthy()
        fireEvent.click(screen.getByRole("button", {name: "Cancel"}))
        await waitFor(() => expect(screen.queryByText("rows")).toBeNull())
        await waitFor(() => expect(document.activeElement).toBe(trigger))
    })
})
