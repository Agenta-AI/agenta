// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {StepItem} from "@/features/evaluations/new/StepItem"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

const mount = (warning: boolean) =>
    act(() =>
        root.render(
            <ol>
                <StepItem
                    step={{
                        section: "testset",
                        title: "Test set",
                        chips: [],
                        complete: true,
                        warning,
                    }}
                    active={false}
                    onOpen={() => undefined}
                />
            </ol>,
        ),
    )

describe("wizard step item", () => {
    it("A complete step with a warning shows the warning mark, not the green check", async () => {
        await mount(true)
        expect(host.querySelector("[aria-label='Test set needs attention']")).not.toBeNull()
        expect(host.querySelector("[aria-label='Test set complete']")).toBeNull()
    })

    it("A complete step without a warning shows its check", async () => {
        await mount(false)
        expect(host.querySelector("[aria-label='Test set complete']")).not.toBeNull()
    })
})
