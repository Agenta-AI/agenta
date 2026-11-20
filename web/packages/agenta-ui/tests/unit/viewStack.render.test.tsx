// @vitest-environment jsdom
import {useState} from "react"

import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {
    defineView,
    useOptionalViewStack,
    useViewForm,
    useViewOpener,
    useViewStack,
    useViewTitle,
    ViewFormActions,
    ViewStackHost,
    type ViewChromeProps,
    type ViewDef,
    type ViewProps,
    type ViewStack,
    type ViewTarget,
} from "../../src/view-stack"

afterEach(cleanup)

const AGENT: ViewTarget = {kind: "agent_draft", revisionId: "rev-1"}
const PROJECT: ViewTarget = {kind: "project"}

const TestChrome = ({crumbs, children, ...actions}: ViewChromeProps) => (
    <div>
        <nav aria-label="crumbs">
            {crumbs.map((crumb, i) =>
                crumb.onSelect ? (
                    <button key={i} onClick={crumb.onSelect}>
                        {`crumb:${crumb.title}`}
                    </button>
                ) : (
                    <span key={i}>{`here:${crumb.title}`}</span>
                ),
            )}
        </nav>
        {children}
        <ViewFormActions {...actions} />
    </div>
)

/** A deferred save the test resolves by hand. */
const deferred = () => {
    let resolve!: (ok: boolean) => void
    const promise = new Promise<boolean>((r) => (resolve = r))
    return {promise, resolve}
}

let saveImpl: () => Promise<boolean | "stay"> = async () => true
const seen: {target?: ViewTarget; push?: unknown}[] = []

const FormBody = ({params, target, nav}: ViewProps<{name: string}>) => {
    const [value, setValue] = useState("")
    useViewTitle(value || params.name)
    useViewForm({
        dirty: value !== "",
        valid: value !== "invalid",
        save: () => saveImpl(),
        leaveDescription: `leave ${params.name}`,
    })
    seen.push({target, push: nav.push})
    return (
        <div>
            <label>
                {`field ${params.name}`}
                <input value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
            {nav.push ? (
                <>
                    <button onClick={() => void nav.push!(pickerView, {name: "picker"}, target)}>
                        open picker
                    </button>
                    <button onClick={() => void nav.push!(formView, {name: "connect"}, PROJECT)}>
                        open child form
                    </button>
                </>
            ) : (
                <span>no push</span>
            )}
        </div>
    )
}
const formView: ViewDef<{name: string}> = defineView({
    id: "test.form",
    apply: "on_save",
    Component: FormBody,
})

const PickerBody = ({params, nav}: ViewProps<{name: string}>) => {
    useViewTitle(params.name)
    return <div>{nav.push ? "picker can push" : "picker at depth 2"}</div>
}
const pickerView: ViewDef<{name: string}> = defineView({
    id: "test.picker",
    apply: "immediate",
    Component: PickerBody,
})

let stackRef: ViewStack | null = null
const Root = () => {
    const stack = useViewStack()
    stackRef = stack
    return (
        <div>
            <span>root body</span>
            <button onClick={() => void stack.open(formView, {name: "skill"}, AGENT)}>
                open skill
            </button>
        </div>
    )
}

const renderHost = (onEscapeAtRoot?: () => void) =>
    render(
        <ViewStackHost chrome={TestChrome} rootTitle="Agent" onEscapeAtRoot={onEscapeAtRoot}>
            <Root />
        </ViewStackHost>,
    )

const type = (name: string, value: string) =>
    fireEvent.change(screen.getByLabelText(`field ${name}`), {target: {value}})
const dialog = () => screen.queryByTestId("unsaved-changes-dialog")
const answer = (label: string) => fireEvent.click(screen.getByRole("button", {name: label}))

describe("ViewStackHost", () => {
    it("opens a view at depth 1 with its target and keeps the root mounted", async () => {
        seen.length = 0
        saveImpl = async () => true
        renderHost()
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByLabelText("field skill")
        expect(screen.getByTestId("panel-view")).toBeTruthy()
        expect(seen.at(-1)?.target).toEqual(AGENT)
        // The root stays mounted (hidden) so it keeps its scroll position.
        expect(screen.getByText("root body")).toBeTruthy()
        expect(stackRef?.depth).toBe(1)
    })

    it("pushes a child with its own target, and the child cannot push a third level", async () => {
        seen.length = 0
        renderHost()
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByLabelText("field skill")
        fireEvent.click(screen.getByText("open child form"))
        await screen.findByText("here:connect")
        expect(seen.at(-1)?.target).toEqual(PROJECT)
        expect(seen.at(-1)?.push).toBeNull()
        expect(screen.getByText("no push")).toBeTruthy()
        expect(screen.getByText("crumb:Agent")).toBeTruthy()
        expect(screen.getByText("crumb:skill")).toBeTruthy()
        expect(stackRef?.depth).toBe(2)
    })

    it("takes the breadcrumb title from useViewTitle", async () => {
        renderHost()
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByText("here:skill")
        type("skill", "release-qa")
        await screen.findByText("here:release-qa")
    })

    it("Cancel drops the edits without a question", async () => {
        renderHost()
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByLabelText("field skill")
        type("skill", "edited")
        answer("Cancel")
        await waitFor(() => expect(screen.queryByLabelText("field skill")).toBeNull())
        expect(dialog()).toBeNull()
    })

    it("guarded back: Keep editing keeps the view and resolves false", async () => {
        renderHost()
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByLabelText("field skill")
        type("skill", "edited")
        fireEvent.click(screen.getByText("crumb:Agent"))
        await screen.findByTestId("unsaved-changes-dialog")
        expect(screen.getByText("leave skill")).toBeTruthy()
        answer("Keep editing")
        await waitFor(() => expect(dialog()).toBeNull())
        expect((screen.getByLabelText("field skill") as HTMLInputElement).value).toBe("edited")
    })

    it("guarded back: Discard leaves without saving", async () => {
        const save = vi.fn(async () => true)
        saveImpl = save
        renderHost()
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByLabelText("field skill")
        type("skill", "edited")
        fireEvent.keyDown(screen.getByLabelText("field skill"), {key: "Escape"})
        await screen.findByTestId("unsaved-changes-dialog")
        answer("Discard")
        await waitFor(() => expect(screen.queryByLabelText("field skill")).toBeNull())
        expect(save).not.toHaveBeenCalled()
    })

    it("guarded back: Save changes saves, then leaves; a failed save stays", async () => {
        let ok = false
        saveImpl = async () => ok
        renderHost()
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByLabelText("field skill")
        type("skill", "edited")
        fireEvent.click(screen.getByText("crumb:Agent"))
        await screen.findByTestId("unsaved-changes-dialog")
        answer("Save changes")
        // The failure shows in the dialog, which asks again; the view keeps its edits.
        await screen.findByRole("alert")
        expect(dialog()).toBeTruthy()
        expect((screen.getByLabelText("field skill") as HTMLInputElement).value).toBe("edited")

        ok = true
        answer("Save changes")
        await waitFor(() => expect(screen.queryByLabelText("field skill")).toBeNull())
    })

    it("a second Back while Save changes runs is dropped", async () => {
        const pending = deferred()
        saveImpl = () => pending.promise
        renderHost()
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByLabelText("field skill")
        type("skill", "edited")
        fireEvent.click(screen.getByText("crumb:Agent"))
        await screen.findByTestId("unsaved-changes-dialog")
        answer("Save changes")
        await waitFor(() => expect(dialog()).toBeNull())
        fireEvent.click(screen.getByText("crumb:Agent"))
        await act(async () => pending.resolve(true))
        await waitFor(() => expect(screen.queryByLabelText("field skill")).toBeNull())
        await new Promise((r) => setTimeout(r, 20))
        expect(dialog()).toBeNull()
    })

    it("a failed Save changes of a parent under a picker shows the error", async () => {
        saveImpl = async () => false
        renderHost()
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByLabelText("field skill")
        type("skill", "edited")
        fireEvent.click(screen.getByText("open picker"))
        await screen.findByText("picker at depth 2")
        fireEvent.click(screen.getByText("crumb:Agent"))
        await screen.findByTestId("unsaved-changes-dialog")
        answer("Save changes")
        await screen.findByRole("alert")
        answer("Keep editing")
        await waitFor(() => expect(dialog()).toBeNull())
        expect(screen.getByText("picker at depth 2")).toBeTruthy()
    })

    it("Save changes before a child form remounts the parent from saved data", async () => {
        saveImpl = async () => true
        renderHost()
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByLabelText("field skill")
        type("skill", "edited")
        fireEvent.click(screen.getByText("open child form"))
        await screen.findByTestId("unsaved-changes-dialog")
        answer("Save changes")
        await screen.findByLabelText("field connect")
        type("connect", "child edit")
        // Only the child is dirty now, so closing asks about the child.
        act(() => {
            void stackRef!.closeAll()
        })
        await screen.findByTestId("unsaved-changes-dialog")
        expect(screen.getByText("leave connect")).toBeTruthy()
    })

    it("the view takes no input while its Save runs, and a held Escape does not close the parent", async () => {
        const pending = deferred()
        saveImpl = () => pending.promise
        renderHost()
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByLabelText("field skill")
        fireEvent.click(screen.getByText("open child form"))
        await screen.findByLabelText("field connect")
        type("connect", "child edit")
        answer("Save")
        await screen.findByText("Saving…")
        expect(screen.getByTestId("panel-view").hasAttribute("inert")).toBe(true)
        fireEvent.keyDown(screen.getByLabelText("field connect"), {key: "Escape"})
        await act(async () => pending.resolve(true))
        // Save closed the child; the held Escape does not also close the parent.
        await screen.findByText("here:skill")
        expect(screen.getByLabelText("field skill")).toBeTruthy()
    })

    it("Save changes is disabled while the edits are not valid", async () => {
        renderHost()
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByLabelText("field skill")
        type("skill", "invalid")
        fireEvent.click(screen.getByText("crumb:Agent"))
        await screen.findByTestId("unsaved-changes-dialog")
        expect(
            (screen.getByRole("button", {name: "Save changes"}) as HTMLButtonElement).disabled,
        ).toBe(true)
    })

    it("Save is pending: a second click is ignored and navigation waits", async () => {
        const pending = deferred()
        const save = vi.fn(() => pending.promise)
        saveImpl = save
        renderHost()
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByLabelText("field skill")
        type("skill", "edited")
        answer("Save")
        await screen.findByText("Saving…")
        fireEvent.click(screen.getByText("Saving…").closest("button")!)
        expect(save).toHaveBeenCalledTimes(1)
        expect(stackRef?.dirty).toBe(true)

        let closed: boolean | undefined
        act(() => {
            void stackRef!.closeAll().then((r) => (closed = r))
        })
        await new Promise((r) => setTimeout(r, 20))
        expect(closed).toBeUndefined()
        expect(screen.getByLabelText("field skill")).toBeTruthy()

        await act(async () => pending.resolve(true))
        await waitFor(() => expect(closed).toBe(true))
        expect(screen.queryByLabelText("field skill")).toBeNull()
    })

    it("a failed Save keeps the view with its edits, and Save works again", async () => {
        let ok = false
        saveImpl = async () => ok
        renderHost()
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByLabelText("field skill")
        type("skill", "edited")
        answer("Save")
        await screen.findByRole("alert")
        expect((screen.getByLabelText("field skill") as HTMLInputElement).value).toBe("edited")
        ok = true
        answer("Save")
        await waitFor(() => expect(screen.queryByLabelText("field skill")).toBeNull())
    })

    it('a step that resolves "stay" keeps the view, shows no failure and takes input again', async () => {
        let result: boolean | "stay" = "stay"
        saveImpl = async () => result
        renderHost()
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByLabelText("field skill")
        type("skill", "edited")
        answer("Save")
        await waitFor(() =>
            expect(screen.getByRole("button", {name: "Save"}).hasAttribute("disabled")).toBe(false),
        )
        expect(screen.queryByRole("alert")).toBeNull()
        expect((screen.getByLabelText("field skill") as HTMLInputElement).value).toBe("edited")
        // From the unsaved-changes dialog, "stay" keeps the person on the view.
        fireEvent.click(screen.getByText("crumb:Agent"))
        await screen.findByTestId("unsaved-changes-dialog")
        answer("Save changes")
        await waitFor(() => expect(dialog()).toBeNull())
        expect(screen.getByLabelText("field skill")).toBeTruthy()
        result = true
        answer("Save")
        await waitFor(() => expect(screen.queryByLabelText("field skill")).toBeNull())
    })

    it("open is refused when the person keeps editing", async () => {
        renderHost()
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByLabelText("field skill")
        type("skill", "edited")
        let opened: boolean | undefined
        act(() => {
            void stackRef!.open(formView, {name: "other"}, AGENT).then((r) => (opened = r))
        })
        await screen.findByTestId("unsaved-changes-dialog")
        answer("Keep editing")
        await waitFor(() => expect(opened).toBe(false))
        expect(screen.getByLabelText("field skill")).toBeTruthy()
    })

    it("a picker opens over a dirty parent; closeAll asks with the parent's description", async () => {
        const save = vi.fn(async () => true)
        saveImpl = save
        renderHost()
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByLabelText("field skill")
        type("skill", "edited")
        fireEvent.click(screen.getByText("open picker"))
        await screen.findByText("picker at depth 2")
        expect(dialog()).toBeNull()
        expect(stackRef?.dirty).toBe(true)

        let closed: boolean | undefined
        act(() => {
            void stackRef!.closeAll().then((r) => (closed = r))
        })
        await screen.findByTestId("unsaved-changes-dialog")
        expect(screen.getByText("leave skill")).toBeTruthy()
        answer("Save changes")
        await waitFor(() => expect(closed).toBe(true))
        expect(save).toHaveBeenCalledTimes(1)
    })

    it("a child with its own form asks first; Discard resets the parent and opens the child", async () => {
        renderHost()
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByLabelText("field skill")
        type("skill", "edited")
        fireEvent.click(screen.getByText("open child form"))
        await screen.findByTestId("unsaved-changes-dialog")
        answer("Discard")
        await screen.findByLabelText("field connect")
        fireEvent.click(await screen.findByText("crumb:skill"))
        const parent = (await screen.findByLabelText("field skill")) as HTMLInputElement
        expect(parent.value).toBe("")
    })

    it("Escape at the root calls onEscapeAtRoot; with a clean view it goes back", async () => {
        const onEscape = vi.fn()
        renderHost(onEscape)
        fireEvent.keyDown(screen.getByText("open skill"), {key: "Escape"})
        expect(onEscape).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByText("open skill"))
        await screen.findByLabelText("field skill")
        fireEvent.keyDown(screen.getByLabelText("field skill"), {key: "Escape"})
        await waitFor(() => expect(screen.queryByLabelText("field skill")).toBeNull())
        expect(onEscape).toHaveBeenCalledTimes(1)
    })
})

describe("useOptionalViewStack", () => {
    const Probe = () => {
        const stack = useOptionalViewStack()
        return <span>{stack ? `stack depth ${stack.depth}` : "no stack"}</span>
    }

    it("returns null outside a host, where useViewStack throws", () => {
        render(<Probe />)
        expect(screen.getByText("no stack")).toBeTruthy()
        const Strict = () => {
            useViewStack()
            return null
        }
        vi.spyOn(console, "error").mockImplementation(() => {})
        expect(() => render(<Strict />)).toThrow("useViewStack must be used inside a ViewStackHost")
        vi.restoreAllMocks()
    })

    it("returns the host's stack inside a host", () => {
        render(
            <ViewStackHost chrome={TestChrome}>
                <Probe />
            </ViewStackHost>,
        )
        expect(screen.getByText("stack depth 0")).toBeTruthy()
    })
})

describe("useViewOpener", () => {
    const LabelBody = () => {
        useViewTitle("connect")
        useViewForm({
            dirty: true,
            valid: true,
            save: async () => true,
            leaveDescription: "leave connect",
            saveLabel: "Connect",
        })
        return <span>connect body</span>
    }
    const labelView = defineView({id: "test.label", apply: "on_save", Component: LabelBody})

    const OpenerRoot = () => {
        const views = useViewOpener()
        return (
            <>
                <button onClick={() => void views.open(pickerView, {name: "model"}, AGENT)}>
                    open model
                </button>
                <button onClick={() => void views.open(labelView, {}, PROJECT)}>open label</button>
                {views.drawer}
            </>
        )
    }

    it("opens the view in the nearest stack when there is one", async () => {
        render(
            <ViewStackHost chrome={TestChrome} rootTitle="Agent">
                <OpenerRoot />
            </ViewStackHost>,
        )
        await act(async () => fireEvent.click(screen.getByText("open model")))
        expect(screen.getByText("crumb:Agent")).toBeTruthy()
        expect(screen.getByText("picker can push")).toBeTruthy()
    })

    it("with no stack, opens the view in a drawer that closes with Done", async () => {
        render(<OpenerRoot />)
        await act(async () => fireEvent.click(screen.getByText("open model")))
        expect(await screen.findByText("picker can push")).toBeTruthy()
        await act(async () => fireEvent.click(screen.getByRole("button", {name: "Done"})))
        await waitFor(() => expect(screen.queryByText("picker can push")).toBeNull(), {
            timeout: 2000,
        })
    })

    it("the Save button takes the view's label", async () => {
        render(<OpenerRoot />)
        await act(async () => fireEvent.click(screen.getByText("open label")))
        expect(await screen.findByRole("button", {name: "Connect"})).toBeTruthy()
    })
})
