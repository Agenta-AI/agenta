// @vitest-environment jsdom
/**
 * Round trips of the testcase editor with the real editors (the rich text and code editors, the
 * package drawer and the JSON / YAML data editor), not stubs. Opening a row, showing each field
 * in each of its views and closing must not write anything: the row stays deep-equal to what
 * was stored, with the same types, the same keys and the same strings.
 */
import {act} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {getDefaultStore} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {TestcaseEditorDrawer} from "@/features/testsets/detail/TestcaseEditorDrawer"
import {TestcaseEditorDrawerContent} from "@/features/testsets/detail/TestcaseEditorDrawerContent"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

// jsdom has no layout; the fold buttons only watch sizes.
globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
}

const store = getDefaultStore()

/** One value of every kind the form edits, nested values and text that is easy to change. */
const SAMPLE_ROW: Record<string, unknown> = {
    ticket_id: "T-20418",
    padded: "  two spaces  ",
    numeric_text: "12",
    true_text: "true",
    null_text: "null",
    empty_text: "",
    nothing: null,
    zero: 0,
    ratio: 3.25,
    negative: -7,
    flag: false,
    link: "https://example.com/a?b=c",
    notes: "line one\r\nline two\n\n",
    long_line: "x".repeat(200),
    doc: "# Title\n\n- a\n- **b**\n",
    unicode: "héllo 🌍",
    tags: ["a", "b"],
    numbers: [1, 2.5, -3],
    mixed: [null, true, 2, "x"],
    no_items: [],
    meta: {b: 1, a: {c: "x\n", d: [1, {e: null}]}, f: true, g: "", h: null},
    no_keys: {},
    chat: [
        {role: "user", content: "hi"},
        {
            role: "assistant",
            content: null,
            tool_calls: [{id: "c1", type: "function", function: {name: "f", arguments: '{"x":1}'}}],
        },
    ],
    chat_extra_keys: [{role: "user", content: "hi", reasoning: "kept"}],
    wrapped_chat: {messages: [{role: "user", content: "hi"}]},
    list_of_objects: [{a: 1}, {a: 2}],
    nested_list: [[1, 2], {a: 1}],
    json_text: '{"a":1,"b":[1,2]}',
    json_text_spaced: '{\n    "a" : 1\n}',
    json_list_text: "[1, 2]",
    fenced_json: '```json\n{"a": 1}\n```',
    loose_json: "{a: 1}",
    json_string_text: '"{\\"b\\":2}"',
    yaml_lookalikes: {
        date: "2024-01-01",
        yes: "yes",
        on: "on",
        tilde: "~",
        exp: "1e3",
        hex: "0x10",
        octal: "012",
        hash: "#x",
        colon: "k: v",
        tab: "\t",
        lead: " a",
        trail: "a ",
        crlf: "a\r\nb",
        blank_lines: "a\n\nb\n\n",
    },
}

interface TextPiece {
    type?: string
    text?: string
    children?: TextPiece[]
}
/** The parts of the rich text editor (Lexical) a test uses to type. */
interface LexicalEditorLike {
    getEditorState: () => {toJSON: () => unknown}
    parseEditorState: (state: unknown) => unknown
    setEditorState: (state: unknown) => void
}

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)))

describe("Testcase editor round trip", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })
    const subscriptions: (() => void)[] = []
    afterEach(() => {
        subscriptions.splice(0).forEach((stop) => stop())
        act(() => root.unmount())
        host.remove()
        store.set(testcaseMolecule.actions.discardAll)
    })

    /** A row whose data the store reports, and every write to it after this call. */
    const storedRow = (data: Record<string, unknown>) => {
        const id = store.set(testcaseMolecule.actions.add, {data: structuredClone(data)})?.id ?? ""
        const writes: unknown[] = []
        subscriptions.push(
            store.sub(testcaseMolecule.atoms.data(id), () =>
                writes.push(store.get(testcaseMolecule.atoms.data(id))?.data),
            ),
        )
        return {id, writes, data: () => store.get(testcaseMolecule.atoms.data(id))?.data}
    }

    const content = (id: string, rootViewMode: "form" | "json" | "yaml") =>
        act(async () =>
            root.render(
                <TestcaseEditorDrawerContent
                    testcaseId={id}
                    isNewRow={false}
                    viewOnly={false}
                    initialPath={[]}
                    onPathChange={vi.fn()}
                    rootViewMode={rootViewMode}
                    collapseSignal={0}
                />,
            ),
        )

    const openMenu = (name: string) =>
        act(() => {
            host.querySelector(`[aria-label="Field actions for ${name}"]`)?.dispatchEvent(
                new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
            )
        })
    const viewItems = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
    const closeMenu = () =>
        act(() => {
            document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}))
        })

    const showAs = async (key: string, label: string) => {
        openMenu(key)
        const item = viewItems().find((option) => option.textContent === label)
        expect(item, `${key} has the view ${label}`).toBeDefined()
        act(() => item?.click())
        await flush()
    }
    const section = (name: string) =>
        host.querySelector<HTMLElement>(`section[aria-label="${name}"]`)

    /**
     * Types in the code editor of a field as a user does: the editor state gets `to` in place of
     * `from` in one of its text pieces, and the editor sends its text.
     */
    const editCode = async (key: string, from: string, to: string) => {
        const element = section(key)?.querySelector("[contenteditable]")
        const editor = (element as unknown as {__lexicalEditor?: LexicalEditorLike} | null)
            ?.__lexicalEditor
        const state = editor?.getEditorState().toJSON() as {root: TextPiece}
        let found = false
        const walk = (piece: TextPiece) => {
            if (!found && typeof piece.text === "string" && piece.text.includes(from)) {
                piece.text = piece.text.replace(from, to)
                found = true
            }
            piece.children?.forEach(walk)
        }
        walk(state.root)
        expect(found).toBe(true)
        await act(async () => editor?.setEditorState(editor.parseEditorState(state)))
        await flush()
    }

    /** Replaces the whole text of the first code editor on the page with one line. */
    const replaceCode = async (line: string) => {
        const element = host.querySelector("[contenteditable]")
        const editor = (element as unknown as {__lexicalEditor?: LexicalEditorLike} | null)
            ?.__lexicalEditor
        const state = editor?.getEditorState().toJSON() as {root: TextPiece}
        // The code block is the node whose children are the code lines.
        const blockOf = (piece: TextPiece): TextPiece | undefined =>
            piece.children?.[0]?.type === "code-line"
                ? piece
                : piece.children?.map(blockOf).find(Boolean)
        const block = blockOf(state.root) as TextPiece
        const first = block.children?.[0] as TextPiece
        const piece = (first.children ?? []).find((child) => typeof child.text === "string")
        block.children = [{...first, children: [{...piece, text: line}]}]
        await act(async () => editor?.setEditorState(editor.parseEditorState(state)))
        await flush()
    }

    it.each(Object.keys(SAMPLE_ROW))(
        "showing %s in each of its views writes nothing",
        async (key) => {
            const row = storedRow(SAMPLE_ROW)
            await content(row.id, "form")
            await flush()

            openMenu(key)
            const labels = viewItems().map((item) => item.textContent ?? "")
            closeMenu()
            // Every view, then the first view again.
            for (const label of labels.length > 0 ? [...labels, labels[0]] : []) {
                await showAs(key, label)
            }

            expect(row.writes).toEqual([])
            expect(row.data()).toStrictEqual(SAMPLE_ROW)
        },
    )

    it.each(["json", "yaml"] as const)("the whole row in %s writes nothing", async (view) => {
        const row = storedRow(SAMPLE_ROW)
        await content(row.id, view)
        await flush()
        expect(host.querySelector("[contenteditable]")).not.toBeNull()
        await content(row.id, "form")
        await flush()

        expect(row.writes).toEqual([])
        expect(row.data()).toStrictEqual(SAMPLE_ROW)
    })

    it.each([
        ["json", "[1, 2]"],
        ["json", "null"],
        ["yaml", "just a text"],
    ] as const)("the whole row in %s keeps the row when the text is %s", async (view, line) => {
        const row = storedRow(SAMPLE_ROW)
        await content(row.id, view)
        await flush()

        await replaceCode(line)

        expect(row.writes).toEqual([])
        expect(host.querySelector('[role="alert"]')?.textContent).toContain(
            "the test case must be an object",
        )
    })

    it("an edit in YAML changes only the edited value, also when the last value ends in blank lines", async () => {
        const row = storedRow(SAMPLE_ROW)
        await content(row.id, "form")
        await showAs("yaml_lookalikes", "YAML")

        await editCode("yaml_lookalikes", "2024-01-01", "2024-01-02")

        expect(row.data()).toStrictEqual({
            ...SAMPLE_ROW,
            yaml_lookalikes: {
                ...(SAMPLE_ROW.yaml_lookalikes as Record<string, unknown>),
                date: "2024-01-02",
            },
        })
    })

    it("JSON written as text stays text through an edit in JSON, a switch to YAML and an edit there", async () => {
        const row = storedRow(SAMPLE_ROW)
        await content(row.id, "form")

        await editCode("json_text", "1", "5")
        expect(typeof row.data()?.json_text).toBe("string")
        expect(JSON.parse(row.data()?.json_text as string)).toEqual({a: 5, b: [1, 2]})

        await showAs("json_text", "YAML")
        expect(section("json_text")?.textContent).toContain("YAML")
        await editCode("json_text", "5", "6")
        await showAs("json_text", "JSON")

        const stored = row.data()?.json_text
        expect(typeof stored).toBe("string")
        expect(JSON.parse(stored as string)).toEqual({a: 6, b: [1, 2]})
        expect(row.data()).toStrictEqual({...SAMPLE_ROW, json_text: stored})
    })

    it("an object edited in JSON keeps the types of the values it did not change", async () => {
        const row = storedRow(SAMPLE_ROW)
        await content(row.id, "form")
        await showAs("meta", "JSON")

        await editCode("meta", '"x\\n"', '"y\\n"')
        await showAs("meta", "Form")

        expect(row.data()).toStrictEqual({
            ...SAMPLE_ROW,
            meta: {b: 1, a: {c: "y\n", d: [1, {e: null}]}, f: true, g: "", h: null},
        })
    })

    it("Cancel in the drawer puts back a text and a true or false value as they were", async () => {
        const row = storedRow(SAMPLE_ROW)
        const onClose = vi.fn()
        await act(async () =>
            root.render(
                <TestcaseEditorDrawer
                    testcaseId={row.id}
                    testcaseNumber={1}
                    viewOnly={false}
                    hasPrevious={false}
                    hasNext={false}
                    onPrevious={vi.fn()}
                    onNext={vi.fn()}
                    onClose={onClose}
                    onOpenCommit={vi.fn()}
                />,
            ),
        )
        await flush()
        const field = (name: string) =>
            document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)
        const input = field("ticket_id") as HTMLInputElement
        act(() => {
            const proto = Object.getPrototypeOf(input) as object
            Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, "T-1")
            input.dispatchEvent(new Event("input", {bubbles: true}))
        })
        const flag = document.querySelector('[role="radiogroup"][aria-label="flag"]')
        act(() =>
            [...(flag?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])]
                .find((option) => option.textContent === "true")
                ?.click(),
        )
        expect(row.data()).toMatchObject({ticket_id: "T-1", flag: true})

        const cancel = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
            (button) => button.textContent === "Cancel",
        )
        await act(async () => cancel?.click())

        expect(onClose).toHaveBeenCalled()
        expect(row.data()).toStrictEqual(SAMPLE_ROW)
    })
})
