// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    AddColumnButton,
    ColumnDialog,
    type ColumnDialogStep,
} from "@/features/testsets/detail/ColumnDialogs"
import type {ColumnEdit} from "@/features/testsets/detail/useTestsetEditor"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

describe("ColumnDialog", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    const render = (
        step: ColumnDialogStep,
        onSubmit: (name: string) => Promise<ColumnEdit>,
        onDone = vi.fn(),
    ) => {
        act(() =>
            root.render(
                <ColumnDialog step={step} onClose={vi.fn()} onSubmit={onSubmit} onDone={onDone} />,
            ),
        )
        return onDone
    }

    const button = (name: string) => {
        const found = Array.from(document.body.querySelectorAll("button")).find(
            (element) => element.textContent?.trim() === name,
        )
        if (!found) throw new Error(`No button named ${name}`)
        return found
    }

    const typeName = (value: string) => {
        const input = document.body.querySelector<HTMLInputElement>("#column-name")
        if (!input) throw new Error("No name field")
        act(() => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
            setter?.call(input, value)
            input.dispatchEvent(new Event("input", {bubbles: true}))
        })
    }

    it("A rename is staged for the commit: no save is promised and the step closes", async () => {
        const onSubmit = vi.fn(async () => ({ok: true}) as const)
        const onDone = render({kind: "rename", columnKey: "answer"}, onSubmit)

        expect(document.body.textContent).not.toContain("saves a new version")
        typeName("reply")
        await act(async () => button("Rename").click())

        expect(onSubmit).toHaveBeenCalledWith("reply")
        expect(onDone).toHaveBeenCalledTimes(1)
    })

    it("A refused name shows why and keeps the step open", async () => {
        const onSubmit = vi.fn(async (): Promise<ColumnEdit> => ({ok: false, reason: "duplicate"}))
        const onDone = render({kind: "add"}, onSubmit)

        typeName("reply")
        await act(async () => button("Add").click())

        expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
            'Column "reply" already exists',
        )
        expect(onDone).not.toHaveBeenCalled()
    })

    it("A delete asks first and promises no save", async () => {
        const onSubmit = vi.fn(async () => ({ok: true}) as const)
        render(
            {kind: "delete", columnKey: "answer", columnKeys: ["answer"], isGroup: false},
            onSubmit,
        )

        expect(document.body.textContent).toContain(
            'Are you sure you want to delete the column "answer"?',
        )
        expect(document.body.textContent).not.toContain("saves a new version")
        await act(async () => button("Delete").click())
        expect(onSubmit).toHaveBeenCalledWith("answer")
    })

    it("Add column is off with the reason while a save runs", () => {
        act(() =>
            root.render(
                <AddColumnButton
                    blockedReason="Wait for the current save to finish"
                    onClick={vi.fn()}
                />,
            ),
        )
        expect(button("Add column").disabled).toBe(true)
    })
})
