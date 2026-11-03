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
        savesVersion: boolean,
        onSubmit: (name: string) => Promise<ColumnEdit>,
        onDone = vi.fn(),
    ) => {
        act(() =>
            root.render(
                <ColumnDialog
                    step={step}
                    savesVersion={savesVersion}
                    onClose={vi.fn()}
                    onSubmit={onSubmit}
                    onDone={onDone}
                />,
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

    it("A rename on a saved test set says it saves a new version and opens it", async () => {
        const onSubmit = vi.fn(async () => ({ok: true, revisionId: "rev-4"}) as const)
        const onDone = render({kind: "rename", columnKey: "answer"}, true, onSubmit)

        expect(document.body.textContent).toContain(
            "This saves a new version of the test set right away.",
        )
        typeName("reply")
        await act(async () => button("Rename and save").click())

        expect(onSubmit).toHaveBeenCalledWith("reply")
        expect(onDone).toHaveBeenCalledWith("rev-4")
    })

    it("A refused name shows why and keeps the step open", async () => {
        const onSubmit = vi.fn(async (): Promise<ColumnEdit> => ({ok: false, reason: "duplicate"}))
        const onDone = render({kind: "add"}, true, onSubmit)

        typeName("reply")
        await act(async () => button("Add and save").click())

        expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
            'Column "reply" already exists',
        )
        expect(onDone).not.toHaveBeenCalled()
    })

    it("A delete on a new test set does not mention a save", async () => {
        const onSubmit = vi.fn(async () => ({ok: true, revisionId: null}) as const)
        render({kind: "delete", columnKey: "answer"}, false, onSubmit)

        expect(document.body.textContent).not.toContain("saves a new version")
        await act(async () => button("Delete").click())
        expect(onSubmit).toHaveBeenCalledWith("answer")
    })

    it("Add column is off with the reason while rows have unsaved edits", () => {
        act(() =>
            root.render(
                <AddColumnButton
                    blockedReason="Save or discard your row changes first"
                    onClick={vi.fn()}
                />,
            ),
        )
        expect(button("Add column").disabled).toBe(true)
    })
})
