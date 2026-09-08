// @vitest-environment jsdom
import {StrictMode, Suspense, startTransition, useState, type ReactNode} from "react"

import {act, render, renderHook} from "@testing-library/react"
import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {usePendingSendEchoes} from "../../../src/hooks/usePendingSendEchoes"

const user = (id: string, text: string, turnId?: string): UIMessage =>
    ({
        id,
        role: "user",
        parts: [{type: "text", text}],
        ...(turnId ? {metadata: {turnId}} : {}),
    }) as UIMessage

const NO_DOCK: ReadonlySet<string> = new Set()

const setup = (messages: UIMessage[] = [], dockedInputIds: ReadonlySet<string> = NO_DOCK) =>
    renderHook(
        (props: {messages: UIMessage[]; dockedInputIds: ReadonlySet<string>}) =>
            usePendingSendEchoes(props),
        {initialProps: {messages, dockedInputIds}},
    )

const texts = (rows: UIMessage[]) =>
    rows.map((row) => row.parts.map((part) => ("text" in part ? part.text : "")).join(""))

describe("usePendingSendEchoes", () => {
    it("shows a send immediately and retires it on its own turn id", () => {
        const {result, rerender} = setup()

        act(() => result.current.add({id: "m1", text: "mine"}))
        expect(texts(result.current.rows)).toEqual(["mine"])

        act(() => result.current.markAccepted("m1", "turn-mine"))
        expect(texts(result.current.rows)).toEqual(["mine"])

        // A foreign row raises the count and must not retire it.
        rerender({messages: [user("f1", "theirs", "turn-foreign")], dockedInputIds: NO_DOCK})
        expect(texts(result.current.rows)).toEqual(["mine"])

        rerender({
            messages: [user("f1", "theirs", "turn-foreign"), user("s1", "mine", "turn-mine")],
            dockedInputIds: NO_DOCK,
        })
        expect(result.current.rows).toHaveLength(0)
    })

    it("keeps a parked send until the dock is observed to hold it", () => {
        const {result, rerender} = setup()

        act(() => result.current.add({id: "m1", text: "parked"}))
        act(() => result.current.markParked("m1", "input-1"))
        expect(texts(result.current.rows)).toEqual(["parked"])

        rerender({messages: [], dockedInputIds: new Set(["input-other"])})
        expect(texts(result.current.rows)).toEqual(["parked"])

        rerender({messages: [], dockedInputIds: new Set(["input-1"])})
        expect(result.current.rows).toHaveLength(0)
    })

    it("allocates distinct coverage for a burst added in one tick", () => {
        const {result, rerender} = setup()

        act(() => {
            result.current.add({id: "m1", text: "one"})
            result.current.add({id: "m2", text: "two"})
        })
        expect(texts(result.current.rows)).toEqual(["one", "two"])

        rerender({messages: [user("s1", "one")], dockedInputIds: NO_DOCK})
        expect(texts(result.current.rows)).toEqual(["two"])

        rerender({messages: [user("s1", "one"), user("s2", "two")], dockedInputIds: NO_DOCK})
        expect(result.current.rows).toHaveLength(0)
    })

    it("renumbers a survivor after its predecessor is dropped", () => {
        const {result, rerender} = setup()

        act(() => {
            result.current.add({id: "mA", text: "A"})
            result.current.add({id: "mB", text: "B"})
        })
        act(() => result.current.drop("mA"))
        expect(texts(result.current.rows)).toEqual(["B"])

        // B's own record now saves as the first user row, the count A had reserved.
        rerender({messages: [user("s1", "B")], dockedInputIds: NO_DOCK})
        expect(result.current.rows).toHaveLength(0)
    })

    it("never returns an adopted row and its echo together, in any render", () => {
        const seen: number[] = []
        const {result, rerender} = renderHook(
            (props: {messages: UIMessage[]; dockedInputIds: ReadonlySet<string>}) => {
                const echoes = usePendingSendEchoes(props)
                seen.push(
                    props.messages.filter((m) => m.role === "user").length + echoes.rows.length,
                )
                return echoes
            },
            {initialProps: {messages: [] as UIMessage[], dockedInputIds: NO_DOCK}},
        )

        act(() => result.current.add({id: "m1", text: "mine"}))
        act(() => result.current.markAccepted("m1", "turn-1"))
        seen.length = 0

        rerender({messages: [user("s1", "mine", "turn-1")], dockedInputIds: NO_DOCK})

        expect(seen.length).toBeGreaterThan(0)
        for (const total of seen) expect(total).toBeLessThanOrEqual(1)
    })

    it("survives an abandoned render: the echo comes back and the next send is unaffected", () => {
        // React renders a transition speculatively and DISCARDS that render when a descendant
        // suspends. Anything the hook wrote outside state during it would not be rolled back,
        // losing the echo and freeing its reserved count for the next send to reuse.
        let commit!: (messages: UIMessage[]) => void
        let echoes!: ReturnType<typeof usePendingSendEchoes>
        const never = new Promise<void>(() => undefined)

        const Suspender = ({on}: {on: boolean}) => {
            if (on) throw never
            return null
        }

        const Harness = () => {
            const [messages, setMessages] = useState<UIMessage[]>([])
            commit = setMessages
            const value = usePendingSendEchoes({messages, dockedInputIds: NO_DOCK})
            if (messages.length === 0) echoes = value
            return (
                <Suspense fallback={null}>
                    <Suspender on={messages.length > 0} />
                </Suspense>
            )
        }

        render(<Harness />)
        act(() => echoes.add({id: "m1", text: "A"}))
        expect(texts(echoes.rows)).toEqual(["A"])

        // A transition that suspends: React renders it, throws the render away, and keeps the
        // committed tree. No effect runs, so nothing legitimately prunes the echo.
        act(() => {
            startTransition(() => commit([user("s1", "A", "turn-1")]))
        })

        expect(texts(echoes.rows)).toEqual(["A"])

        act(() => echoes.add({id: "m2", text: "B"}))
        expect(texts(echoes.rows)).toEqual(["A", "B"])
    })

    it("behaves the same under StrictMode's double render", () => {
        const wrapper = ({children}: {children: ReactNode}) => <StrictMode>{children}</StrictMode>
        const {result, rerender} = renderHook(
            (props: {messages: UIMessage[]; dockedInputIds: ReadonlySet<string>}) =>
                usePendingSendEchoes(props),
            {initialProps: {messages: [] as UIMessage[], dockedInputIds: NO_DOCK}, wrapper},
        )

        act(() => result.current.add({id: "m1", text: "mine"}))
        act(() => result.current.markAccepted("m1", "turn-1"))
        expect(texts(result.current.rows)).toEqual(["mine"])

        rerender({messages: [user("s1", "mine", "turn-1")], dockedInputIds: NO_DOCK})
        expect(result.current.rows).toHaveLength(0)
    })

    it("drops an echo a rewind stranded below its origin", () => {
        const {result, rerender} = setup([user("h1", "old"), user("h2", "older")])

        act(() => result.current.add({id: "m1", text: "new"}))
        expect(texts(result.current.rows)).toEqual(["new"])

        rerender({messages: [], dockedInputIds: NO_DOCK})
        expect(result.current.rows).toHaveLength(0)
    })
})
