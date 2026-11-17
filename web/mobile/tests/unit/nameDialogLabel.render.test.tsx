// @vitest-environment jsdom
/**
 * The name dialog of Settings (projects, organizations) is seen without developer mode, so it
 * must not change: only a dialog that passes `label` gets one.
 */
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {NameDialog} from "@/features/settings/NameDialog"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

describe("Name dialog label", () => {
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

    const render = (label?: string) =>
        act(() =>
            root.render(
                <NameDialog
                    open
                    title="New project"
                    submitLabel="Create"
                    pending={false}
                    label={label}
                    onClose={vi.fn()}
                    onSubmit={vi.fn()}
                />,
            ),
        )

    it("A Settings name dialog shows no label, as before", () => {
        render()
        const input = document.body.querySelector('[role="dialog"] input')
        expect(document.body.querySelector('[role="dialog"] label')).toBeNull()
        expect(input?.getAttribute("id")).toBeNull()
    })

    it("A dialog that passes a label shows it for the field", () => {
        render("Test set name")
        const label = document.body.querySelector<HTMLLabelElement>('[role="dialog"] label')
        expect(label?.textContent).toBe("Test set name")
        expect(document.getElementById(label?.htmlFor ?? "")?.tagName).toBe("INPUT")
    })
})
