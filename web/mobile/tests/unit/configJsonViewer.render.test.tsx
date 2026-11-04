// @vitest-environment jsdom
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {ConfigJsonViewer} from "@/features/evaluation-run/configuration/ConfigJsonViewer"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

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

describe("config JSON viewer", () => {
    it("The JSON cannot be edited", async () => {
        await act(async () => {
            root.render(createElement(ConfigJsonViewer, {id: "json-test", value: {a: 1}}))
        })
        await act(async () => new Promise((resolve) => setTimeout(resolve, 600)))
        const editable = host.querySelector('[contenteditable="true"]')
        expect(host.querySelector("[contenteditable]")).not.toBeNull()
        expect(editable).toBeNull()
    })
})
